// ============================================================================
//  SONDER — ALL SCREENS
// ============================================================================
//  Use ctrl-F (cmd-F) to jump to a section:
//     [LOGIN]        sign in / sign up
//     [ONBOARDING]   first-login walkthrough
//     [FEED]         all memories ranked by resonance + recency
//     [LOG]          log a new memory (Spotify search + Replicate feelings + photo)
//     [MEMORY]       single memory detail + comments + +1 resonance
//     [DISCOVERY]    Three.js constellation (Sound / Social-by-feeling / Me & Friends)
//     [ROOM]         feeling-room: live chat + grid of same-feeling memories
//     [PROFILE]      account + friends + curated archive
// ============================================================================

import {
  auth, logout,
  signInEmail, signUpEmail, signInGoogle,
  createMemory, getMyMemories, getMemoriesByUid, getMemory, getPublicMemories, getFeedMemories,
  addComment, getComments,
  toggleResonance, updateMemoryFeelings,
  ensureUserDoc, getUserDoc, getAllUsers, markOnboarded,
  sendFriendRequest, getIncomingRequests, getOutgoingRequests,
  acceptFriendRequest, rejectFriendRequest, unfriend, getMyFriends,
  subscribeRoomMessages, postRoomMessage
} from './firebase.js';
import { searchTracks, startLogin, isConnected, disconnect } from './spotify.js';
import { fetchPreview } from './preview.js';
import { extractFeelings } from './replicate.js';
import { navigate } from './main.js';
import { seedAll, clearSeedData } from './seed.js';
import { computeLayouts, computeFriendsLayout } from './umap.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
//  [ONBOARDING]  first-login walkthrough — 4 cards explain the app
// ============================================================================
export function renderOnboarding(root) {
  root.innerHTML = `
    <div class="onboard">
      <div class="onboard-head">
        <div class="mini">WELCOME TO</div>
        <h1>SONDER</h1>
        <p>A music memory archive. Songs pin to moments. Moments pin to people.</p>
      </div>
      <div class="onboard-grid">
        <div class="onboard-card">
          <div class="num">01</div>
          <div class="ttl">DISCOVERY</div>
          <p>A 3D constellation of every memory on Sonder. Drag to orbit, hover to preview, click a star to read its story. Switch between <b>Sound</b> (clusters by genre) and <b>Feels</b> (clusters by the feeling behind the memory).</p>
        </div>
        <div class="onboard-card">
          <div class="num">02</div>
          <div class="ttl">FEED</div>
          <p>Every memory in one place, ranked by resonance. Hover a row to spin the vinyl and stream a preview. <b>+1</b> the ones that hit.</p>
        </div>
        <div class="onboard-card">
          <div class="num">03</div>
          <div class="ttl">LOG</div>
          <p>Search a song, write what was happening, drop a photo. We use AI to read the feelings in your note and place your memory in the right cluster on Discovery.</p>
        </div>
        <div class="onboard-card">
          <div class="num">04</div>
          <div class="ttl">PROFILE</div>
          <p>Your curated archive. Add friends to compare taste in a private <b>Me &amp; Friends</b> view, see who's resonated with you, and manage your account.</p>
        </div>
      </div>
      <div class="onboard-cta">
        <button id="onboardDone">Enter Sonder</button>
      </div>
    </div>
  `;
  root.querySelector('#onboardDone').onclick = async () => {
    try { await markOnboarded(); } catch (e) { console.warn('onboard mark failed', e); }
    // Reload via hash so main.js refetches the user doc.
    window.location.hash = '/';
    window.location.reload();
  };
}


