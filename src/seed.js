// ============================================================================
//  SONDER — SEED (fake users + memories for Discovery demo)
// ============================================================================
//  Six archetype users, each with ~6–7 songs that match their "taste profile".
//  Each song is looked up live via Spotify search — so you need to be connected
//  to Spotify before seeding.
//
//  WARNING: writes memories under FAKE uids. Your Firestore rules must allow
//  unauthenticated writes (test mode). Remove after demo.
// ============================================================================

import { createSeedMemory } from './firebase.js';
import { searchTracks } from './spotify.js';

const SEED_USERS = [
  {
    uid: 'seed-bedroom-pop',  name: 'Ava',    email: 'ava@sonder.demo',
    tracks: [
      'Mitski Nobody',
      'Clairo Pretty Girl',
      'Beabadoobee Coffee',
      'Cuco Lo Que Siento',
      'boy pablo Everytime',
      'Rex Orange County Loving Is Easy'
    ]
  },
  {
    uid: 'seed-hip-hop',      name: 'Marcus', email: 'marcus@sonder.demo',
    tracks: [
      'Tyler, The Creator EARFQUAKE',
      'Kendrick Lamar HUMBLE',
      'Frank Ocean Nights',
      'Travis Scott SICKO MODE',
      'JID Surround Sound',
      'Denzel Curry Ultimate'
    ]
  },
  {
    uid: 'seed-indie-folk',   name: 'Nora',   email: 'nora@sonder.demo',
    tracks: [
      'Phoebe Bridgers Motion Sickness',
      'Big Thief Not',
      'Bon Iver Holocene',
      'Fleet Foxes White Winter Hymnal',
      'Sufjan Stevens Mystery of Love',
      'Julien Baker Appointments'
    ]
  },
  {
    uid: 'seed-hyperpop',     name: 'Kai',    email: 'kai@sonder.demo',
    tracks: [
      '100 gecs money machine',
      'SOPHIE Immaterial',
      'Charli XCX Vroom Vroom',
      'underscores Spoiled Little Brat',
      'Dorian Electra Flamboyant',
      'glaive detest me'
    ]
  },
  {
    uid: 'seed-jazz',         name: 'Eli',    email: 'eli@sonder.demo',
    tracks: [
      'Miles Davis So What',
      'John Coltrane Naima',
      'Thelonious Monk Round Midnight',
      'Chet Baker My Funny Valentine',
      'Bill Evans Peace Piece',
      'Herbie Hancock Maiden Voyage'
    ]
  },
  {
    uid: 'seed-classical',    name: 'Iris',   email: 'iris@sonder.demo',
    tracks: [
      'Debussy Clair de Lune',
      'Erik Satie Gymnopedie No 1',
      'Max Richter On the Nature of Daylight',
      'Ludovico Einaudi Nuvole Bianche',
      'Philip Glass Metamorphosis Two',
      'Chopin Nocturne Op 9 No 2'
    ]
  }
];

const NOTES = [
  'played on loop last summer',
  'reminded me of my first year in the city',
  'drove everyone crazy at 2am',
  'studying in the library',
  'walking home in the rain',
  'late night in the kitchen',
  'long train ride',
  'the week after the breakup',
  'first good day in a while'
];
const LOCATIONS = ['Brooklyn, NY', 'LA, CA', 'Tokyo, JP', 'Paris, FR', 'Berlin, DE', 'Austin, TX'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomDate() {
  const d = new Date(Date.now() - Math.random() * 365 * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}


// ============================================================================
//  [RUN]  seedAll — loops users × tracks, searches Spotify, writes to Firestore
// ============================================================================
export async function seedAll(onProgress = () => {}) {
  let done = 0;
  const total = SEED_USERS.reduce((n, u) => n + u.tracks.length, 0);

  for (const u of SEED_USERS) {
    for (const q of u.tracks) {
      try {
        const [hit] = await searchTracks(q, 1);
        if (!hit?.spotifyId) { console.warn(`[seed] no result for "${q}"`); done++; continue; }
        await createSeedMemory({
          uid: u.uid,
          authorName:  u.name,
          authorEmail: u.email,
          song:        hit,
          note:        pick(NOTES),
          location:    pick(LOCATIONS),
          date:        randomDate(),
          isPublic:    true
        });
      } catch (e) {
        console.warn(`[seed] failed "${q}":`, e.message);
      }
      done++;
      onProgress({ done, total });
    }
  }
  return { done, total };
}
