// ============================================================================
//  SONDER — SPOTIFY (PKCE auth + search)
// ============================================================================
//  Sections:
//     [CONFIG]      client ID, redirect URI, scopes
//     [PKCE]        generate verifier + challenge pair
//     [LOGIN]       startLogin() kicks off OAuth flow
//     [CALLBACK]    handleCallback() exchanges code for tokens
//     [REFRESH]     auto-refresh access token when expired
//     [STATUS]      isConnected() / disconnect()
//     [SEARCH]      search Spotify catalog for tracks
// ============================================================================


// ============================================================================
//  [CONFIG]
// ============================================================================
const CLIENT_ID    = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = window.location.origin + '/callback';
const SCOPES       = ''; // search needs no user scopes

// localStorage keys
const K_TOKEN    = 'spotify_token';
const K_REFRESH  = 'spotify_refresh';
const K_EXPIRES  = 'spotify_expires';
const K_VERIFIER = 'spotify_verifier';
const K_RETURN   = 'spotify_return';


// ============================================================================
//  [PKCE]  verifier + challenge
// ============================================================================
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(str) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
}


// ============================================================================
//  [LOGIN]  redirect to Spotify to authorize
// ============================================================================
export async function startLogin() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(await sha256(verifier));
  localStorage.setItem(K_VERIFIER, verifier);
  // Remember where the user was so we can send them back after auth.
  localStorage.setItem(K_RETURN, window.location.hash || '#/log');

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    scope: SCOPES
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params}`;
}


// ============================================================================
//  [CALLBACK]  exchange ?code=... for access + refresh tokens
//              Called once at app boot if URL has ?code= in query string.
// ============================================================================
export async function handleCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const err  = params.get('error');

  if (err) {
    localStorage.removeItem(K_VERIFIER);
    cleanUrl();
    throw new Error(`Spotify auth failed: ${err}`);
  }
  if (!code) return false; // nothing to do

  const verifier = localStorage.getItem(K_VERIFIER);
  if (!verifier) { cleanUrl(); return false; }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier
    })
  });

  localStorage.removeItem(K_VERIFIER);

  if (!res.ok) {
    const text = await res.text();
    cleanUrl();
    throw new Error(`Token exchange failed: ${text}`);
  }

  saveTokens(await res.json());
  cleanUrl();
  return true;
}

function cleanUrl() {
  const returnTo = localStorage.getItem(K_RETURN) || '#/log';
  localStorage.removeItem(K_RETURN);
  // Remove ?code=... from URL and restore the hash the user was on.
  history.replaceState({}, '', '/' + returnTo);
}


// ============================================================================
//  [REFRESH]  auto-refresh access token when expired
// ============================================================================
function saveTokens({ access_token, refresh_token, expires_in }) {
  if (access_token)  localStorage.setItem(K_TOKEN, access_token);
  if (refresh_token) localStorage.setItem(K_REFRESH, refresh_token);
  if (expires_in)    localStorage.setItem(K_EXPIRES, String(Date.now() + (expires_in - 60) * 1000));
}

async function refreshAccessToken() {
  const refresh = localStorage.getItem(K_REFRESH);
  if (!refresh) throw new Error('No Spotify refresh token — reconnect Spotify.');

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refresh
    })
  });
  if (!res.ok) {
    disconnect();
    throw new Error('Spotify session expired — reconnect Spotify.');
  }
  const data = await res.json();
  saveTokens(data);
  return data.access_token;
}

async function getValidToken() {
  const token   = localStorage.getItem(K_TOKEN);
  const expires = Number(localStorage.getItem(K_EXPIRES) || 0);
  if (!token) return null;
  if (Date.now() >= expires) return refreshAccessToken();
  return token;
}


// ============================================================================
//  [STATUS]  connection state helpers
// ============================================================================
export function isConnected() {
  return !!localStorage.getItem(K_TOKEN);
}

export function disconnect() {
  localStorage.removeItem(K_TOKEN);
  localStorage.removeItem(K_REFRESH);
  localStorage.removeItem(K_EXPIRES);
  localStorage.removeItem(K_VERIFIER);
  localStorage.removeItem(K_RETURN);
}


// ============================================================================
//  [GENRES]  fetch an artist's genres for the "sound" similarity signal
// ============================================================================
//  We use artist genres rather than /audio-features because Spotify deprecated
//  audio-features for new API apps in Nov 2024. Genres still work fine and
//  carry strong semantic signal ("bedroom pop" clusters with "indie pop", etc.)
//
//  Returns an array of lowercase genre strings. Empty array if the artist has
//  no genres (common for very new or obscure artists).
// ============================================================================
export async function getArtistGenres(artistId) {
  const token = await getValidToken();
  if (!token) throw new Error('Not connected to Spotify.');

  const res = await fetch(`https://api.spotify.com/v1/artists/${artistId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.status === 401) { disconnect(); throw new Error('Spotify session expired — reconnect Spotify.'); }
  if (!res.ok) throw new Error(`Spotify artist error: ${res.status}`);

  const d = await res.json();
  return (d.genres ?? []).map((g) => g.toLowerCase());
}


// ============================================================================
//  [SEARCH]  search Spotify catalog for tracks
// ============================================================================
export async function searchTracks(query, limit = 8) {
  const token = await getValidToken();
  if (!token) throw new Error('Not connected to Spotify.');

  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 401) {
    // Token rejected even after refresh — force reconnect.
    disconnect();
    throw new Error('Spotify session expired — reconnect Spotify.');
  }
  if (!res.ok) throw new Error(`Spotify error: ${res.status}`);

  const data = await res.json();
  // Normalize — Firestore rejects `undefined`.
  return data.tracks.items.map((t) => ({
    spotifyId:  t.id ?? null,
    name:       t.name ?? '',
    artists:    t.artists?.map((a) => a.name) ?? [],
    artistId:   t.artists?.[0]?.id ?? null,   // first artist — used for genre fetch
    albumArt:   t.album?.images?.[0]?.url ?? null,
    previewUrl: t.preview_url ?? null
  }));
}
