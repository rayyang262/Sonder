// ============================================================================
//  SONDER — preview audio resolver
// ============================================================================
//  Spotify's `preview_url` is `null` for most tracks since Nov 2024 (same
//  deprecation wave as audio-features). We fall back to the iTunes Search
//  API, which is free, CORS-open, and returns a 30s .m4a preview for
//  nearly every mainstream song.
//
//  Resolution order:
//    1. song.previewUrl (Spotify, when available)
//    2. iTunes Search API lookup by "name artist"
//
//  Results are cached in-memory keyed by Spotify id (or name|artist fallback).
// ============================================================================

const cache = new Map();

export async function fetchPreview(song) {
  if (!song) return null;
  const key = song.spotifyId || `${song.name || ''}|${song.artists?.[0] || ''}`;
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);

  // 1) Trust Spotify if it actually gave us something.
  if (song.previewUrl) { cache.set(key, song.previewUrl); return song.previewUrl; }

  // 2) iTunes fallback.
  const q = `${song.name || ''} ${song.artists?.[0] || ''}`.trim();
  if (!q) { cache.set(key, null); return null; }
  try {
    const res = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&entity=song&limit=1`
    );
    if (!res.ok) { cache.set(key, null); return null; }
    const data = await res.json();
    const url = data.results?.[0]?.previewUrl || null;
    cache.set(key, url);
    return url;
  } catch {
    cache.set(key, null);
    return null;
  }
}
