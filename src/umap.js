// ============================================================================
//  SONDER — UMAP LAYOUTS (three signals: sound + feels + me & friends)
// ============================================================================
//  Sections:
//     [FETCH]      ensure every memory has cached genre list
//     [VECTORS]    build the input matrix for each signal
//     [RUN]        runUmap — call umap-js, return 3D coords scaled for Three.js
//     [GENRES]     compute genre-anchor labels (centroid of each top-K genre)
//     [FEELINGS]   feel-cluster layout (≥5 clusters, fixed sphere centers)
//     [PIPELINE]   computeLayouts — one call, returns maps + label data
// ============================================================================
//
//  Layouts produced:
//    • sound        — UMAP of multi-hot Spotify genre + artist-id fallback
//                     + genreLabels[]: top-K genres positioned at their centroids
//    • feels        — feel-cluster layout: ≥5 anchor clusters with distinct
//                     colors. Every memory is assigned to a cluster (memories
//                     without feelings get hash-distributed so they spread).
//                     Returns clusters[], membership map (memId → clusterIdx).
//    • myFriends    — UMAP restricted to me+friends subset, with its OWN
//                     genre labels recomputed against just that subset.
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
  const validIdxs = [];
  for (let i = 0; i < memories.length; i++) {
    if (Array.isArray(vectors[i]) && vectors[i].length > 0) {
      ids.push(memories[i].id);
      validIdxs.push(i);
      valid.push(vectors[i].map((v) => v + (Math.random() - 0.5) * jitter));
    }
  }
  if (valid.length < 2) return { ids, coords: valid.map(() => [0, 0, 0]), validIdxs };

  const nNeighbors = Math.max(2, Math.min(maxNeighbors, valid.length - 1));
  const umap = new UMAP({ nComponents: 3, nNeighbors, minDist, spread });
  let raw;
  try {
    raw = umap.fit(valid);
  } catch (e) {
    console.warn('[umap] fit failed, falling back to zeros:', e.message);
    return { ids, coords: valid.map(() => [0, 0, 0]), validIdxs };
  }
  raw = raw.map((c) => c.map((v) => Number.isFinite(v) ? v : 0));
  return { ids, coords: normalize(raw), validIdxs };
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
//  [GENRES]  Genre anchor labels = centroid of all memories with that genre
// ============================================================================
//  After UMAP places memories, find the top-K most common genres and put
//  a floating label at the average position of memories carrying that genre.
//  Side benefit: the user can read which "side" of the cloud means what.
// ============================================================================
const MAX_GENRE_LABELS = 6;

function computeGenreLabels(memories, layoutMap) {
  // Count genre frequency across memories that actually got placed.
  const counts = new Map();
  for (const m of memories) {
    if (!layoutMap.has(m.id)) continue;
    for (const g of (m.genres || [])) {
      counts.set(g, (counts.get(g) || 0) + 1);
    }
  }
  if (counts.size === 0) return [];

  // Pick top-K, but require at least 2 memories per genre so a one-off doesn't
  // dominate a corner of the map.
  const top = [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_GENRE_LABELS)
    .map(([g]) => g);
  if (top.length === 0) return [];

  return top.map((genre) => {
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const m of memories) {
      if (!(m.genres || []).includes(genre)) continue;
      const c = layoutMap.get(m.id);
      if (!c) continue;
      sx += c[0]; sy += c[1]; sz += c[2]; n++;
    }
    if (!n) return null;
    return { genre, x: sx / n, y: sy / n, z: sz / n, count: n };
  }).filter(Boolean);
}


// ============================================================================
//  [FEELINGS]  Guaranteed ≥5 clusters with colors and full memory membership
// ============================================================================
//  Why this exists:
//    • Reviewer feedback: "make sure there's at least 5 clusters, each with
//      a different color, and a label that appears on hover".
//    • Old behavior dumped memories with no feelings at the origin → they all
//      collapsed into one ball. Now every memory gets assigned to a cluster
//      (hash-fallback distributes ones without feelings across the 5+).
// ============================================================================
const MIN_CLUSTERS = 5;
const MAX_CLUSTERS = 10;

// Default feelings used to top-up the cluster list when the corpus has < 5
// distinct top feelings. These read clearly and span the emotional range.
const DEFAULT_FEELINGS = [
  'nostalgic', 'euphoric', 'melancholy', 'calm', 'hopeful',
  'heartbroken', 'energized', 'tender', 'lonely', 'rage'
];