// ============================================================================
//  [FEED]  ranked by resonance, then recency
// ============================================================================
export async function renderFeed(root) {
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
            <div class="mini">RANKED BY RESONANCE</div>
            <div class="sub">+1 the ones that hit</div>
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

  const SHOWN = Math.min(10, memories.length);
  memories = memories.slice(0, SHOWN);
  list.innerHTML = memories.map((m, i) => trackRow(m, i, currentUid)).join('');
  viewMore.textContent = '';

  setFocus(memories[0], 0, { autoplay: false });

  list.querySelectorAll('.track').forEach((row) => {
    const idx = Number(row.dataset.idx);
    row.addEventListener('mouseenter', () => setFocus(memories[idx], idx, { autoplay: true }));
    row.addEventListener('click', (ev) => {
      // Plus-1 button shouldn't navigate.
      if (ev.target.closest('.plus1')) return;
      navigate(`/memory/${memories[idx].id}`);
    });
  });
  list.addEventListener('mouseleave', () => stopPreview());

  // Wire +1 buttons.
  list.querySelectorAll('.plus1').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      const idx = Number(btn.dataset.idx);
      const m = memories[idx];
      btn.disabled = true;
      try {
        const { resonance, resonated } = await toggleResonance(m.id);
        m.resonance = resonance;
        m.resonators = resonated
          ? [...(m.resonators || []), currentUid]
          : (m.resonators || []).filter((u) => u !== currentUid);
        btn.classList.toggle('on', resonated);
        btn.querySelector('.count').textContent = resonance;
      } catch (e) { console.warn('resonance:', e); }
      btn.disabled = false;
    });
  });

  function setFocus(m, idx, { autoplay }) {
    list.querySelectorAll('.track').forEach((r) => r.classList.toggle('active', Number(r.dataset.idx) === idx));

    const song = m.song?.name || 'Untitled';
    const artist = (m.song?.artists || []).join(', ') || 'Unknown artist';
    focusTitle.textContent = artist.toUpperCase();
    focusSub.innerHTML   = `${esc(song).toUpperCase()} · ${m.date ? new Date(m.date).toLocaleDateString() : ''}`;
    focusMini.textContent = (m.uid === currentUid ? 'YOUR MEMORY' : `FROM ${(m.authorName || m.authorEmail || 'someone').toUpperCase()}`);

    if (m.song?.albumArt) {
      vinylLabel.innerHTML = `<img src="${esc(m.song.albumArt)}" alt="" />`;
    } else {
      vinylLabel.innerHTML = `<span class="label-text">${esc(song).slice(0, 12).toUpperCase()}</span>`;
    }
    vinyl.classList.remove('kick');
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
    try { url = await fetchPreview(m.song); }
    catch { vinylTime.textContent = 'LOOKUP FAILED'; return; }
    if (currentAudioId !== m.id) return;
    if (!url) { vinylTime.textContent = 'NO PREVIEW'; vinyl.classList.remove('playing'); return; }
    audioEl.src = url;
    audioEl.currentTime = 0;
    try {
      await audioEl.play();
      vinyl.classList.add('playing');
    } catch (e) {
      vinylTime.textContent = e.name === 'NotAllowedError' ? 'CLICK ANYWHERE TO ENABLE' : 'PLAY FAILED';
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
  const resonance = m.resonance ?? 0;
  const resonated = (m.resonators || []).includes(currentUid);
  return `
    <div class="track" data-idx="${i}">
      <div class="num">${num}</div>
      ${thumb}
      <div class="info">
        <div class="song">${esc(m.song?.name || 'Untitled')}</div>
        <div class="artist">${esc(artists)}</div>
      </div>
      <button class="plus1 ${resonated ? 'on' : ''}" data-idx="${i}" title="Resonate">
        <span class="plus">+</span><span class="count">${resonance}</span>
      </button>
      <div class="meta">${esc(author)}</div>
    </div>`;
}


// ============================================================================
//  [LOG]  log a new memory (Spotify search + form + AI feelings + photo)
// ============================================================================
let selectedSong = null;
let selectedPhoto = null;   // base64 data URL or null

export function renderLog(root) {
  selectedSong = null;
  selectedPhoto = null;
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
      <textarea id="note" placeholder="What was happening? Who was there? How did it feel?"></textarea>
      <div class="meta" style="font-size: 0.7rem; color: var(--ink-soft);">
        We'll read this with AI to extract the feelings and place this memory in the right cluster on Discovery.
      </div>

      <label style="margin-top: 1rem;">Photo (optional)</label>
      <div class="photo-row">
        <input id="photo" type="file" accept="image/*" capture="environment" />
        <div id="photoPreview" class="photo-preview"></div>
      </div>

      <label style="margin-top: 1rem;">Where</label>
      <input id="location" type="text" placeholder="City, place, room — anything" />

      <label>When</label>
      <input id="date" type="date" />

      <div class="toggle-row">
        <input id="isPublic" type="checkbox" checked />
        <label for="isPublic" style="margin: 0;">Make this public (default)</label>
      </div>

      <div id="err" class="error"></div>
      <div id="status" class="meta" style="margin-bottom: 0.5rem;"></div>
      <button id="save">Save memory</button>
    </div>
  `;

  root.querySelector('#date').value = new Date().toISOString().slice(0, 10);

  const connectBtn = root.querySelector('#connectSpotify');
  if (connectBtn) connectBtn.onclick = () => startLogin();

  // Photo upload — resize client-side to a 768px JPEG @ 0.7 quality and store
  // as base64 data URL on the memory doc. Stays under Firestore's 1MB doc cap
  // (typically ~50–120KB) and avoids needing Firebase Storage (Blaze tier only).
  const photoInput = root.querySelector('#photo');
  const photoPreview = root.querySelector('#photoPreview');
  photoInput.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) { selectedPhoto = null; photoPreview.innerHTML = ''; return; }
    try {
      selectedPhoto = await resizeImageToDataURL(file, 768, 0.7);
      photoPreview.innerHTML = `<img src="${selectedPhoto}" alt="" />`;
    } catch (err) {
      console.warn('photo resize failed:', err);
      selectedPhoto = null;
      photoPreview.innerHTML = `<div class="error">Couldn't read that image.</div>`;
    }
  };

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

  root.querySelector('#save').onclick = async () => {
    const err = root.querySelector('#err');
    const status = root.querySelector('#status');
    err.textContent = '';
    if (!selectedSong) { err.textContent = 'Pick a song first.'; return; }
    const note = root.querySelector('#note').value.trim();

    const saveBtn = root.querySelector('#save');
    saveBtn.disabled = true;
    try {
      // Extract feelings from the note (best-effort — empty array on failure).
      let feelings = [];
      if (note) {
        status.textContent = 'Reading feelings…';
        try { feelings = await extractFeelings(note); }
        catch (e) { console.warn('feelings extract failed:', e); }
      }
      status.textContent = 'Saving memory…';
      await createMemory({
        song: selectedSong,
        note,
        location: root.querySelector('#location').value.trim(),
        photoUrl: selectedPhoto,
        date: root.querySelector('#date').value,
        isPublic: root.querySelector('#isPublic').checked,
        feelings
      });
      navigate('/');
    } catch (e) {
      err.textContent = e.message;
      saveBtn.disabled = false;
      status.textContent = '';
    }
  };
}

// Resize an uploaded image file to maxDim px (longest side) and return JPEG data URL.
function resizeImageToDataURL(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) { height = (height * maxDim) / width; width = maxDim; }
        else if (height > maxDim)              { width  = (width  * maxDim) / height; height = maxDim; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}


