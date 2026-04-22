// ============================================================================
//  SONDER — ALL SCREENS
// ============================================================================
//  Use ctrl-F (cmd-F) to jump to a section:
//     [LOGIN]      sign in / sign up
//     [FEED]       your own memories
//     [LOG]        log a new memory (Spotify search + form)
//     [MEMORY]     single memory detail + comments
//     [DISCOVERY]  Three.js constellation
//     [PROFILE]    account info + sign out
// ============================================================================

import {
  auth, logout,
  signInEmail, signUpEmail, signInGoogle,
  createMemory, getMyMemories, getMemory, getPublicMemories, getFeedMemories,
  addComment, getComments
} from './firebase.js';
import { searchTracks, startLogin, isConnected, disconnect } from './spotify.js';
import { fetchPreview } from './preview.js';
import { navigate } from './main.js';
import { seedAll } from './seed.js';
import * as THREE from 'three';

// ----------------------------------------------------------------------------
// shared helper — escape user-provided strings before injecting into HTML
// ----------------------------------------------------------------------------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}


// ============================================================================
//  [LOGIN]  sign in / sign up
// ============================================================================
export function renderLogin(root) {
  root.innerHTML = `
    <h1>Sonder</h1>
    <p style="color: var(--text-dim); margin-bottom: 2rem;">
      A place for the songs that mean something.
    </p>

    <div class="card">
      <label>Email</label>
      <input id="email" type="email" placeholder="you@example.com" />
      <label>Password</label>
      <input id="password" type="password" placeholder="••••••••" />
      <div id="err" class="error"></div>
      <div style="display: flex; gap: 0.5rem;">
        <button id="signin">Sign in</button>
        <button id="signup" class="ghost">Create account</button>
      </div>
      <div style="margin-top: 1rem; text-align: center; color: var(--text-dim);">— or —</div>
      <button id="google" class="ghost" style="width: 100%; margin-top: 1rem;">Continue with Google</button>
    </div>
  `;

  const err = root.querySelector('#err');
  const showErr = (e) => { err.textContent = e.message || String(e); };
  const email = () => root.querySelector('#email').value;
  const pw = () => root.querySelector('#password').value;

  root.querySelector('#signin').onclick = async () => {
    err.textContent = '';
    try { await signInEmail(email(), pw()); } catch (e) { showErr(e); }
  };
  root.querySelector('#signup').onclick = async () => {
    err.textContent = '';
    try { await signUpEmail(email(), pw()); } catch (e) { showErr(e); }
  };
  root.querySelector('#google').onclick = async () => {
    err.textContent = '';
    try { await signInGoogle(); } catch (e) { showErr(e); }
  };
}


