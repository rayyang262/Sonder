// ============================================================================
//  SONDER — UMAP LAYOUTS (two signals: sound + social)
// ============================================================================
//  Sections:
//     [FETCH]     ensure every memory has cached genre list
//     [VECTORS]   build the input matrix for each signal
//     [RUN]       runUmap — call umap-js, return 3D coords scaled for Three.js
//     [PIPELINE]  computeLayouts — one call, returns maps for both signals
// ============================================================================
//
//  Two signals, two separate UMAP runs:
//    • sound   — multi-hot genre vector from the track's first artist.
//                Built from the union of all genres across public memories.
//    • social  — binary vector of which users ALSO logged this song.
//                Same-song memories share a row → they cluster.
//
//  Output per signal: Map<memoryId, [x, y, z]> in the Three.js ±6 box.
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
    if (Array.isArray(m.genres)) continue;       // already cached
    const artistId = m.song?.artistId;
    if (!artistId) { m.genres = []; continue; }  // can't fetch without id
    try {
      const g = await getArtistGenres(artistId);
      m.genres = g;                               // mutate in place
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

// Sound: multi-hot genre encoding + artist-id fallback columns so memories
// with no Spotify genres still carry signal (same artist → still cluster).
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

// Social: binary co-logger vector (who else logged this song) BLENDED with
// the user's taste profile (their full genre distribution). Taste blending
// pulls users with overlapping taste toward each other even when they
// haven't logged the same exact tracks → more intertwining.
function buildSocialVectors(memories) {
  const users = [...new Set(memories.map((m) => m.uid).filter(Boolean))];
  const userIdx = new Map(users.map((u, i) => [u, i]));

  const loggersBySong = new Map();
  for (const m of memories) {
    const s = m.song?.spotifyId;
    if (!s) continue;
    if (!loggersBySong.has(s)) loggersBySong.set(s, new Set());
    loggersBySong.get(s).add(m.uid);
  }

  // Per-user taste profile: normalized genre counts across all their memories.
  const genreVocab = new Map();
  for (const m of memories) for (const g of (m.genres || [])) {
    if (!genreVocab.has(g)) genreVocab.set(g, genreVocab.size);
  }
  const G = genreVocab.size;
  const tasteByUser = new Map();
  for (const u of users) tasteByUser.set(u, new Array(G).fill(0));
  for (const m of memories) {
    if (!m.uid) continue;
    const t = tasteByUser.get(m.uid);
    if (!t) continue;
    for (const g of (m.genres || [])) {
      const i = genreVocab.get(g);
      if (i !== undefined) t[i] += 1;
    }
  }
  // L2-normalize each user's taste vector.
  for (const [u, t] of tasteByUser) {
    const n = Math.sqrt(t.reduce((s, v) => s + v * v, 0)) || 1;
    tasteByUser.set(u, t.map((v) => v / n));
  }

  // Final row = [co-logger bits | blended taste of that memory's user].
  // Taste block is down-weighted so co-logging still dominates but
  // similar-taste users aren't fully disjoint.
  const TASTE_WEIGHT = 0.5;
  return memories.map((m) => {
    const userRow = new Array(users.length).fill(0);
    const loggers = loggersBySong.get(m.song?.spotifyId);
    if (loggers) for (const u of loggers) if (userIdx.has(u)) userRow[userIdx.get(u)] = 1;

    const taste = (m.uid && tasteByUser.get(m.uid)) || new Array(G).fill(0);
    return [...userRow, ...taste.map((v) => v * TASTE_WEIGHT)];
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
//  [PIPELINE]  one entry point — cache genres, then two UMAP runs
// ============================================================================
export async function computeLayouts(memories, onProgress = () => {}) {
  await cacheGenres(memories, onProgress);

  onProgress({ stage: 'umap' });
  // Sound: loose params so genre clusters spread out instead of collapsing.
  const sound  = runUmap(memories, buildSoundVectors(memories), {
    minDist: 0.8, spread: 1.8, maxNeighbors: 8, jitter: 0.1
  });
  // Social: tighter minDist + more neighbors so similar-taste users intertwine
  // instead of forming disconnected bubbles.
  const social = runUmap(memories, buildSocialVectors(memories), {
    minDist: 0.15, spread: 1.2, maxNeighbors: 20, jitter: 0.05
  });

  return { sound: toMap(sound), social: toMap(social) };
}

function toMap({ ids, coords }) {
  const m = new Map();
  ids.forEach((id, i) => m.set(id, coords[i]));
  return m;
}
