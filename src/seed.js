// ============================================================================
//  SONDER — DEMO SEED (50 users × 3 memories + AI images + comments + +1s)
// ============================================================================
//  Why this exists:
//    For class demos, the constellation needs a populated dataset out of the
//    box. This seed builds:
//      • 50 fake users with varied names + emails
//      • 3 memories per user (150 memories total) — each with a real song
//        looked up live via Spotify, a curated note, a feeling tag pulled
//        from the same DEFAULT_FEELINGS list the Feels view uses (so every
//        cluster has actual content), and an AI-generated image via the
//        Replicate proxy (flux-schnell). Falls back to album art if the
//        image-gen call fails.
//      • Cross-user +1 resonance so the feed isn't all zeros
//      • 1–3 random comments per memory from other fake users
//
//  WARNING: writes under fake uids. Firestore must allow unauthenticated
//  writes (test mode). All seed docs carry isSeed: true so clearSeedData()
//  can wipe them.
//
//  Two exports:
//     seedAll(onProgress)     — runs the full demo seed
//     clearSeedData(onProgress) — re-exported for the Profile dev panel
// ============================================================================

import { createSeedMemory, createSeedComment, clearSeedData } from './firebase.js';
import { searchTracks } from './spotify.js';
import { generateImage } from './replicate.js';

export { clearSeedData };

// 50 first names, paired into 50 user records below.
const FIRST_NAMES = [
  'Ava', 'Marcus', 'Nora', 'Kai', 'Eli', 'Iris', 'Leo', 'Maya', 'Jonah', 'Sara',
  'Theo', 'Zoe', 'Felix', 'Luna', 'Jude', 'Mira', 'Owen', 'Hana', 'Beau', 'Ruth',
  'Ezra', 'Vera', 'Cody', 'Lily', 'Rafa', 'Ines', 'Niko', 'Tess', 'Asa', 'Wren',
  'Cleo', 'Reza', 'Soren', 'Anya', 'Milo', 'Skye', 'Otis', 'Romy', 'Caio', 'Juno',
  'Dax', 'Esme', 'Hugo', 'Pia', 'Quill', 'Sade', 'Tova', 'Yara', 'Zane', 'Nia'
];

// 30-song pool. Each entry has only the search query + a curated feeling
// (the cluster anchor for that song). NOTES + IMAGE PROMPTS are generated
// PER MEMORY below, not per song — so two users sharing a song still get
// different scenes and different AI photos.
const SONG_POOL = [
  { q: 'Mitski Nobody',                          feel: 'lonely' },
  { q: 'Phoebe Bridgers Motion Sickness',        feel: 'heartbroken' },
  { q: 'Bon Iver Holocene',                      feel: 'nostalgic' },
  { q: 'Frank Ocean Nights',                     feel: 'tender' },
  { q: 'Kendrick Lamar HUMBLE',                  feel: 'energized' },
  { q: 'Tyler, The Creator EARFQUAKE',           feel: 'euphoric' },
  { q: 'Clairo Pretty Girl',                     feel: 'tender' },
  { q: 'Beabadoobee Coffee',                     feel: 'calm' },
  { q: 'Sufjan Stevens Mystery of Love',         feel: 'tender' },
  { q: 'Big Thief Not',                          feel: 'rage' },
  { q: 'Fleet Foxes White Winter Hymnal',        feel: 'nostalgic' },
  { q: 'Charli XCX Vroom Vroom',                 feel: 'euphoric' },
  { q: '100 gecs money machine',                 feel: 'rage' },
  { q: 'SOPHIE Immaterial',                      feel: 'euphoric' },
  { q: 'Miles Davis So What',                    feel: 'calm' },
  { q: 'John Coltrane Naima',                    feel: 'tender' },
  { q: 'Chet Baker My Funny Valentine',          feel: 'melancholy' },
  { q: 'Bill Evans Peace Piece',                 feel: 'calm' },
  { q: 'Debussy Clair de Lune',                  feel: 'melancholy' },
  { q: 'Erik Satie Gymnopedie No 1',             feel: 'melancholy' },
  { q: 'Max Richter On the Nature of Daylight',  feel: 'heartbroken' },
  { q: 'Ludovico Einaudi Nuvole Bianche',        feel: 'hopeful' },
  { q: 'Rex Orange County Loving Is Easy',       feel: 'hopeful' },
  { q: 'Cuco Lo Que Siento',                     feel: 'tender' },
  { q: 'Travis Scott SICKO MODE',                feel: 'energized' },
  { q: 'JID Surround Sound',                     feel: 'energized' },
  { q: 'Julien Baker Appointments',              feel: 'lonely' },
  { q: 'Philip Glass Metamorphosis Two',         feel: 'melancholy' },
  { q: 'Chopin Nocturne Op 9 No 2',              feel: 'melancholy' },
  { q: 'Kanye West Runaway',                     feel: 'heartbroken' }
];