// ============================================================================
//  [FEED]  your own memories + everyone else's public ones, newest first
// ============================================================================
export async function renderFeed(root) {
  // full-bleed: break out of #app's max-width so the vinyl can hang off
  // the left viewport edge
  root.style.maxWidth = 'none';
  root.style.padding  = '0';

  root.innerHTML = `
    <div class="feed-page">
      <div class="vinyl-wrap">
        <div class="vinyl-ring"></div>
        <div id="vinyl" class="vinyl">
          <div class="label" id="vinylLabel">
            <span class="label-text">SONDER</span>
          </div>
          <div class="spindle"></div>
        </div>
        <div class="vinyl-time" id="vinylTime">00:00 / 00:30</div>
      </div>

      <div class="feed-content">
        <div class="feed-header">
          <div>
            <div class="mini">S/M</div>
            <div class="sub">Sonder · music memories</div>
          </div>
          <div class="right">
            <div class="mini">SONDER</div>
            <div class="sub">Music streaming</div>
          </div>
        </div>

        <div class="track-col">
          <div class="focus-mini" id="focusMini">NOW FOCUSED</div>
          <h1 class="focus-title" id="focusTitle">HOVER A MEMORY</h1>
          <div class="focus-sub" id="focusSub">Hover a row — preview plays · click to open</div>

          <div class="track-list-heading">FEED</div>
          <div id="list">Loading…</div>
          <div class="view-more" id="viewMore"></div>
        </div>

        <div class="feed-footer">
          BEST TRENDS
          <div class="sub">Sonder / ${new Date().getFullYear()}</div>
        </div>
      </div>
    </div>

    <audio id="feedAudio" preload="none" style="display: none;"></audio>
  `;

  const list        = root.querySelector('#list');
  const vinyl       = root.querySelector('#vinyl');
  const vinylLabel  = root.querySelector('#vinylLabel');
  const vinylTime   = root.querySelector('#vinylTime');
  const focusTitle  = root.querySelector('#focusTitle');
  const focusSub    = root.querySelector('#focusSub');
  const focusMini   = root.querySelector('#focusMini');
  const viewMore    = root.querySelector('#viewMore');
  const audioEl     = root.querySelector('#feedAudio');
  audioEl.volume    = 0.45;

  audioEl.addEventListener('error', () => {
    vinylTime.textContent = 'AUDIO ERROR';
    vinyl.classList.remove('playing');
  });

  const currentUid = auth.currentUser?.uid;

  let memories = [];
  try {
    memories = await getFeedMemories();
  } catch (e) {
    list.innerHTML = `<div class="error">${esc(e.message)}</div>`;
    return;
  }
  if (memories.length === 0) {
    list.innerHTML = `<div class="empty">Nothing yet. <a href="#/log">Log your first memory →</a></div>`;
    return;
  }

  // Render up to 8 rows; overflow summarised in view-more.
  const SHOWN = Math.min(8, memories.length);
  list.innerHTML = memories.slice(0, SHOWN).map((m, i) => trackRow(m, i, currentUid)).join('');
  viewMore.textContent = memories.length > SHOWN ? `— ${memories.length - SHOWN} more` : '';

  // Focus the first row by default so the page isn't empty on load.
  setFocus(memories[0], 0, { autoplay: false });

  // Wire hover → focus/preview, click → open memory.
  list.querySelectorAll('.track').forEach((row) => {
    const idx = Number(row.dataset.idx);
    row.addEventListener('mouseenter', () => setFocus(memories[idx], idx, { autoplay: true }));
    row.addEventListener('click', () => navigate(`/memory/${memories[idx].id}`));
  });
  // Stop preview when cursor leaves the list entirely.
  list.addEventListener('mouseleave', () => stopPreview());

  function setFocus(m, idx, { autoplay }) {
    list.querySelectorAll('.track').forEach((r) => r.classList.toggle('active', Number(r.dataset.idx) === idx));

    const song = m.song?.name || 'Untitled';
    const artist = (m.song?.artists || []).join(', ') || 'Unknown artist';
    focusTitle.textContent = artist.toUpperCase();
    focusSub.innerHTML   = `${esc(song).toUpperCase()} · ${m.date ? new Date(m.date).toLocaleDateString() : ''}`;
    focusMini.textContent = (m.uid === currentUid ? 'YOUR MEMORY' : `FROM ${(m.authorName || m.authorEmail || 'someone').toUpperCase()}`);

    // Swap label art + trigger spin-kick animation so the record visibly
    // "re-drops" each time a new song is focused.
    if (m.song?.albumArt) {
      vinylLabel.innerHTML = `<img src="${esc(m.song.albumArt)}" alt="" />`;
    } else {
      vinylLabel.innerHTML = `<span class="label-text">${esc(song).slice(0, 12).toUpperCase()}</span>`;
    }
    vinyl.classList.remove('kick');
    // force reflow to restart animation
    void vinyl.offsetWidth;
    vinyl.classList.add('kick');

    if (autoplay) playPreview(m);
  }

  let currentAudioId = null;
  async function playPreview(m) {
    if (currentAudioId === m.id) return;
    currentAudioId = m.id;
    vinylTime.textContent = 'LOADING…';
    let url;
    try {
      url = await fetchPreview(m.song);
    } catch (e) {
      console.warn('[preview] fetch failed:', e);
      vinylTime.textContent = 'LOOKUP FAILED';
      return;
    }
    if (currentAudioId !== m.id) return;  // user moved on while fetching
    if (!url) {
      console.log('[preview] no URL found for:', m.song?.name, m.song?.artists);
      vinylTime.textContent = 'NO PREVIEW';
      vinyl.classList.remove('playing');
      return;
    }
    console.log('[preview] playing:', m.song?.name, '→', url);
    audioEl.src = url;
    audioEl.currentTime = 0;
    try {
      await audioEl.play();
      vinyl.classList.add('playing');
    } catch (e) {
      console.warn('[preview] play() rejected:', e.name, e.message);
      if (e.name === 'NotAllowedError') {
        vinylTime.textContent = 'CLICK ANYWHERE TO ENABLE';
      } else {
        vinylTime.textContent = 'PLAY FAILED';
      }
      vinyl.classList.remove('playing');
    }
  }
  function stopPreview() {
    if (currentAudioId === null) return;
    currentAudioId = null;
    audioEl.pause();
    audioEl.removeAttribute('src');
    vinyl.classList.remove('playing');
    vinylTime.textContent = '00:00 / 00:30';
  }
  audioEl.addEventListener('timeupdate', () => {
    const cur = Math.floor(audioEl.currentTime);
    const dur = Math.floor(audioEl.duration || 30);
    const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    vinylTime.textContent = `${fmt(cur)} / ${fmt(dur)}`;
  });
  audioEl.addEventListener('ended', () => { vinyl.classList.remove('playing'); });
}

