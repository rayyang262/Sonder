# Sonder

A music memory archive where songs pin to life moments, and users discover each other through the shape of their listening.

**Live site →** https://sonder-music-web.web.app/

Built with Vite + Firebase (Auth, Firestore, Hosting), Three.js, and client-side UMAP.

## What it does

- **Log** — tag a Spotify track with a moment, mood, and note.
- **Feed** — editorial full-bleed layout: a vinyl disc clipped 60% off-screen spins up on hover, swaps its label art, and streams a 30s preview.
- **Memory** — permalink page for a single logged song.
- **Discovery** — a 3D constellation where every user is a star. Two UMAP projections:
  - **Sound** — multi-hot genre vectors with artist-id fallback columns.
  - **Social** — co-logger bits blended with an L2-normalized taste profile.
  Own-user stars are brightened; gold halos mark taste crossings.
- **Profile** — your logged memories at a glance.

## Stack

- **Frontend** — Vite, vanilla ES modules, hash-based SPA router
- **Auth + DB + Hosting** — Firebase
- **Music data** — Spotify Web API via PKCE OAuth 2.0 (no server secret)
- **Audio previews** — iTunes Search API fallback (Spotify deprecated `preview_url` in Nov 2024)
- **3D** — Three.js (WebGLRenderer, OrbitControls, Raycaster)
- **Dimensionality reduction** — `umap-js` in the browser
- **Type** — Space Grotesk (display) + Inter (body) on a cream/black palette

## Structure
- src/
- main.js router + auth boot + nav
- screens.js Feed, Log, Memory, Discovery, Profile
- firebase.js auth + Firestore wrappers
- spotify.js PKCE OAuth + search
- preview.js iTunes preview resolver (cached)
- umap.js Sound + Social projection builders
- style.css editorial theme
