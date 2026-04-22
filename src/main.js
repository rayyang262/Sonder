// ============================================================================
//  SONDER — APP ENTRY (router + auth + nav + boot)
// ============================================================================
//  Sections:
//     [ROUTES]      url → screen mapping
//     [ROUTER]      hash-based router internals
//     [NAV]         top navigation bar
//     [BOOT]        wire up Firebase auth + start the router
// ============================================================================

import { onAuth, logout } from './firebase.js';
import { handleCallback } from './spotify.js';
import {
  renderLogin, renderFeed, renderLog,
  renderMemory, renderDiscovery, renderProfile
} from './screens.js';

let currentUser = null;
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

function rerender() {
  renderNav();
  const app = document.getElementById('app');
  // Feed + Discovery break out of the container with inline styles; reset
  // them each route change so other screens get the default padded layout.
  app.style.maxWidth = '';
  app.style.padding  = '';
  const path = window.location.hash.slice(1) || '/';
  const segs = path.split('/').filter(Boolean);
  const root = segs.length ? `/${segs[0]}` : '/';
  const param = segs[1];
  const handler = routes[root] || routes['/'];
  handler(app, param);
}


// ============================================================================
//  [ROUTES]  url → screen mapping
// ============================================================================
route('/',          (root)        => {
  if (!authReady) { root.innerHTML = ''; return; }
  if (!currentUser) return renderLogin(root);
  return renderFeed(root);
});
route('/log',       (root)        => currentUser ? renderLog(root)        : renderLogin(root));
route('/memory',    (root, id)    => currentUser ? renderMemory(root, id) : renderLogin(root));
route('/discovery', (root)        => currentUser ? renderDiscovery(root)  : renderLogin(root));
route('/profile',   (root)        => currentUser ? renderProfile(root)    : renderLogin(root));


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
      <a href="#/">Feed</a>
      <a href="#/log">Log</a>
      <a href="#/discovery">Discovery</a>
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

// Handle Spotify OAuth callback first (if we landed here with ?code=...)
handleCallback().catch((e) => console.error('Spotify callback error:', e));

onAuth((user) => {
  currentUser = user;
  authReady = true;
  rerender();
});

window.addEventListener('hashchange', rerender);
rerender();