function trackRow(m, i, currentUid) {
  const artists = m.song?.artists?.join(', ') || '';
  const isMine = m.uid === currentUid;
  const author = isMine ? 'YOU' : (m.authorName || m.authorEmail || 'someone').toUpperCase();
  const num = String(i + 1).padStart(2, '0');
  const thumb = m.song?.albumArt
    ? `<img class="thumb" src="${esc(m.song.albumArt)}" alt="" />`
    : `<div class="thumb"></div>`;
  return `
    <div class="track" data-idx="${i}">
      <div class="num">${num}</div>
      ${thumb}
      <div class="info">
        <div class="song">${esc(m.song?.name || 'Untitled')}</div>
        <div class="artist">${esc(artists)}</div>
      </div>
      <div class="meta">${esc(author)}</div>
    </div>`;
}


// ============================================================================
//  [LOG]  log a new memory (Spotify search + form)
// ============================================================================
let selectedSong = null;

export function renderLog(root) {
  selectedSong = null;
  root.innerHTML = `
    <h1>Log a memory</h1>

    ${isConnected() ? '' : `
      <div class="card">
        <label>Connect Spotify to search songs</label>
        <button id="connectSpotify">Connect Spotify</button>
      </div>`}

    <div class="card">
      <label>Search a song</label>
      <input id="search" type="text" placeholder="Try: 'sweater weather'" ${isConnected() ? '' : 'disabled'} />
      <div id="results"></div>
    </div>

    <div class="card">
      <label>The memory</label>
      <textarea id="note" placeholder="What was happening? Who was there?"></textarea>

      <label>Where</label>
      <input id="location" type="text" placeholder="City, place, room — anything" />

      <label>When</label>
      <input id="date" type="date" />

      <div class="toggle-row">
        <input id="isPublic" type="checkbox" checked />
        <label for="isPublic" style="margin: 0;">Make this public (default)</label>
      </div>

      <div id="err" class="error"></div>
      <button id="save">Save memory</button>
    </div>
  `;

  // default date = today
  root.querySelector('#date').value = new Date().toISOString().slice(0, 10);

  // Spotify connect button (if not connected)
  const connectBtn = root.querySelector('#connectSpotify');
  if (connectBtn) {
    connectBtn.onclick = () => startLogin();
  }

  // debounced spotify search
  let timer;
  root.querySelector('#search').oninput = (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    const results = root.querySelector('#results');
    if (!q) { results.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      results.innerHTML = 'Searching…';
      try {
        const tracks = await searchTracks(q);
        results.innerHTML = tracks.map((t, i) => `
          <div class="card" data-i="${i}" style="cursor: pointer; display: flex; gap: 0.75rem; align-items: center;">
            ${t.albumArt ? `<img src="${t.albumArt}" width="48" height="48" style="border-radius: 6px;" />` : ''}
            <div>
              <div class="song">${esc(t.name)}</div>
              <div class="meta">${esc(t.artists.join(', '))}</div>
            </div>
          </div>`).join('');
        results.querySelectorAll('[data-i]').forEach((el) => {
          el.onclick = () => {
            selectedSong = tracks[Number(el.dataset.i)];
            results.innerHTML = `
              <div class="card" style="border-color: var(--accent);">
                <div class="meta">selected</div>
                <div class="song">${esc(selectedSong.name)}</div>
                <div class="meta">${esc(selectedSong.artists.join(', '))}</div>
              </div>`;
          };
        });
      } catch (err) {
        results.innerHTML = `<div class="error">${esc(err.message)}</div>`;
      }
    }, 300);
  };

  // save memory
  root.querySelector('#save').onclick = async () => {
    const err = root.querySelector('#err');
    err.textContent = '';
    if (!selectedSong) { err.textContent = 'Pick a song first.'; return; }
    try {
      await createMemory({
        song: selectedSong,
        note: root.querySelector('#note').value.trim(),
        location: root.querySelector('#location').value.trim(),
        photoUrl: null, // photo upload comes later
        date: root.querySelector('#date').value,
        isPublic: root.querySelector('#isPublic').checked
      });
      navigate('/');
    } catch (e) {
      err.textContent = e.message;
    }
  };
}


