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

// 30-song pool. Each entry includes a curated feeling that maps to one of the
// DEFAULT_FEELINGS clusters in umap.js, plus a one-line note seed and an
// image-prompt scaffold. Songs repeat across users on purpose — that's how
// "shared songs" gold halos appear in Discovery.
const SONG_POOL = [
  { q: 'Mitski Nobody',                              feel: 'lonely',     note: 'walking home alone after the party',       img: 'a person walking down an empty city street at 2am, soft streetlights, cinematic film grain' },
  { q: 'Phoebe Bridgers Motion Sickness',            feel: 'heartbroken',note: 'the week after we stopped texting',         img: 'a quiet bedroom with rumpled sheets, late afternoon light, melancholic, film photography' },
  { q: 'Bon Iver Holocene',                          feel: 'nostalgic',  note: 'snow on the windshield driving home',       img: 'a snowy mountain road through a windshield, soft winter light, nostalgic, film photo' },
  { q: 'Frank Ocean Nights',                         feel: 'tender',     note: 'late drives with my best friend',           img: 'two friends in a car at night, dashboard glow, warm, intimate, film photo' },
  { q: 'Kendrick Lamar HUMBLE',                      feel: 'energized',  note: 'gym at 6am before everything started',      img: 'a sunlit gym window in the morning, dust in the air, motivational, film photo' },
  { q: 'Tyler, The Creator EARFQUAKE',               feel: 'euphoric',   note: 'hit different on the rooftop',              img: 'a rooftop party at golden hour, friends laughing, lens flare, film photo' },
  { q: 'Clairo Pretty Girl',                         feel: 'tender',     note: 'getting ready in the mirror',               img: 'a vanity mirror surrounded by warm bulbs, soft pastel light, intimate, film photo' },
  { q: 'Beabadoobee Coffee',                         feel: 'calm',       note: 'sunday morning, no plans',                  img: 'a steaming coffee cup on a windowsill, gentle morning light, calm, film photo' },
  { q: 'Sufjan Stevens Mystery of Love',             feel: 'tender',     note: 'first kiss on the beach',                   img: 'two silhouettes on a quiet beach at dusk, romantic, soft pastels, film photo' },
  { q: 'Big Thief Not',                              feel: 'rage',       note: 'screamed it driving back from work',        img: 'a long highway at dusk through a car window, raw emotion, film photo' },
  { q: 'Fleet Foxes White Winter Hymnal',            feel: 'nostalgic',  note: 'kindergarten memories somehow',              img: 'a snow-covered playground at dawn, nostalgic, soft cool light, film photo' },
  { q: 'Charli XCX Vroom Vroom',                     feel: 'euphoric',   note: 'pre-game in the dorm bathroom',             img: 'neon-lit bathroom mirror selfies, vibrant, film photo, after-hours' },
  { q: '100 gecs money machine',                     feel: 'rage',       note: 'screaming in the car at 1am',               img: 'red and purple neon lights blurring past a car window, chaotic energy, film photo' },
  { q: 'SOPHIE Immaterial',                          feel: 'euphoric',   note: 'dancing in the kitchen alone',              img: 'a young person dancing in a softly lit kitchen, joyful, film photo' },
  { q: 'Miles Davis So What',                        feel: 'calm',       note: 'sunday afternoon with the cat',             img: 'a sunlit living room with vinyl player, cat sleeping on couch, film photo' },
  { q: 'John Coltrane Naima',                        feel: 'tender',     note: 'long quiet evening',                        img: 'a single floor lamp lighting a wooden room at night, contemplative, film photo' },
  { q: 'Chet Baker My Funny Valentine',              feel: 'melancholy', note: 'the apartment after she left',              img: 'an empty kitchen with two coffee cups, soft morning light, film photo' },
  { q: 'Bill Evans Peace Piece',                     feel: 'calm',       note: 'rainy window in the studio',                img: 'rain on a window, a record player out of focus, melancholic peace, film photo' },
  { q: 'Debussy Clair de Lune',                      feel: 'melancholy', note: 'walking through the museum alone',          img: 'a long museum hall with sun streaming through tall windows, solitary figure, film photo' },
  { q: 'Erik Satie Gymnopedie No 1',                 feel: 'melancholy', note: 'studying for the final',                    img: 'a desk lamp on a stack of notes at 2am, soft warm tones, film photo' },
  { q: 'Max Richter On the Nature of Daylight',      feel: 'heartbroken',note: 'the funeral',                                img: 'an empty wooden chapel with sunlight through stained glass, somber, film photo' },
  { q: 'Ludovico Einaudi Nuvole Bianche',            feel: 'hopeful',    note: 'first morning of the trip',                  img: 'a wide view of mountains at dawn, hopeful, soft pastel, film photo' },
  { q: 'Rex Orange County Loving Is Easy',           feel: 'hopeful',    note: 'walking to her place',                       img: 'a sunlit suburban sidewalk in spring, blossom petals, hopeful, film photo' },
  { q: 'Cuco Lo Que Siento',                         feel: 'tender',     note: 'beach trip after graduation',               img: 'a beach bonfire at twilight, friends silhouetted, warm, film photo' },
  { q: 'Travis Scott SICKO MODE',                    feel: 'energized',  note: 'pre-game lockerroom',                       img: 'a dim locker room with one shaft of overhead light, intense, film photo' },
  { q: 'JID Surround Sound',                         feel: 'energized',  note: 'first day of the new job',                  img: 'a sunny morning subway platform, motion blur, focused, film photo' },
  { q: 'Julien Baker Appointments',                  feel: 'lonely',     note: 'therapy waiting room',                       img: 'a beige waiting room chair with afternoon sun on the carpet, melancholic, film photo' },
  { q: 'Philip Glass Metamorphosis Two',             feel: 'melancholy', note: 'long train ride upstate',                   img: 'a train window with rolling hills passing in autumn, contemplative, film photo' },
  { q: 'Chopin Nocturne Op 9 No 2',                  feel: 'melancholy', note: 'rainy night studying alone',                img: 'a lamp-lit desk near a rainy window at night, peaceful loneliness, film photo' },
  { q: 'Kanye West Runaway',                         feel: 'heartbroken',note: 'the night I knew it was over',              img: 'a lone figure at a piano in a vast empty room, dramatic, film photo' }
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
  //    no repeats within a single user. Carry feeling + image prompt + note seed.
  const plan = [];
  for (const u of SEED_USERS) {
    const songs = pickN(SONG_POOL, 3);
    for (const s of songs) {
      const hit = resolved.get(s.q);
      if (!hit) continue;
      plan.push({ user: u, song: hit, feeling: s.feel, noteBase: s.note, imgPrompt: s.img });
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
        note:        p.noteBase,
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
