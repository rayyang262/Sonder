// ============================================================================
//  SONDER — UMAP LAYOUTS (three signals: sound + social + me & friends)
// ============================================================================
//  Sections:
//     [FETCH]     ensure every memory has cached genre list
//     [VECTORS]   build the input matrix for each signal
//     [RUN]       runUmap — call umap-js, return 3D coords scaled for Three.js
//     [FEELINGS]  feeling-cluster layout (fixed cluster centers, not UMAP)
//     [PIPELINE]  computeLayouts — one call, returns maps for all signals
// ============================================================================
//
//  Layouts produced:
//    • sound        — UMAP of multi-hot Spotify genre + artist-id fallback
//    • social       — feeling clusters: top-N feelings become anchor points,
//                     each memory drifts toward its dominant feeling. Cluster
//                     CENTERS are returned separately so Discovery can label
//                     them and let users click-into a feeling room.
//    • myFriends    — UMAP of multi-hot genre, restricted to me+friends only
//
//  Output per signal: Map<memoryId, [x, y, z]>
//  Plus `social.clusters: { feeling: string, x, y, z }[]` for label rendering.
// ============================================================================

import { UMAP } from 'umap-js';
import { getArtistGenres } from './spotify.js';
import { updateMemoryGenres } from './firebase.js';


// ============================================================================
//  [FETCH]  one-time cache of artist genres on each memory doc
// ============================================================================
async function cacheGenres(memories, onProgress) {
  for (let i = 0; i < memories.length; i++) {
    onProgress?.({ stage: 'genres', done: i, total: memories.length });
    const m = memories[i];
    if (Array.isArray(m.genres)) continue;
    const artistId = m.song?.artistId;
    if (!artistId) { m.genres = []; continue; }
    try {
      const g = await getArtistGenres(artistId);
      m.genres = g;
      await updateMemoryGenres(m.id, g);
    } catch (e) {
      console.warn(`[genres] skipped ${m.id}:`, e.message);
      m.genres = [];
    }
  }
  onProgress?.({ stage: 'genres', done: memories.length, total: memories.length });
}


// ============================================================================
//  [VECTORS]
// ============================================================================

function buildSoundVectors(memories) {
  const genreVocab = new Map();
  const artistVocab = new Map();
  for (const m of memories) {
    for (const g of (m.genres || [])) {
      if (!genreVocab.has(g)) genreVocab.set(g, genreVocab.size);
    }
    const aid = m.song?.artistId;
    if (aid && !artistVocab.has(aid)) artistVocab.set(aid, artistVocab.size);
  }
  const G = genreVocab.size;
  const A = artistVocab.size;
  const D = G + A;
  if (D === 0) return memories.map(() => null);

  return memories.map((m) => {
    const row = new Array(D).fill(0);
    for (const g of (m.genres || [])) {
      const idx = genreVocab.get(g);
      if (idx !== undefined) row[idx] = 1;
    }
    const aid = m.song?.artistId;
    if (aid && artistVocab.has(aid)) row[G + artistVocab.get(aid)] = 0.6;
    return row.some((v) => v > 0) ? row : null;
  });
}


// ============================================================================
//  [RUN]  umap-js wrapper + normalization to Three.js viewport
// ============================================================================
function runUmap(memories, vectors, opts = {}) {
  const { minDist = 0.5, spread = 1.5, maxNeighbors = 15, jitter = 0.08 } = opts;
  const ids = [];
  const valid = [];
  for (let i = 0; i < memories.length; i++) {
    if (Array.isArray(vectors[i]) && vectors[i].length > 0) {
      ids.push(memories[i].id);
      valid.push(vectors[i].map((v) => v + (Math.random() - 0.5) * jitter));
    }
  }
  if (valid.length < 2) return { ids, coords: valid.map(() => [0, 0, 0]) };

  const nNeighbors = Math.max(2, Math.min(maxNeighbors, valid.length - 1));
  const umap = new UMAP({ nComponents: 3, nNeighbors, minDist, spread });
  let raw;
  try {
    raw = umap.fit(valid);
  } catch (e) {
    console.warn('[umap] fit failed, falling back to zeros:', e.message);
    return { ids, coords: valid.map(() => [0, 0, 0]) };
  }
  raw = raw.map((c) => c.map((v) => Number.isFinite(v) ? v : 0));
  return { ids, coords: normalize(raw) };
}