// ============================================================================
//  [MEMORY]  single memory detail + comments
// ============================================================================
export async function renderMemory(root, id) {
  if (!id) { root.innerHTML = `<div class="empty">No memory selected.</div>`; return; }
  root.innerHTML = `Loading…`;

  try {
    const m = await getMemory(id);
    if (!m) { root.innerHTML = `<div class="empty">Not found.</div>`; return; }

    const artists = m.song?.artists?.join(', ') || '';
    const date = m.date ? new Date(m.date).toLocaleDateString() : '';

    root.innerHTML = `
      <a href="#/" style="color: var(--text-dim);">← back</a>
      <h1 style="margin-top: 1rem;">${esc(m.song?.name || 'Untitled')}</h1>
      <div class="meta" style="margin-bottom: 1rem;">
        ${esc(artists)} · ${date} · ${esc(m.location || 'somewhere')}
      </div>
      ${m.note ? `<p style="font-style: italic; color: var(--text-dim);">"${esc(m.note)}"</p>` : ''}

      ${m.isPublic ? `
        <h2 style="margin-top: 2rem;">Comments</h2>
        <div id="comments">Loading…</div>
        <div class="card" style="margin-top: 1rem;">
          <textarea id="commentText" placeholder="Say something…"></textarea>
          <button id="postComment">Post</button>
        </div>
      ` : `<p class="empty">Private memory · only visible to you.</p>`}
    `;

    if (m.isPublic) {
      const list = root.querySelector('#comments');
      const refresh = async () => {
        const comments = await getComments(id);
        list.innerHTML = comments.length === 0
          ? `<div class="empty">No comments yet.</div>`
          : comments.map((c) => `
              <div class="card">
                <div class="meta">${esc(c.email || 'someone')}</div>
                <div>${esc(c.text)}</div>
              </div>`).join('');
      };
      refresh();
      root.querySelector('#postComment').onclick = async () => {
        const text = root.querySelector('#commentText').value.trim();
        if (!text) return;
        await addComment(id, text);
        root.querySelector('#commentText').value = '';
        refresh();
      };
    }
  } catch (e) {
    root.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}


// ============================================================================
//  [DISCOVERY]  Full-page Three.js constellation, OrbitControls + raycasting
// ============================================================================
//  Interactions:
//    • Drag       — orbit the camera around the cloud
//    • Scroll     — zoom in/out
//    • Hover      — floating preview card (album art + song + author)
//    • Click      — navigate to that memory's detail page
//  Two toggles (top-left overlay):
//    • Sound  — UMAP of Spotify audio-features
//    • Social — UMAP of user-co-occurrence
// ============================================================================
import { computeLayouts } from './umap.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let discoveryAnimationId = null;
let discoveryCleanup = null;  // tear down listeners when navigating away

const USER_COLORS = [
  [0xb7 / 255, 0x94 / 255, 0xff / 255],
  [0xff / 255, 0x7a / 255, 0xb8 / 255],
  [0x7a / 255, 0xdf / 255, 0xff / 255],
  [0xff / 255, 0xd6 / 255, 0x6e / 255],
  [0x9b / 255, 0xff / 255, 0x7a / 255],
  [0xff / 255, 0x9f / 255, 0x6e / 255],
  [0xa1 / 255, 0xff / 255, 0x9e / 255]
];

export async function renderDiscovery(root) {
  // tear down previous instance
  if (discoveryAnimationId) cancelAnimationFrame(discoveryAnimationId);
  if (discoveryCleanup) { discoveryCleanup(); discoveryCleanup = null; }

  // full-bleed: neutralize #app's max-width + padding for this screen
  root.style.maxWidth = 'none';
  root.style.padding  = '0';

  root.innerHTML = `
    <div id="discWrap" style="position: fixed; inset: 60px 0 0 0; background: #02030a; overflow: hidden;">
      <div id="discCanvas" style="position: absolute; inset: 0;"></div>

      <div id="discOverlay" style="position: absolute; top: 1rem; left: 1rem; display: flex; flex-direction: column; gap: 0.6rem; z-index: 2; max-width: 320px;">
        <div style="display: flex; gap: 0.5rem; align-items: center;">
          <button id="sigSound"  class="toggle active">Sound</button>
          <button id="sigSocial" class="toggle">Social</button>
          <span id="discoveryStatus" style="color: var(--text-dim); font-size: 0.85rem; margin-left: 0.25rem;"></span>
        </div>
        <div id="sigExplain" style="background: rgba(10,10,20,0.72); border: 1px solid var(--border); border-radius: 8px; padding: 0.6rem 0.75rem; color: var(--text-dim); font-size: 0.78rem; line-height: 1.4; backdrop-filter: blur(8px);"></div>
      </div>

      <div id="discLegend" style="position: absolute; top: 1rem; right: 1rem; z-index: 2; background: rgba(10,10,20,0.72); border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem 0.75rem; font-size: 0.75rem; color: var(--text-dim); backdrop-filter: blur(8px); line-height: 1.6;">
        <div><span style="display:inline-block; width:12px; height:12px; border-radius:50%; background:#ffffff; box-shadow:0 0 8px #fff; vertical-align:middle; margin-right:6px;"></span>your memories</div>
        <div><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#b794ff; vertical-align:middle; margin-right:8px; margin-left:2px;"></span>others' memories</div>
        <div><span style="display:inline-block; width:14px; height:14px; border-radius:50%; border:2px solid #ffd66e; vertical-align:middle; margin-right:5px;"></span>song you share with others</div>
      </div>

      <div id="discHint" style="position: absolute; bottom: 1rem; left: 1rem; color: var(--text-dim); font-size: 0.8rem; z-index: 2;">
        drag to orbit · scroll to zoom · hover a star · click to open
      </div>

      <div id="discTip" style="position: absolute; pointer-events: none; display: none; background: rgba(10,10,20,0.92); border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem; z-index: 3; max-width: 220px; font-size: 0.8rem; backdrop-filter: blur(8px);"></div>

      <audio id="discAudio" preload="none" style="display: none;"></audio>
    </div>
  `;

  const wrap    = root.querySelector('#discWrap');
  const canvas  = root.querySelector('#discCanvas');
  const tip     = root.querySelector('#discTip');
  const status  = root.querySelector('#discoveryStatus');
  const setStatus = (t) => { status.textContent = t; };

  // --- fetch memories ---
  let memories = [];
  try { memories = await getPublicMemories(); } catch (e) { /* empty */ }

  // --- scene scaffolding (set up even if empty so we have something to show) ---
  const w = () => wrap.clientWidth;
  const h = () => wrap.clientHeight;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, w() / h(), 0.1, 1000);
  camera.position.set(0, 0, 14);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w(), h());
  renderer.setPixelRatio(window.devicePixelRatio);
  canvas.appendChild(renderer.domElement);
  addStars(scene);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.enablePan = false;
  controls.minDistance = 3;
  controls.maxDistance = 40;

  // resize handling
  const onResize = () => {
    camera.aspect = w() / h();
    camera.updateProjectionMatrix();
    renderer.setSize(w(), h());
  };
  window.addEventListener('resize', onResize);

  if (memories.length < 2) {
    setStatus('Not enough memories yet — log some (or seed demo data in Profile).');
    const basicAnimate = () => {
      if (!document.body.contains(renderer.domElement)) {
        if (discoveryCleanup) { discoveryCleanup(); discoveryCleanup = null; }
        return;
      }
      discoveryAnimationId = requestAnimationFrame(basicAnimate);
      controls.update();
      renderer.render(scene, camera);
    };
    basicAnimate();
    discoveryCleanup = () => {
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      root.style.maxWidth = '';
      root.style.padding  = '';
    };
    return;
  }

  // --- genres + UMAP ---
  setStatus('Loading genre data…');
  let layouts;
  try {
    layouts = await computeLayouts(memories, ({ stage, done, total }) => {
      if (stage === 'genres' && total) setStatus(`Fetching genres ${done}/${total}…`);
      if (stage === 'umap')            setStatus('Running UMAP…');
    });
    setStatus(`${memories.length} memories`);
  } catch (e) {
    setStatus(`Layout failed: ${e.message}`);
    return;
  }

  // --- identify groups: mine vs others, plus "crossings" (songs logged by >1 user) ---
  const myUid = auth.currentUser?.uid || null;
  const uids = [...new Set(memories.map((m) => m.uid))];
  const colorByUid = new Map(uids.map((u, i) => [u, USER_COLORS[i % USER_COLORS.length]]));

  // Crossing = a song (spotifyId) present in memories from 2+ distinct uids.
  const usersBySong = new Map();
  for (const m of memories) {
    const s = m.song?.spotifyId;
    if (!s || !m.uid) continue;
    if (!usersBySong.has(s)) usersBySong.set(s, new Set());
    usersBySong.get(s).add(m.uid);
  }
  const isCrossing = (m) => (usersBySong.get(m.song?.spotifyId)?.size ?? 0) >= 2;

  // Split memories into two categories for separate Points objects.
  const mineIdxs = [];   // indices (into `memories`) belonging to current user
  const otherIdxs = [];  // everyone else
  memories.forEach((m, i) => (m.uid === myUid ? mineIdxs : otherIdxs).push(i));

  const N = memories.length;
  // Shared positions array — we'll copy slices into each Points geometry each frame.
  const positions = new Float32Array(N * 3);

  // Helper to build a Points object over a subset of `memories`.
  function makePoints(subsetIdxs, { size, brighten = 1, opacity = 0.95 }) {
    const k = subsetIdxs.length;
    const pos = new Float32Array(k * 3);
    const col = new Float32Array(k * 3);
    for (let j = 0; j < k; j++) {
      const i = subsetIdxs[j];
      const [r, g, b] = colorByUid.get(memories[i].uid) || [1, 1, 1];
      // Brighten by blending toward white.
      col[j * 3]     = Math.min(1, r + (1 - r) * (brighten - 1));
      col[j * 3 + 1] = Math.min(1, g + (1 - g) * (brighten - 1));
      col[j * 3 + 2] = Math.min(1, b + (1 - b) * (brighten - 1));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color',    new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({
      size, sizeAttenuation: true, vertexColors: true, transparent: true, opacity
    }));
    pts.frustumCulled = false;
    scene.add(pts);
    return { pts, geom: g, idxs: subsetIdxs };
  }

  // Others: small, semi-transparent, user-colored.
  const othersObj = makePoints(otherIdxs, { size: 0.22, brighten: 1, opacity: 0.75 });
  // Mine: noticeably larger, brighter, full opacity — white-tinted user color.
  const mineObj   = makePoints(mineIdxs,  { size: 0.55, brighten: 1.6, opacity: 1.0 });

  // Crossing halos: gold rings behind memories where I've overlapped with others.
  // Only show halos around MY crossings (so the user sees "where I crossed paths").
  const crossIdxs = mineIdxs.filter((i) => isCrossing(memories[i]));
  let haloObj = null;
  if (crossIdxs.length) {
    const k = crossIdxs.length;
    const pos = new Float32Array(k * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({
      size: 1.1, sizeAttenuation: true,
      color: new THREE.Color(0xffd66e),
      transparent: true, opacity: 0.35,
      depthWrite: false
    }));
    pts.frustumCulled = false;
    scene.add(pts);
    haloObj = { pts, geom: g, idxs: crossIdxs };
  }

  // per-user connecting lines — my path brighter, others dim.
  const lineGroups = [];
  for (const uid of uids) {
    const idxs = [];
    memories.forEach((m, i) => { if (m.uid === uid) idxs.push(i); });
    if (idxs.length < 2) continue;
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(idxs.length * 3), 3));
    const [r, g, b] = colorByUid.get(uid);
    const isMine = uid === myUid;
    const mat = new THREE.LineBasicMaterial({
      color: isMine ? new THREE.Color(1, 1, 1) : new THREE.Color(r, g, b),
      transparent: true,
      opacity: isMine ? 0.55 : 0.12
    });
    const line = new THREE.Line(lineGeom, mat);
    scene.add(line);
    lineGroups.push({ idxs, lineGeom });
  }

  // --- layout state ---
  const currentPos = new Map();
  const targetPos  = new Map();
  function applyLayout(name) {
    const map = layouts[name];
    for (const m of memories) {
      const c = map.get(m.id) || [0, 0, 0];
      targetPos.set(m.id, { x: c[0], y: c[1], z: c[2] });
      if (!currentPos.has(m.id)) currentPos.set(m.id, { x: c[0], y: c[1], z: c[2] });
    }
  }
  const EXPLAIN = {
    sound:  `<b style="color: var(--text);">Sound</b> — each star is a memory, placed by the <i>genre fingerprint</i> of its song (and the artist behind it). UMAP projects that high-dimensional vector into 3D, so memories with similar-sounding music land near each other regardless of who logged them.`,
    social: `<b style="color: var(--text);">Social</b> — each star is placed by <i>who</i> logged it and whose taste it resembles. Same-user memories pull together; users with overlapping taste intertwine instead of sitting in separate bubbles.`
  };
  const explainEl = root.querySelector('#sigExplain');
  const setExplain = (name) => { explainEl.innerHTML = EXPLAIN[name]; };

  applyLayout('sound');
  setExplain('sound');

  const btnSound  = root.querySelector('#sigSound');
  const btnSocial = root.querySelector('#sigSocial');
  btnSound.onclick  = () => { btnSound.classList.add('active');  btnSocial.classList.remove('active'); applyLayout('sound');  setExplain('sound');  };
  btnSocial.onclick = () => { btnSocial.classList.add('active'); btnSound.classList.remove('active');  applyLayout('social'); setExplain('social'); };

  // --- raycaster for hover + click ---
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoverIdx = -1;

  function updatePointer(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x =  ((ev.clientX - rect.left) / rect.width)  * 2 - 1;
    pointer.y = -((ev.clientY - rect.top)  / rect.height) * 2 + 1;
  }

  function pickIndex() {
    // Refresh bounding spheres — we mutate positions every frame and stale
    // spheres cause raycaster's early-rejection to silently swallow hits.
    mineObj.geom.computeBoundingSphere();
    othersObj.geom.computeBoundingSphere();
    const dist = camera.position.length();
    raycaster.params.Points.threshold = Math.max(0.3, dist * 0.06);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([mineObj.pts, othersObj.pts]);
    if (!hits.length) return -1;
    hits.sort((a, b) => a.distanceToRay - b.distanceToRay || a.distance - b.distance);
    const h = hits[0];
    // Map (object, index-within-subset) back to the absolute memory index.
    const subset = h.object === mineObj.pts ? mineObj.idxs : othersObj.idxs;
    return subset[h.index];
  }

  const audioEl = root.querySelector('#discAudio');
  audioEl.volume = 0.4;
  let currentAudioId = null;

  async function playPreview(m) {
    if (currentAudioId === m.id) return;  // already playing this one
    currentAudioId = m.id;
    const url = await fetchPreview(m.song);
    if (currentAudioId !== m.id) return;  // user moved on while fetching
    if (!url) { console.log('[preview] no url for', m.song?.name); stopPreview(); return; }
    console.log('[preview] playing', m.song?.name, '→', url);
    audioEl.src = url;
    audioEl.currentTime = 0;
    try {
      await audioEl.play();
    } catch (e) {
      console.warn('[preview] play() rejected:', e.name, e.message);
    }
  }
  function stopPreview() {
    if (currentAudioId === null) return;
    currentAudioId = null;
    audioEl.pause();
    audioEl.removeAttribute('src');
  }

  function showTip(idx, clientX, clientY) {
    const m = memories[idx];
    const artists = (m.song?.artists || []).join(', ');
    const art = m.song?.albumArt
      ? `<img src="${esc(m.song.albumArt)}" style="width: 100%; border-radius: 4px; margin-bottom: 0.4rem;" />`
      : '';
    const previewTag = m.song?.previewUrl
      ? `<div style="color: var(--accent); font-size: 0.7rem; margin-top: 0.3rem;">▶ playing preview</div>`
      : `<div style="color: var(--text-dim); font-size: 0.7rem; margin-top: 0.3rem;">no preview available</div>`;
    tip.innerHTML = `
      ${art}
      <div style="color: var(--text); font-weight: 500;">${esc(m.song?.name || 'untitled')}</div>
      <div style="color: var(--text-dim);">${esc(artists)}</div>
      <div style="color: var(--text-dim); margin-top: 0.3rem; font-size: 0.75rem;">
        — ${esc(m.authorName || m.authorEmail || 'someone')}
      </div>
      ${previewTag}
    `;
    tip.style.display = 'block';
    const pad = 14;
    const tw = 220, th = tip.offsetHeight;
    let left = clientX + pad;
    let top  = clientY + pad;
    if (left + tw > window.innerWidth)  left = clientX - tw - pad;
    if (top  + th > window.innerHeight) top  = clientY - th - pad;
    tip.style.left = `${left}px`;
    tip.style.top  = `${top}px`;

    playPreview(m);
  }
  function hideTip() {
    tip.style.display = 'none';
    stopPreview();
  }

  function onMove(ev) {
    updatePointer(ev);
    const idx = pickIndex();
    if (idx !== hoverIdx) {
      hoverIdx = idx;
      renderer.domElement.style.cursor = idx >= 0 ? 'pointer' : 'grab';
    }
    if (idx >= 0) showTip(idx, ev.clientX, ev.clientY); else hideTip();
  }
  function onClick(ev) {
    updatePointer(ev);
    const idx = pickIndex();
    if (idx >= 0) navigate(`/memory/${memories[idx].id}`);
  }
  renderer.domElement.addEventListener('pointermove', onMove);
  renderer.domElement.addEventListener('click', onClick);
  renderer.domElement.style.cursor = 'grab';

  // --- animate loop ---
  const animate = () => {
    // auto-cleanup if the canvas was detached by a route change
    if (!document.body.contains(renderer.domElement)) {
      if (discoveryCleanup) { discoveryCleanup(); discoveryCleanup = null; }
      return;
    }
    discoveryAnimationId = requestAnimationFrame(animate);

    // ease the shared absolute-position buffer
    for (let i = 0; i < N; i++) {
      const m = memories[i];
      const c = currentPos.get(m.id);
      const t = targetPos.get(m.id);
      c.x += (t.x - c.x) * 0.08;
      c.y += (t.y - c.y) * 0.08;
      c.z += (t.z - c.z) * 0.08;
      positions[i * 3]     = c.x;
      positions[i * 3 + 1] = c.y;
      positions[i * 3 + 2] = c.z;
    }

    // copy into each subset Points geometry
    const copyInto = (obj) => {
      const arr = obj.geom.attributes.position.array;
      for (let k = 0; k < obj.idxs.length; k++) {
        const i = obj.idxs[k];
        arr[k * 3]     = positions[i * 3];
        arr[k * 3 + 1] = positions[i * 3 + 1];
        arr[k * 3 + 2] = positions[i * 3 + 2];
      }
      obj.geom.attributes.position.needsUpdate = true;
    };
    copyInto(mineObj);
    copyInto(othersObj);
    if (haloObj) copyInto(haloObj);

    // refresh line buffers from shared positions
    for (const { idxs, lineGeom } of lineGroups) {
      const arr = lineGeom.attributes.position.array;
      for (let k = 0; k < idxs.length; k++) {
        const i = idxs[k];
        arr[k * 3]     = positions[i * 3];
        arr[k * 3 + 1] = positions[i * 3 + 1];
        arr[k * 3 + 2] = positions[i * 3 + 2];
      }
      lineGeom.attributes.position.needsUpdate = true;
    }

    controls.update();
    renderer.render(scene, camera);
  };
  animate();

  // --- cleanup on route change ---
  discoveryCleanup = () => {
    window.removeEventListener('resize', onResize);
    renderer.domElement.removeEventListener('pointermove', onMove);
    renderer.domElement.removeEventListener('click', onClick);
    stopPreview();
    controls.dispose();
    renderer.dispose();
    root.style.maxWidth = '';
    root.style.padding  = '';
  };
}