// 10-color palette tuned for cream background (saturated but not garish).
const CLUSTER_PALETTE = [
  '#d94f3c', // editorial red
  '#3c8ad9', // cobalt
  '#c89a2e', // gold
  '#5fa863', // sage green
  '#9b59b6', // amethyst
  '#e67e22', // tangerine
  '#1abc9c', // teal
  '#c2185b', // raspberry
  '#34495e', // slate
  '#7d6f3d'  // olive
];

function topFeelings(memories) {
  const counts = new Map();
  for (const m of memories) {
    for (const f of (m.feelings || [])) counts.set(f, (counts.get(f) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CLUSTERS)
    .map(([f]) => f);
}

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

// Stable hash (djb2) — map any string to a small integer for fallback assignment.
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function buildFeelingLayout(memories) {
  // 1) Pick base cluster set from corpus; pad with defaults to hit MIN_CLUSTERS.
  const fromCorpus = topFeelings(memories);
  const all = [...fromCorpus];
  for (const d of DEFAULT_FEELINGS) {
    if (all.length >= MIN_CLUSTERS) break;
    if (!all.includes(d)) all.push(d);
  }
  const tops = all.slice(0, MAX_CLUSTERS);
  const topSet = new Map(tops.map((f, i) => [f, i]));

  // 2) Place cluster centers on a sphere with a generous radius.
  const RADIUS = 7;
  const centers = fibonacciSphere(tops.length, RADIUS);
  const clusters = tops.map((feeling, i) => ({
    feeling,
    x: centers[i][0],
    y: centers[i][1],
    z: centers[i][2],
    color: CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]
  }));

  // 3) Assign every memory to a cluster + position with jitter.
  const map = new Map();
  const membership = new Map();
  for (const m of memories) {
    const fs = (m.feelings || []).filter((f) => topSet.has(f));
    let clusterIdx;
    if (fs.length) {
      // Pick the first matching feeling (already in user's importance order).
      clusterIdx = topSet.get(fs[0]);
    } else {
      // Hash-distribute: spreads memoryless-feeling memories across clusters
      // instead of dumping them at the origin.
      clusterIdx = hashStr(m.id || '') % tops.length;
    }
    membership.set(m.id, clusterIdx);
    const c = centers[clusterIdx];
    // Jitter within a small radius around the cluster center; keep clusters
    // visually distinct but not pancake-flat.
    const jr = 1.1;
    map.set(m.id, [
      c[0] + (Math.random() - 0.5) * 2 * jr,
      c[1] + (Math.random() - 0.5) * 2 * jr,
      c[2] + (Math.random() - 0.5) * 2 * jr
    ]);
  }

  return { map, clusters, membership };
}


// ============================================================================
//  [PIPELINE]  one entry point — cache genres, then build all signals
// ============================================================================
export async function computeLayouts(memories, onProgress = () => {}) {
  await cacheGenres(memories, onProgress);

  onProgress({ stage: 'umap' });

  // Sound: loose UMAP across genre vectors + genre-centroid labels.
  const soundRun = runUmap(memories, buildSoundVectors(memories), {
    minDist: 0.8, spread: 1.8, maxNeighbors: 8, jitter: 0.1
  });
  const soundMap = toMap(soundRun);
  const soundGenres = computeGenreLabels(memories, soundMap);

  // Feels: cluster layout (≥5 clusters guaranteed).
  const feelingLayout = buildFeelingLayout(memories);

  return {
    sound: soundMap,
    soundGenres,
    feels: feelingLayout.map,
    feelsClusters: feelingLayout.clusters,
    feelsMembership: feelingLayout.membership
  };
}

// "Me & Friends" — UMAP over the subset, with subset-specific genre labels.
export function computeFriendsLayout(memories) {
  const run = runUmap(memories, buildSoundVectors(memories), {
    minDist: 0.6, spread: 1.6, maxNeighbors: 10, jitter: 0.08
  });
  const map = toMap(run);
  const genres = computeGenreLabels(memories, map);
  return { map, genres };
}

function toMap({ ids, coords }) {
  const m = new Map();
  ids.forEach((id, i) => m.set(id, coords[i]));
  return m;
}