function normalize(coords) {
  if (coords.length === 0) return coords;
  const mins = [Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity];
  for (const c of coords) for (let d = 0; d < 3; d++) {
    if (c[d] < mins[d]) mins[d] = c[d];
    if (c[d] > maxs[d]) maxs[d] = c[d];
  }
  const span = 12;
  return coords.map((c) => c.map((v, d) => {
    const range = maxs[d] - mins[d] || 1;
    return ((v - mins[d]) / range - 0.5) * span;
  }));
}


// ============================================================================
//  [FEELINGS]  fixed cluster centers based on top-N feelings across corpus
// ============================================================================
//  Why fixed centers (not UMAP):
//    • Reviewer feedback: clusters should be readable as feelings.
//    • Fixed positions let us label each cluster + make it clickable.
//    • Each cluster center sits on a Fibonacci sphere; memories drift
//      toward whichever of their top-10 feelings is most popular overall.
// ============================================================================
const MAX_CLUSTERS = 10;

function topFeelings(memories) {
  const counts = new Map();
  for (const m of memories) {
    for (const f of (m.feelings || [])) {
      counts.set(f, (counts.get(f) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CLUSTERS)
    .map(([f]) => f);
}

// Distribute N points roughly evenly on a sphere of radius R.
function fibonacciSphere(n, R) {
  const pts = [];
  const phi = Math.PI * (Math.sqrt(5) - 1);
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / Math.max(1, n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = phi * i;
    pts.push([Math.cos(t) * r * R, y * R, Math.sin(t) * r * R]);
  }
  return pts;
}

function buildFeelingLayout(memories) {
  const tops = topFeelings(memories);
  const clusters = [];
  if (tops.length === 0) {
    // No feelings yet — collapse everything to origin so social view still renders.
    const map = new Map();
    for (const m of memories) map.set(m.id, [0, 0, 0]);
    return { map, clusters };
  }

  const centers = fibonacciSphere(tops.length, 6);
  const topSet = new Map(tops.map((f, i) => [f, i]));
  tops.forEach((f, i) => {
    clusters.push({ feeling: f, x: centers[i][0], y: centers[i][1], z: centers[i][2] });
  });

  const map = new Map();
  for (const m of memories) {
    const fs = (m.feelings || []).filter((f) => topSet.has(f));
    if (fs.length === 0) {
      // No top-feeling match — drop in the "void" near origin.
      map.set(m.id, [
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 1.5
      ]);
      continue;
    }
    // Weighted average of cluster centers, weight = inverse rank in this memory's
    // top-10 (so the FIRST listed feeling pulls hardest).
    let wx = 0, wy = 0, wz = 0, ws = 0;
    fs.forEach((f, rank) => {
      const w = 1 / (rank + 1);
      const c = centers[topSet.get(f)];
      wx += c[0] * w; wy += c[1] * w; wz += c[2] * w;
      ws += w;
    });
    const cx = wx / ws, cy = wy / ws, cz = wz / ws;
    // Small jitter so memories don't perfectly overlap on cluster centers.
    map.set(m.id, [
      cx + (Math.random() - 0.5) * 0.6,
      cy + (Math.random() - 0.5) * 0.6,
      cz + (Math.random() - 0.5) * 0.6
    ]);
  }
  return { map, clusters };
}


// ============================================================================
//  [PIPELINE]  one entry point — cache genres, then build all signals
// ============================================================================
export async function computeLayouts(memories, onProgress = () => {}) {
  await cacheGenres(memories, onProgress);

  onProgress({ stage: 'umap' });

  // Sound: loose UMAP across genre vectors.
  const sound = runUmap(memories, buildSoundVectors(memories), {
    minDist: 0.8, spread: 1.8, maxNeighbors: 8, jitter: 0.1
  });

  // Social: feeling-cluster layout (NOT UMAP).
  const feelingLayout = buildFeelingLayout(memories);

  return {
    sound: toMap(sound),
    social: feelingLayout.map,
    socialClusters: feelingLayout.clusters
  };
}

// Compute a "Me & Friends" sound layout over a filtered subset.
export function computeFriendsLayout(memories) {
  const sound = runUmap(memories, buildSoundVectors(memories), {
    minDist: 0.6, spread: 1.6, maxNeighbors: 10, jitter: 0.08
  });
  return toMap(sound);
}

function toMap({ ids, coords }) {
  const m = new Map();
  ids.forEach((id, i) => m.set(id, coords[i]));
  return m;
}