function addStars(scene) {
  const geom = new THREE.BufferGeometry();
  const pos = [];
  for (let i = 0; i < 800; i++) pos.push((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80);
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geom, new THREE.PointsMaterial({ color: 0xffffff, size: 0.04, transparent: true, opacity: 0.5 })));
}


// ============================================================================
//  [PROFILE]  account info + Spotify token status + sign out
// ============================================================================
export function renderProfile(root) {
  const user = auth.currentUser;
  const connected = isConnected();
  root.innerHTML = `
    <h1>Profile</h1>
    <div class="card">
      <div class="meta">Signed in as</div>
      <div class="song">${esc(user?.email || user?.displayName || 'unknown')}</div>
    </div>

    <div class="card">
      <div class="meta">Spotify</div>
      <div style="margin-bottom: 1rem;">${connected ? 'Connected ✓' : 'Not connected'}</div>
      ${connected
        ? `<button id="disconnectSpotify" class="ghost">Disconnect Spotify</button>`
        : `<button id="connectSpotify">Connect Spotify</button>`}
    </div>

    <div class="card" style="border: 1px dashed var(--border); opacity: 0.8;">
      <div class="meta">Dev tools</div>
      <div style="color: var(--text-dim); font-size: 0.85rem; margin-bottom: 0.75rem;">
        Seeds ~40 fake memories across 6 archetype users. Requires Spotify connected
        and Firestore test-mode rules. Remove before shipping.
      </div>
      <button id="seedBtn" class="ghost" ${connected ? '' : 'disabled'}>Seed demo data</button>
      <span id="seedStatus" style="color: var(--text-dim); margin-left: 1rem; font-size: 0.85rem;"></span>
    </div>

    <button id="logout" class="ghost">Sign out</button>
  `;
  const connectBtn = root.querySelector('#connectSpotify');
  const disconnectBtn = root.querySelector('#disconnectSpotify');
  if (connectBtn)    connectBtn.onclick    = () => startLogin();
  if (disconnectBtn) disconnectBtn.onclick = () => { disconnect(); renderProfile(root); };
  root.querySelector('#logout').onclick = () => logout();

  const seedBtn    = root.querySelector('#seedBtn');
  const seedStatus = root.querySelector('#seedStatus');
  seedBtn.onclick = async () => {
    seedBtn.disabled = true;
    try {
      await seedAll(({ done, total }) => { seedStatus.textContent = `${done}/${total}…`; });
      seedStatus.textContent = 'Seeded. Check Discovery.';
    } catch (e) {
      seedStatus.textContent = `Failed: ${e.message}`;
    } finally {
      seedBtn.disabled = false;
    }
  };
}