// ============================================================================
//  [MEMORY]  single memory detail + comments + +1 resonance
// ============================================================================
export async function renderMemory(root, id) {
  if (!id) { root.innerHTML = `<div class="empty">No memory selected.</div>`; return; }
  root.innerHTML = `Loading…`;

  try {
    const m = await getMemory(id);
    if (!m) { root.innerHTML = `<div class="empty">Not found.</div>`; return; }

    const artists = m.song?.artists?.join(', ') || '';
    const date = m.date ? new Date(m.date).toLocaleDateString() : '';
    const myUid = auth.currentUser?.uid;
    const resonated = (m.resonators || []).includes(myUid);
    const feelings = (m.feelings || []);

    root.innerHTML = `
      <a href="#/" style="color: var(--text-dim);">← back</a>
      <div class="memory-page">
        ${m.photoUrl ? `<img class="memory-photo" src="${esc(m.photoUrl)}" alt="" />` : ''}
        ${m.song?.albumArt && !m.photoUrl ? `<img class="memory-photo" src="${esc(m.song.albumArt)}" alt="" />` : ''}

        <h1 style="margin-top: 1rem;">${esc(m.song?.name || 'Untitled')}</h1>
        <div class="meta" style="margin-bottom: 1rem;">
          ${esc(artists)} · ${date} · ${esc(m.location || 'somewhere')}
        </div>

        ${m.note ? `<p style="font-style: italic; color: var(--text-dim); font-size: 1.05rem; line-height: 1.5;">"${esc(m.note)}"</p>` : ''}

        ${feelings.length ? `
          <div class="feeling-tags">
            ${feelings.map((f) => `<a class="feeling-tag" href="#/room/${encodeURIComponent(f)}">${esc(f)}</a>`).join('')}
          </div>` : ''}

        ${m.isPublic ? `
          <div class="resonance-bar">
            <button id="plus1Btn" class="plus1 large ${resonated ? 'on' : ''}">
              <span class="plus">+</span>
              <span>RESONATE</span>
              <span class="count">${m.resonance ?? 0}</span>
            </button>
          </div>

          <h2 style="margin-top: 2rem;">Comments</h2>
          <div id="comments">Loading…</div>
          <div class="card" style="margin-top: 1rem;">
            <textarea id="commentText" placeholder="Say something…"></textarea>
            <button id="postComment">Post</button>
          </div>
        ` : `<p class="empty">Private memory · only visible to you.</p>`}
      </div>
    `;

    if (m.isPublic) {
      const list = root.querySelector('#comments');
      const refresh = async () => {
        const comments = await getComments(id);
        list.innerHTML = comments.length === 0
          ? `<div class="empty">No comments yet.</div>`
          : comments.map((c) => `
              <div class="card">
                <div class="meta">${esc(c.name || c.email || 'someone')}</div>
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

      const plus1Btn = root.querySelector('#plus1Btn');
      plus1Btn.onclick = async () => {
        plus1Btn.disabled = true;
        try {
          const { resonance, resonated } = await toggleResonance(id);
          plus1Btn.classList.toggle('on', resonated);
          plus1Btn.querySelector('.count').textContent = resonance;
        } catch (e) { console.warn(e); }
        plus1Btn.disabled = false;
      };
    }
  } catch (e) {
    root.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}


// ============================================================================
//  [DISCOVERY]  Three.js constellation
// ============================================================================
//  Three views, toggled top-left:
//    • Sound      — UMAP of genre vectors
//    • Social     — feeling-cluster layout (clickable cluster labels)
//    • Friends    — UMAP restricted to me + my mutual friends
// ============================================================================

let discoveryAnimationId = null;
let discoveryCleanup = null;

export async function renderDiscovery(root) {
  if (discoveryAnimationId) cancelAnimationFrame(discoveryAnimationId);
  if (discoveryCleanup) { discoveryCleanup(); discoveryCleanup = null; }

  root.style.maxWidth = 'none';
  root.style.padding  = '0';

  root.innerHTML = `
    <div id="discWrap" class="disc-wrap">
      <div id="discCanvas" class="disc-canvas"></div>

      <div class="disc-overlay">
        <div class="disc-toggle-row">
          <button id="sigSound"   class="toggle active">Sound</button>
          <button id="sigFeels"   class="toggle">Feels</button>
          <button id="sigFriends" class="toggle">Me &amp; Friends</button>
          <span id="discoveryStatus" class="disc-status"></span>
        </div>
        <div id="sigExplain" class="disc-explain"></div>
        <div id="friendsPicker" class="disc-friends" style="display: none;"></div>
      </div>

      <div class="disc-legend" id="discLegend"></div>

      <div class="disc-hint" id="discHint">
        drag · scroll · hover · click · feeling dots are <b>clickable rooms</b>
      </div>

      <div id="discTip" class="disc-tip"></div>
      <div id="discLabels" class="disc-labels"></div>

      <audio id="discAudio" preload="none" style="display: none;"></audio>
    </div>
  `;

  const wrap     = root.querySelector('#discWrap');
  const canvas   = root.querySelector('#discCanvas');
  const tip      = root.querySelector('#discTip');
  const labelsEl = root.querySelector('#discLabels');
  const legendEl = root.querySelector('#discLegend');
  const status   = root.querySelector('#discoveryStatus');
  const explainEl = root.querySelector('#sigExplain');
  const friendsPicker = root.querySelector('#friendsPicker');
  const setStatus = (t) => { status.textContent = t; };

  // ---- fetch memories + my friends list ----
  let memories = [];
  let friends = [];
  try { memories = await getPublicMemories(); } catch {}
  try { friends = await getMyFriends(); } catch {}

  const myUid = auth.currentUser?.uid || null;

  // ---- scene scaffolding ----
  const w = () => wrap.clientWidth;
  const h = () => wrap.clientHeight;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, w() / h(), 0.1, 1000);
  camera.position.set(0, 0, 14);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setSize(w(), h());
  renderer.setPixelRatio(window.devicePixelRatio);
  canvas.appendChild(renderer.domElement);
  addBackgroundStars(scene);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.enablePan = false;
  controls.minDistance = 3;
  controls.maxDistance = 40;

  const onResize = () => {
    camera.aspect = w() / h();
    camera.updateProjectionMatrix();
    renderer.setSize(w(), h());
  };
  window.addEventListener('resize', onResize);

  if (memories.length < 2) {
    setStatus('Not enough memories yet — log some (or seed in Profile).');
    explainEl.innerHTML = `<b>Discovery</b> shows every public memory as a star. Once a few people log songs, you'll see clusters form.`;
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

  // ---- compute layouts ----
  setStatus('Building constellation…');
  let layouts;
  try {
    layouts = await computeLayouts(memories, ({ stage, done, total }) => {
      if (stage === 'genres' && total) setStatus(`Fetching genres ${done}/${total}…`);
      if (stage === 'umap')            setStatus('Running UMAP…');
    });
    setStatus(`${memories.length} memories`);
  } catch (e) { setStatus(`Layout failed: ${e.message}`); return; }

  // Friends layout — only computed when needed.
  let friendsLayout = null;
  function getFriendsLayout(selectedFriendUids) {
    const eligible = new Set([myUid, ...selectedFriendUids]);
    const subset = memories.filter((m) => eligible.has(m.uid));
    if (subset.length < 2) {
      const map = new Map();
      subset.forEach((m) => map.set(m.id, [0, 0, 0]));
      return { map, genres: [], subsetIds: new Set(subset.map((m) => m.id)) };
    }
    const { map, genres } = computeFriendsLayout(subset);
    return { map, genres, subsetIds: new Set(subset.map((m) => m.id)) };
  }

  // ---- build points objects ----
  const N = memories.length;
  const positions = new Float32Array(N * 3);
  const visibleFlags = new Float32Array(N).fill(1);

  const mineIdxs = [];
  const otherIdxs = [];
  memories.forEach((m, i) => (m.uid === myUid ? mineIdxs : otherIdxs).push(i));

  // Base solid colors (used in sound + friends modes); feels mode swaps to
  // per-cluster colors via the vertex-color attribute.
  const BASE_MINE  = [0xd9 / 255, 0x4f / 255, 0x3c / 255];
  const BASE_OTHER = [0x22 / 255, 0x22 / 255, 0x22 / 255];

  function hexToRgbArr(hex) {
    const h = hex.replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255
    ];
  }

  // Always-vertexColor Points so we can swap palettes per mode without
  // rebuilding geometry.
  function makePoints(subsetIdxs, { size, opacity }) {
    const k = subsetIdxs.length;
    const pos = new Float32Array(k * 3);
    const col = new Float32Array(k * 3).fill(1);
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

  const othersObj = makePoints(otherIdxs, { size: 0.22, opacity: 0.85 });
  const mineObj   = makePoints(mineIdxs,  { size: 0.50, opacity: 1.0 });

  function paintColors(mode) {
    function paint(obj, baseRGB) {
      const arr = obj.geom.attributes.color.array;
      for (let k = 0; k < obj.idxs.length; k++) {
        const i = obj.idxs[k];
        let rgb;
        if (mode === 'feels') {
          const cIdx = layouts.feelsMembership.get(memories[i].id);
          const hex  = layouts.feelsClusters[cIdx]?.color || '#888888';
          rgb = hexToRgbArr(hex);
        } else {
          rgb = baseRGB;
        }
        arr[k * 3]     = rgb[0];
        arr[k * 3 + 1] = rgb[1];
        arr[k * 3 + 2] = rgb[2];
      }
      obj.geom.attributes.color.needsUpdate = true;
    }
    paint(mineObj,   BASE_MINE);
    paint(othersObj, BASE_OTHER);
  }
  const COLOR_HALO = new THREE.Color(0xc89a2e);

  // Crossings — gold halos around MY songs that others have also logged.
  const usersBySong = new Map();
  for (const m of memories) {
    const s = m.song?.spotifyId;
    if (!s || !m.uid) continue;
    if (!usersBySong.has(s)) usersBySong.set(s, new Set());
    usersBySong.get(s).add(m.uid);
  }
  const isCrossing = (m) => (usersBySong.get(m.song?.spotifyId)?.size ?? 0) >= 2;
  const crossIdxs = mineIdxs.filter((i) => isCrossing(memories[i]));
  let haloObj = null;
  if (crossIdxs.length) {
    const k = crossIdxs.length;
    const pos = new Float32Array(k * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({
      size: 1.0, sizeAttenuation: true, color: COLOR_HALO,
      transparent: true, opacity: 0.45, depthWrite: false
    }));
    pts.frustumCulled = false;
    scene.add(pts);
    haloObj = { pts, geom: g, idxs: crossIdxs };
  }

  // ---- layout state ----
  const currentPos = new Map();
  const targetPos  = new Map();
  let currentMode  = 'sound';

  function applyLayout(name) {
    currentMode = name;
    let map;
    if (name === 'sound')   map = layouts.sound;
    if (name === 'feels')   map = layouts.feels;
    if (name === 'friends') {
      const sel = currentFriendSelection();
      friendsLayout = getFriendsLayout(sel);
      map = friendsLayout.map;
    }

    // Visibility: in friends mode, hide memories not in subset.
    visibleFlags.fill(1);
    if (name === 'friends') {
      memories.forEach((m, i) => { visibleFlags[i] = friendsLayout.subsetIds.has(m.id) ? 1 : 0; });
    }

    for (const m of memories) {
      const c = map?.get(m.id) || [0, 0, 0];
      targetPos.set(m.id, { x: c[0], y: c[1], z: c[2] });
      if (!currentPos.has(m.id)) currentPos.set(m.id, { x: c[0], y: c[1], z: c[2] });
    }

    paintColors(name);
    renderLegend(name);
    renderClusterLabels();
  }

  // ---- friend picker UI ----
  function currentFriendSelection() {
    return Array.from(friendsPicker.querySelectorAll('input[type=checkbox]:checked'))
      .map((cb) => cb.value);
  }

  function buildFriendsPicker() {
    if (!friends.length) {
      friendsPicker.innerHTML = `<div class="disc-friends-empty">No friends yet. Add some on your <a href="#/profile">Profile</a>.</div>`;
      return;
    }
    friendsPicker.innerHTML = `
      <div class="disc-friends-head">PICK WHO TO COMPARE WITH</div>
      ${friends.map((f) => `
        <label class="disc-friend">
          <input type="checkbox" value="${esc(f.uid)}" checked />
          ${esc(f.displayName || f.email || 'someone')}
        </label>
      `).join('')}
    `;
    friendsPicker.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.onchange = () => applyLayout('friends');
    });
  }
  buildFriendsPicker();

  // ---- explain panel ----
  const EXPLAIN = {
    sound:   `<b>Sound</b> — stars are placed by <i>genre fingerprint</i>. Italic labels mark each genre's centroid: the closer a star sits to a label, the more strongly that genre matches the song.`,
    feels:   `<b>Feels</b> — clusters are <i>feelings</i>, not people. We send each memory's note to an LLM (openai/gpt-5-structured) and pull the top 10 feelings. Each cluster has its own color; <b>hover a colored dot</b> to see the feeling, <b>click it</b> to enter that room and chat with people in the same moment.`,
    friends: `<b>Me &amp; Friends</b> — the Sound projection restricted to you + the friends you tick on the left. Genre labels are recomputed for just this subset, so you can see where your tastes overlap or diverge.`
  };
  function setExplain(name) {
    explainEl.innerHTML = EXPLAIN[name];
    friendsPicker.style.display = name === 'friends' ? 'block' : 'none';
  }

  applyLayout('sound');
  setExplain('sound');

  const btnSound   = root.querySelector('#sigSound');
  const btnFeels   = root.querySelector('#sigFeels');
  const btnFriends = root.querySelector('#sigFriends');
  function activate(name) {
    btnSound.classList.toggle('active',   name === 'sound');
    btnFeels.classList.toggle('active',   name === 'feels');
    btnFriends.classList.toggle('active', name === 'friends');
    applyLayout(name);
    setExplain(name);
  }
  btnSound.onclick   = () => activate('sound');
  btnFeels.onclick   = () => activate('feels');
  btnFriends.onclick = () => activate('friends');

  // ---- legend (per mode) ----
  function renderLegend(name) {
    if (name === 'feels') {
      const items = (layouts.feelsClusters || []).map((c) =>
        `<span class="legend-chip"><span class="legend-swatch" style="background:${c.color}"></span>${esc(c.feeling)}</span>`
      ).join('');
      legendEl.innerHTML = `<div class="legend-title">FEELING CLUSTERS</div><div class="legend-row">${items}</div>`;
    } else {
      legendEl.innerHTML = `
        <div class="legend-row">
          <span class="legend-chip"><span class="legend-swatch" style="background:#d94f3c"></span>your memories</span>
          <span class="legend-chip"><span class="legend-swatch" style="background:#222"></span>everyone else</span>
          <span class="legend-chip"><span class="legend-swatch" style="background:#c89a2e"></span>shared songs</span>
        </div>`;
    }
  }

  // ---- floating labels: feeling-cluster dots OR genre side-labels ----
  //  Two distinct anchor types live in #discLabels:
  //    .cluster-dot-anchor — small colored circle (Feels view), click → room
  //    .genre-label        — italic genre name at centroid (Sound + Friends)
  //  We rebuild on mode change, then re-project positions every frame.
  function activeGenreLabels() {
    if (currentMode === 'sound')   return layouts.soundGenres || [];
    if (currentMode === 'friends') return friendsLayout?.genres || [];
    return [];
  }

  function renderClusterLabels() {
    if (currentMode === 'feels') {
      const cs = layouts.feelsClusters || [];
      labelsEl.innerHTML = cs.map((c) => `
        <a class="cluster-dot-anchor" href="#/room/${encodeURIComponent(c.feeling)}"
           style="--dot:${c.color}" title="${esc(c.feeling)}">
          <span class="dot"></span>
          <span class="tip">${esc(c.feeling).toUpperCase()}</span>
        </a>`).join('');
    } else {
      const gs = activeGenreLabels();
      labelsEl.innerHTML = gs.map((g) =>
        `<span class="genre-label">${esc(g.genre)}</span>`
      ).join('');
    }
  }

  function projectClusterPositions() {
    if (currentMode === 'feels') {
      const cs = layouts.feelsClusters || [];
      const els = labelsEl.querySelectorAll('.cluster-dot-anchor');
      cs.forEach((c, i) => {
        const el = els[i]; if (!el) return;
        const v = new THREE.Vector3(c.x, c.y, c.z).project(camera);
        const inFront = v.z < 1;
        const x = (v.x *  0.5 + 0.5) * w();
        const y = (-v.y * 0.5 + 0.5) * h();
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        el.style.opacity   = inFront ? '1' : '0';
      });
    } else {
      const gs = activeGenreLabels();
      const els = labelsEl.querySelectorAll('.genre-label');
      gs.forEach((g, i) => {
        const el = els[i]; if (!el) return;
        const v = new THREE.Vector3(g.x, g.y, g.z).project(camera);
        const inFront = v.z < 1;
        const x = (v.x *  0.5 + 0.5) * w();
        const y = (-v.y * 0.5 + 0.5) * h();
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        el.style.opacity   = inFront ? '0.95' : '0';
      });
    }
  }

  // ---- raycaster for hover/click ----
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hoverIdx = -1;

  function updatePointer(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x =  ((ev.clientX - rect.left) / rect.width)  * 2 - 1;
    pointer.y = -((ev.clientY - rect.top)  / rect.height) * 2 + 1;
  }

  function pickIndex() {
    mineObj.geom.computeBoundingSphere();
    othersObj.geom.computeBoundingSphere();
    const dist = camera.position.length();
    raycaster.params.Points.threshold = Math.max(0.3, dist * 0.06);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([mineObj.pts, othersObj.pts]);
    if (!hits.length) return -1;
    hits.sort((a, b) => a.distanceToRay - b.distanceToRay || a.distance - b.distance);
    const h = hits[0];
    const subset = h.object === mineObj.pts ? mineObj.idxs : othersObj.idxs;
    const absIdx = subset[h.index];
    if (visibleFlags[absIdx] !== 1) return -1;   // hidden in friends mode
    return absIdx;
  }

  const audioEl = root.querySelector('#discAudio');
  audioEl.volume = 0.4;
  let currentAudioId = null;

  async function playPreview(m) {
    if (currentAudioId === m.id) return;
    currentAudioId = m.id;
    const url = await fetchPreview(m.song);
    if (currentAudioId !== m.id) return;
    if (!url) { stopPreview(); return; }
    audioEl.src = url; audioEl.currentTime = 0;
    try { await audioEl.play(); } catch {}
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
      ? `<img src="${esc(m.song.albumArt)}" />`
      : '';
    tip.innerHTML = `
      ${art}
      <div class="tip-song">${esc(m.song?.name || 'untitled')}</div>
      <div class="tip-artist">${esc(artists)}</div>
      <div class="tip-author">— ${esc(m.authorName || m.authorEmail || 'someone')}</div>
      ${(m.feelings?.length ? `<div class="tip-feelings">${m.feelings.slice(0, 4).map((f) => esc(f)).join(' · ')}</div>` : '')}
    `;
    tip.style.display = 'block';
    const pad = 14;
    const tw = 240, th = tip.offsetHeight;
    let left = clientX + pad;
    let top  = clientY + pad;
    if (left + tw > window.innerWidth)  left = clientX - tw - pad;
    if (top  + th > window.innerHeight) top  = clientY - th - pad;
    tip.style.left = `${left}px`;
    tip.style.top  = `${top}px`;
    playPreview(m);
  }
  function hideTip() { tip.style.display = 'none'; stopPreview(); }

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

  // ---- animation ----
  const animate = () => {
    if (!document.body.contains(renderer.domElement)) {
      if (discoveryCleanup) { discoveryCleanup(); discoveryCleanup = null; }
      return;
    }
    discoveryAnimationId = requestAnimationFrame(animate);

    for (let i = 0; i < N; i++) {
      const m = memories[i];
      const c = currentPos.get(m.id);
      const t = targetPos.get(m.id);
      c.x += (t.x - c.x) * 0.08;
      c.y += (t.y - c.y) * 0.08;
      c.z += (t.z - c.z) * 0.08;
      // hidden points get pushed far away so they don't draw or pick.
      const off = visibleFlags[i] === 1 ? 0 : 9999;
      positions[i * 3]     = c.x + off;
      positions[i * 3 + 1] = c.y + off;
      positions[i * 3 + 2] = c.z + off;
    }

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

    controls.update();
    renderer.render(scene, camera);
    projectClusterPositions();
  };
  animate();

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

function addBackgroundStars(scene) {
  // Very subtle ambient pin-pricks on the cream background.
  const geom = new THREE.BufferGeometry();
  const pos = [];
  for (let i = 0; i < 400; i++) pos.push((Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80);
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geom, new THREE.PointsMaterial({ color: 0x999999, size: 0.03, transparent: true, opacity: 0.35 })));
}


// ============================================================================
//  [ROOM]  feeling room — live chat + grid of memories tagged with this feeling
// ============================================================================
let roomUnsub = null;

export async function renderRoom(root, feeling) {
  if (roomUnsub) { roomUnsub(); roomUnsub = null; }
  if (!feeling) { root.innerHTML = `<div class="empty">Pick a feeling.</div>`; return; }

  root.innerHTML = `
    <a href="#/" style="color: var(--text-dim);">← back to Discovery</a>
    <div class="room-page">
      <div class="room-songs">
        <div class="mini">FEELING ROOM</div>
        <h1 class="room-title">${esc(feeling).toUpperCase()}</h1>
        <p class="room-sub">Memories tagged with <b>${esc(feeling)}</b> — click any to open.</p>
        <div id="roomGrid" class="room-grid">Loading…</div>
      </div>
      <div class="room-chat">
        <div class="mini">LIVE ROOM</div>
        <div id="roomMessages" class="room-messages">Connecting…</div>
        <form id="roomForm" class="room-form">
          <input id="roomInput" type="text" placeholder="Say something to others in this feeling…" maxlength="500" autocomplete="off" />
          <button type="submit">Send</button>
        </form>
      </div>
    </div>
  `;

  // ---- grid of matching memories ----
  const grid = root.querySelector('#roomGrid');
  try {
    const all = await getPublicMemories();
    const matches = all.filter((m) => (m.feelings || []).includes(feeling));
    if (matches.length === 0) {
      grid.innerHTML = `<div class="empty">No memories tagged "${esc(feeling)}" yet.</div>`;
    } else {
      grid.innerHTML = matches.map((m) => `
        <a class="room-card" href="#/memory/${esc(m.id)}">
          ${m.song?.albumArt ? `<img src="${esc(m.song.albumArt)}" alt="" />` : '<div class="ph"></div>'}
          <div class="room-card-info">
            <div class="song">${esc(m.song?.name || 'Untitled')}</div>
            <div class="artist">${esc((m.song?.artists || []).join(', '))}</div>
            <div class="author">— ${esc(m.authorName || m.authorEmail || 'someone')}</div>
          </div>
        </a>
      `).join('');
    }
  } catch (e) {
    grid.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }

  // ---- live chat ----
  const messagesEl = root.querySelector('#roomMessages');
  const form = root.querySelector('#roomForm');
  const input = root.querySelector('#roomInput');

  roomUnsub = subscribeRoomMessages(feeling, (msgs) => {
    if (msgs.length === 0) {
      messagesEl.innerHTML = `<div class="empty">Be the first to say something.</div>`;
      return;
    }
    const myUid = auth.currentUser?.uid;
    messagesEl.innerHTML = msgs.map((m) => `
      <div class="room-msg ${m.uid === myUid ? 'mine' : ''}">
        <div class="who">${esc(m.name || 'someone')}</div>
        <div class="text">${esc(m.text)}</div>
      </div>
    `).join('');
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    try { await postRoomMessage(feeling, text); }
    catch (err) { console.warn(err); }
  };
}


// ============================================================================
//  [PROFILE]  account + friends + curated archive
// ============================================================================
export async function renderProfile(root) {
  const user = auth.currentUser;
  const connected = isConnected();

  root.innerHTML = `
    <h1>Profile</h1>

    <div class="card">
      <div class="meta">Signed in as</div>
      <div class="song">${esc(user?.displayName || user?.email || 'unknown')}</div>
      ${user?.email ? `<div class="meta" style="margin-top: 0.4rem;">${esc(user.email)}</div>` : ''}
    </div>

    <div class="card">
      <div class="meta">Spotify</div>
      <div style="margin-bottom: 1rem;">${connected ? 'Connected ✓' : 'Not connected'}</div>
      ${connected
        ? `<button id="disconnectSpotify" class="ghost">Disconnect Spotify</button>`
        : `<button id="connectSpotify">Connect Spotify</button>`}
    </div>

    <h2 style="margin-top: 2rem;">Friends</h2>
    <div id="friendRequests"></div>
    <div id="friendsList"></div>

    <div class="card">
      <div class="meta">Find people</div>
      <input id="findUser" type="text" placeholder="Search name or email…" />
      <div id="findResults"></div>
    </div>

    <h2 style="margin-top: 2rem;">Your archive</h2>
    <div id="archive">Loading…</div>

    <div class="card" style="border: 1px dashed var(--border); opacity: 0.9; margin-top: 2rem;">
      <div class="meta">Dev tools — demo seed</div>
      <div style="color: var(--text-dim); font-size: 0.85rem; margin-bottom: 0.75rem;">
        Generates 50 fake users × 3 memories (150 total) with AI-generated photos via Replicate,
        cross-user +1s, and random comments. Requires Spotify connected. Takes ~10 minutes
        the first time. Re-running clears the previous seed first.
      </div>
      <div style="display: flex; gap: 0.5rem;">
        <button id="seedBtn" class="ghost" ${connected ? '' : 'disabled'}>Seed demo data</button>
        <button id="clearSeedBtn" class="ghost">Clear seed data</button>
      </div>
      <div id="seedStatus" style="color: var(--text-dim); margin-top: 0.5rem; font-size: 0.85rem;"></div>
    </div>

    <button id="logout" class="ghost" style="margin-top: 2rem;">Sign out</button>
  `;

  const connectBtn = root.querySelector('#connectSpotify');
  const disconnectBtn = root.querySelector('#disconnectSpotify');
  if (connectBtn)    connectBtn.onclick    = () => startLogin();
  if (disconnectBtn) disconnectBtn.onclick = () => { disconnect(); renderProfile(root); };
  root.querySelector('#logout').onclick = () => logout();

  // ---- friend requests + friends list ----
  await refreshFriendsUI(root);

  // ---- find people ----
  const findInput   = root.querySelector('#findUser');
  const findResults = root.querySelector('#findResults');
  let findTimer;
  findInput.oninput = () => {
    clearTimeout(findTimer);
    const q = findInput.value.trim().toLowerCase();
    if (!q) { findResults.innerHTML = ''; return; }
    findTimer = setTimeout(async () => {
      try {
        const all = await getAllUsers();
        const me  = await ensureUserDoc();
        const matches = all.filter((u) =>
          u.uid !== auth.currentUser.uid &&
          ((u.displayName || '').toLowerCase().includes(q) ||
           (u.email       || '').toLowerCase().includes(q))
        ).slice(0, 8);
        const myFriendsSet = new Set(me?.friends || []);
        const outgoing = await getOutgoingRequests();
        const pendingSet = new Set(outgoing.map((r) => r.toUid));

        if (matches.length === 0) { findResults.innerHTML = `<div class="empty" style="padding: 1rem;">No one found.</div>`; return; }
        findResults.innerHTML = matches.map((u) => {
          const status = myFriendsSet.has(u.uid)
            ? `<span class="meta">friends ✓</span>`
            : pendingSet.has(u.uid)
              ? `<span class="meta">requested</span>`
              : `<button class="ghost addFriend" data-uid="${esc(u.uid)}">Add friend</button>`;
          return `
            <div class="user-row">
              <div>
                <div class="song">${esc(u.displayName || 'someone')}</div>
                <div class="meta">${esc(u.email || '')}</div>
              </div>
              <div>${status}</div>
            </div>`;
        }).join('');
        findResults.querySelectorAll('.addFriend').forEach((b) => {
          b.onclick = async () => {
            b.disabled = true;
            try { await sendFriendRequest(b.dataset.uid); b.outerHTML = `<span class="meta">requested</span>`; }
            catch (e) { console.warn(e); b.disabled = false; }
          };
        });
      } catch (e) {
        findResults.innerHTML = `<div class="error">${esc(e.message)}</div>`;
      }
    }, 250);
  };

  // ---- archive (your memories) ----
  const archive = root.querySelector('#archive');
  try {
    const mine = await getMyMemories();
    if (mine.length === 0) {
      archive.innerHTML = `<div class="empty">Nothing logged yet. <a href="#/log">Log your first memory →</a></div>`;
    } else {
      archive.innerHTML = `<div class="archive-grid">${mine.map((m) => `
        <a class="archive-card" href="#/memory/${esc(m.id)}">
          ${m.song?.albumArt ? `<img src="${esc(m.song.albumArt)}" />` : '<div class="ph"></div>'}
          <div class="info">
            <div class="song">${esc(m.song?.name || 'Untitled')}</div>
            <div class="artist">${esc((m.song?.artists || []).join(', '))}</div>
            <div class="meta">${m.date ? new Date(m.date).toLocaleDateString() : ''} · +${m.resonance ?? 0}</div>
          </div>
        </a>
      `).join('')}</div>`;
    }
  } catch (e) {
    archive.innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }

  // ---- seed ----
  const seedBtn      = root.querySelector('#seedBtn');
  const clearSeedBtn = root.querySelector('#clearSeedBtn');
  const seedStatus   = root.querySelector('#seedStatus');
  seedBtn.onclick = async () => {
    seedBtn.disabled = true;
    clearSeedBtn.disabled = true;
    try {
      await seedAll(({ stage, done, total }) => {
        const label = stage === 'clear' ? 'wiping prior seed'
                    : stage === 'spotify' ? 'resolving spotify songs'
                    : 'writing memories + AI images';
        seedStatus.textContent = `${label}: ${done}/${total}…`;
      });
      seedStatus.textContent = 'Seeded. Check Discovery + Feed.';
    } catch (e) { seedStatus.textContent = `Failed: ${e.message}`; }
    finally { seedBtn.disabled = false; clearSeedBtn.disabled = false; }
  };
  clearSeedBtn.onclick = async () => {
    if (!confirm('Wipe ALL seeded memories and comments? This cannot be undone.')) return;
    seedBtn.disabled = true;
    clearSeedBtn.disabled = true;
    try {
      const { done, total } = await clearSeedData(({ done, total }) => {
        seedStatus.textContent = `clearing: ${done}/${total}…`;
      });
      seedStatus.textContent = `Cleared ${done}/${total} seeded memories.`;
    } catch (e) { seedStatus.textContent = `Failed: ${e.message}`; }
    finally { seedBtn.disabled = false; clearSeedBtn.disabled = false; }
  };
}

async function refreshFriendsUI(root) {
  const reqEl    = root.querySelector('#friendRequests');
  const friendsEl = root.querySelector('#friendsList');
  try {
    const incoming = await getIncomingRequests();
    if (incoming.length) {
      reqEl.innerHTML = `
        <div class="card">
          <div class="meta">Incoming friend requests</div>
          ${incoming.map((r) => `
            <div class="user-row">
              <div>
                <div class="song">${esc(r.fromName || 'someone')}</div>
                <div class="meta">${esc(r.fromEmail || '')}</div>
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <button class="acceptReq" data-id="${esc(r.id)}">Accept</button>
                <button class="ghost rejectReq" data-id="${esc(r.id)}">Reject</button>
              </div>
            </div>
          `).join('')}
        </div>`;
      reqEl.querySelectorAll('.acceptReq').forEach((b) => {
        b.onclick = async () => { await acceptFriendRequest(b.dataset.id); refreshFriendsUI(root); };
      });
      reqEl.querySelectorAll('.rejectReq').forEach((b) => {
        b.onclick = async () => { await rejectFriendRequest(b.dataset.id); refreshFriendsUI(root); };
      });
    } else { reqEl.innerHTML = ''; }

    const friends = await getMyFriends();
    if (friends.length) {
      friendsEl.innerHTML = `
        <div class="card">
          <div class="meta">Your friends (${friends.length})</div>
          ${friends.map((f) => `
            <div class="user-row">
              <div>
                <div class="song">${esc(f.displayName || 'someone')}</div>
                <div class="meta">${esc(f.email || '')}</div>
              </div>
              <button class="ghost unfriendBtn" data-uid="${esc(f.uid)}">Unfriend</button>
            </div>
          `).join('')}
        </div>`;
      friendsEl.querySelectorAll('.unfriendBtn').forEach((b) => {
        b.onclick = async () => { await unfriend(b.dataset.uid); refreshFriendsUI(root); };
      });
    } else {
      friendsEl.innerHTML = `<div class="card"><div class="meta">No friends yet</div><div style="color: var(--text-dim);">Find people below and send a friend request. Once they accept, you can compare taste in <b>Me &amp; Friends</b> on Discovery.</div></div>`;
    }
  } catch (e) {
    console.warn('friends refresh:', e);
  }
}