// ---- Per-memory composition palette (mixed at write time so each of the
// 150 memories gets a unique scenario, image prompt, and note) -----------
const SCENES_BY_FEELING = {
  lonely:      ['walking home from a party that ended too early', 'sitting on the fire escape at 3am', 'the empty subway car after midnight', 'a hotel room in a city you don\'t know', 'staring at the ceiling fan', 'an empty diner booth', 'parking lot after the show', 'an unmade bed at noon'],
  heartbroken: ['the week after the breakup', 'their hoodie still on the chair', 'their last text unread', 'a half-empty bottle of wine', 'driving past their old block', 'cleaning out the desk drawer', 'crying in the bathroom at work', 'their playlist still saved'],
  nostalgic:   ['the basement at my parents\' house', 'an old polaroid on the fridge', 'driving past my high school', 'the first apartment with three friends', 'a dusty cassette tape', 'the backseat of a Honda Civic', 'summer at the lake house', 'walking through campus alone'],
  tender:      ['making breakfast for two', 'her hand on the steering wheel', 'falling asleep on the couch', 'sharing earbuds on the train', 'first slow dance', 'sunday morning, no plans', 'reading in the same room', 'your dog asleep on your chest'],
  euphoric:    ['the drop hit at 2am', 'rooftop party as the sun came up', 'sprinting down the boardwalk', 'top down on the PCH', 'pre-game in the dorm bathroom', 'finding strangers who knew the song', 'the encore', 'driving with the windows down'],
  melancholy:  ['rainy window in the studio', 'museum on a tuesday afternoon', 'long train ride upstate', 'staring at the bay alone', 'old letters from a desk drawer', 'walking through the cemetery', 'a half-finished painting', 'the apartment in winter'],
  calm:        ['sunday morning, no plans', 'a steaming cup of tea by the window', 'reading on a hammock', 'making soup from scratch', 'the cat asleep in a sunbeam', 'first snowfall of the year', 'a bath at the end of the week', 'an early walk before the city woke up'],
  hopeful:     ['the first morning of the trip', 'walking to her place in spring', 'the day I got the news', 'first day at the new job', 'sunrise after the all-nighter', 'opening the acceptance letter', 'first snow of the year', 'graduation morning'],
  energized:   ['gym at 6am before everything started', 'first night out after finals', 'pre-show in the green room', 'sprint workout on the track', 'pre-game in the locker room', 'closing shift kitchen rush', 'studio at 2am working on the verse', 'race day morning'],
  rage:        ['screamed it driving back from work', 'after the fight with my dad', 'parking lot after I got fired', 'kicking a wall in the alley', 'midnight in the practice room', 'punching the bag at the gym', 'pacing the apartment', 'driving 95 on the interstate']
};

const NOTE_OPENERS = ['', 'i remember ', 'this song was ', 'kept replaying it ', 'somehow this hit during ', 'on loop while ', 'literally the soundtrack to '];
const NOTE_CLOSERS = ['', ' — felt every word', '. couldn\'t stop crying', '. don\'t know why it stuck', '. weirdly perfect', '. on repeat all month', '. still think about that night', ''];

// Photographic style fragments combined into the AI image prompt for variety.
const PHOTO_STYLES = [
  '35mm film photo', 'polaroid', 'medium-format film', 'kodak portra 400',
  'cinemagraph still', 'fujifilm superia', 'disposable camera flash',
  'tungsten film', 'cinéma vérité still', 'super 8 frame'
];
const PHOTO_LIGHTS = [
  'golden hour', 'blue hour', '3am', 'overcast afternoon', 'rainy window light',
  'neon-lit night', 'soft tungsten lamp', 'fluorescent bathroom', 'dawn fog',
  'fluorescent subway car'
];
const PHOTO_MOODS = [
  'cinematic', 'intimate', 'lonely', 'grainy', 'dreamy',
  'documentary', 'unposed', 'quiet', 'tender', 'pensive'
];

const COMMENT_POOL = [
  'this is so me right now',
  'havent listened in years',
  'crying in the club',
  'sent this to my ex',
  'this song raised me',
  'omg the bridge',
  'literally my anthem',
  'this lives in my head rent free',
  '3am thoughts',
  'putting this on my playlist now',
  'no notes',
  'this hits',
  'i felt this in my bones',
  'youre not alone in this one',
  'replayed 8 times today',
  'ok this is a vibe',
  'this changed me',
  'feels illegal to listen to this in the daytime'
];

const LOCATIONS = [
  'Brooklyn, NY', 'LA, CA', 'Tokyo, JP', 'Paris, FR', 'Berlin, DE', 'Austin, TX',
  'London, UK', 'Mexico City, MX', 'Seoul, KR', 'Lisbon, PT', 'Chicago, IL',
  'Portland, OR', 'Toronto, CA', 'Stockholm, SE'
];

