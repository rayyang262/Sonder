// ============================================================================
//  SONDER — APP ENTRY (router + auth + nav + boot)
// ============================================================================
//  Sections:
//     [ROUTES]      url → screen mapping
//     [ROUTER]      hash-based router internals
//     [NAV]         top navigation bar
//     [BOOT]        wire up Firebase auth + start the router
// ============================================================================

import { onAuth, logout, ensureUserDoc } from './firebase.js';
import { handleCallback } from './spotify.js';
import {
  renderLogin, renderFeed, renderLog,
  renderMemory, renderDiscovery, renderProfile,
  renderOnboarding, renderRoom
} from './screens.js';

let currentUser = null;
let userDoc = null;
let authReady = false;


// ============================================================================
//  [ROUTER]  tiny hash-based router
// ============================================================================
const routes = {};

function route(path, handler) { routes[path] = handler; }

export function navigate(path) {
  if (window.location.hash === `#${path}`) rerender();
  else window.location.hash = path;
}

export function getCurrentUserDoc() { return userDoc; }

function rerender() {
  renderNav();
  const app = document.getElementById('app');
  app.style.maxWidth = '';
  app.style.padding  = '';
  const path = window.location.hash.slice(1) || '/';
  const segs = path.split('/').filter(Boolean);
  const root = segs.length ? `/${segs[0]}` : '/';
  const param = segs.slice(1).join('/');  // allow multi-segment params (e.g. feeling names with spaces)
  const handler = routes[root] || routes['/'];
  handler(app, param);
}


// ============================================================================
//  [ROUTES]  url → screen mapping
// ============================================================================
//  Default landing (after login + onboarding) is Discovery.
// ============================================================================
route('/', (root) => {
  if (!authReady) { root.innerHTML = ''; return; }
  if (!currentUser) return renderLogin(root);
  if (userDoc && !userDoc.onboarded) return renderOnboarding(root);
  return renderDiscovery(root);
});
route('/feed',      (root)        => currentUser ? renderFeed(root)         : renderLogin(root));
route('/log',       (root)        => currentUser ? renderLog(root)          : renderLogin(root));
route('/memory',    (root, id)    => currentUser ? renderMemory(root, id)   : renderLogin(root));
route('/discovery', (root)        => currentUser ? renderDiscovery(root)    : renderLogin(root));
route('/profile',   (root)        => currentUser ? renderProfile(root)      : renderLogin(root));
route('/room',      (root, name)  => currentUser ? renderRoom(root, decodeURIComponent(name || ''))   : renderLogin(root));
route('/onboarding',(root)        => currentUser ? renderOnboarding(root)   : renderLogin(root));


// ============================================================================
//  [NAV]  top navigation bar
// ============================================================================
function renderNav() {
  const nav = document.getElementById('nav');
  if (!currentUser) {
    nav.innerHTML = `<div class="brand">SONDER</div>`;
    return;
  }
  nav.innerHTML = `
    <a href="#/" class="brand">SONDER</a>
    <div class="links">
      <a href="#/">Discovery</a>
      <a href="#/feed">Feed</a>
      <a href="#/log">Log</a>
      <a href="#/profile">Profile</a>
      <a href="#" id="logoutLink">Logout</a>
    </div>
  `;
  document.getElementById('logoutLink').onclick = (e) => {
    e.preventDefault();
    logout();
  };
}


// ============================================================================
//  [BOOT]  wire up Firebase auth + start the router
// ============================================================================
handleCallback().catch((e) => console.error('Spotify callback error:', e));

onAuth(async (user) => {
  currentUser = user;
  authReady = true;
  if (user) {
    try { userDoc = await ensureUserDoc(); } catch (e) { console.warn('user doc:', e); userDoc = null; }
  } else {
    userDoc = null;
  }
  rerender();
});

window.addEventListener('hashchange', rerender);
rerender();