function pick(arr)        { return arr[Math.floor(Math.random() * arr.length)]; }
function pickN(arr, n)    { return [...arr].sort(() => Math.random() - 0.5).slice(0, n); }
function randomDate() {
  const d = new Date(Date.now() - Math.random() * 365 * 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function uidFor(i) { return `seed-user-${String(i).padStart(2, '0')}`; }

// Build the 50 users from the name list — uniform structure for fair sampling.
const SEED_USERS = FIRST_NAMES.slice(0, 50).map((name, i) => ({
  uid:   uidFor(i),
  name,
  email: `${name.toLowerCase()}.${String(i).padStart(2, '0')}@sonder.demo`
}));


// ============================================================================
//  [RUN]  seedAll — wipes prior seed, then writes 50×3 memories
// ============================================================================
export async function seedAll(onProgress = () => {}) {
  // 1) Clear any prior seed first so re-running doesn't pile up duplicates.
  onProgress({ stage: 'clear', done: 0, total: 0 });
  await clearSeedData(({ done, total }) => onProgress({ stage: 'clear', done, total }));

  // 2) Resolve every distinct song query against Spotify ONCE — avoids 90 redundant
  //    searches when songs repeat across users.
  onProgress({ stage: 'spotify', done: 0, total: SONG_POOL.length });
  const resolved = new Map();
  let r = 0;
  for (const s of SONG_POOL) {
    try {
      const [hit] = await searchTracks(s.q, 1);
      if (hit?.spotifyId) resolved.set(s.q, hit);
    } catch (e) { console.warn(`[seed] spotify "${s.q}":`, e.message); }
    r++;
    onProgress({ stage: 'spotify', done: r, total: SONG_POOL.length });
  }

  // 3) Build the planned memory list (50 × 3 = 150). Pick songs randomly per user,
  //    no repeats within a single user. Each memory composes its OWN unique
  //    scene/note/image-prompt — songs may repeat across users but the experience
  //    on top of them is always different.
  const plan = [];
  let memSeq = 0;
  for (const u of SEED_USERS) {
    const songs = pickN(SONG_POOL, 3);
    for (const s of songs) {
      const hit = resolved.get(s.q);
      if (!hit) continue;
      const scene    = pick(SCENES_BY_FEELING[s.feel] || SCENES_BY_FEELING.calm);
      const note     = `${pick(NOTE_OPENERS)}${scene}${pick(NOTE_CLOSERS)}`.trim();
      // Memory-unique image prompt: mix style + light + mood + scene + a numeric
      // tag so the IMAGE_CACHE can never collide with another memory's prompt.
      const imgPrompt = `${pick(PHOTO_STYLES)}, ${pick(PHOTO_MOODS)}, ${scene}, ${pick(PHOTO_LIGHTS)}, no text, no watermark, no logos, candid, --ref-${memSeq}`;
      plan.push({ user: u, song: hit, feeling: s.feel, note, imgPrompt });
      memSeq++;
    }
  }

  // 4) Write each memory: AI image (best-effort) → createSeedMemory → comments.
  //    +1 likes are randomized per memory at write time using a sample of
  //    other-user uids, so the feed has a varied resonance ranking.
  const total = plan.length;
  let done = 0;
  const memoryIds = [];
  for (const p of plan) {
    onProgress({ stage: 'memories', done, total });

    // AI image via Replicate proxy. 8s soft-timeout → falls back to album art.
    let photoUrl = null;
    try {
      photoUrl = await Promise.race([
        generateImage(p.imgPrompt),
        new Promise((res) => setTimeout(() => res(null), 8000))
      ]);
    } catch {}

    // Random +1s from 0–14 other users.
    const others = SEED_USERS.filter((x) => x.uid !== p.user.uid);
    const k = Math.floor(Math.random() * 15);
    const resonators = pickN(others, k).map((u) => u.uid);

    // Multi-feeling tag list — primary + a couple of related from the pool so
    // memories don't sit on a single feeling. First entry is the cluster anchor.
    const otherFeelings = pickN(
      ['nostalgic', 'euphoric', 'melancholy', 'calm', 'hopeful',
       'heartbroken', 'energized', 'tender', 'lonely', 'rage'].filter((f) => f !== p.feeling),
      2
    );
    const feelings = [p.feeling, ...otherFeelings];

    let ref;
    try {
      ref = await createSeedMemory({
        uid:         p.user.uid,
        authorName:  p.user.name,
        authorEmail: p.user.email,
        song:        p.song,
        note:        p.note,
        location:    pick(LOCATIONS),
        photoUrl,
        date:        randomDate(),
        isPublic:    true,
        feelings,
        resonance:   resonators.length,
        resonators
      });
    } catch (e) { console.warn('[seed] memory write failed:', e.message); done++; continue; }

    memoryIds.push(ref.id);

    // 1–3 comments per memory from random other users.
    const cN = 1 + Math.floor(Math.random() * 3);
    const commenters = pickN(others, cN);
    for (const c of commenters) {
      try {
        await createSeedComment(ref.id, {
          uid: c.uid, name: c.name, email: c.email, text: pick(COMMENT_POOL)
        });
      } catch {}
    }

    done++;
    onProgress({ stage: 'memories', done, total });
  }

  return { done, total };
}
