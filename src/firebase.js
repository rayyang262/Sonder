// ============================================================================
//  SONDER — FIREBASE (auth + firestore)
// ============================================================================
//  Sections:
//     [INIT]       initialize Firebase app + auth + firestore
//     [AUTH]       sign in / sign up / sign out / current user listener
//     [USERS]      user profile docs (display name, onboarded flag, etc.)
//     [MEMORIES]   create / read memories (your own + public)
//     [FEELINGS]   patch feelings + resonance counters on memory docs
//     [COMMENTS]   add / read comments on a memory
//     [FRIENDS]    mutual friend requests + lookup
//     [CHAT]       feeling-room messages (live subscribe)
// ============================================================================

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'firebase/auth';
import {
  getFirestore,
  collection, doc,
  addDoc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit,
  serverTimestamp, increment, arrayUnion, arrayRemove,
  onSnapshot
} from 'firebase/firestore';


// ============================================================================
//  [INIT]  initialize Firebase (config from .env)
// ============================================================================
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);


// ============================================================================
//  [AUTH]  sign in / sign up / sign out / current user listener
// ============================================================================
export const onAuth      = (cb)         => onAuthStateChanged(auth, cb);
export const signUpEmail = (email, pw)  => createUserWithEmailAndPassword(auth, email, pw);
export const signInEmail = (email, pw)  => signInWithEmailAndPassword(auth, email, pw);
export const signInGoogle = ()          => signInWithPopup(auth, new GoogleAuthProvider());
export const logout      = ()           => signOut(auth);


// ============================================================================
//  [USERS]  per-user profile doc — { displayName, email, onboarded, friends[] }
// ============================================================================
//  Schema:
//     users/{uid}
//       email:        string
//       displayName:  string
//       onboarded:    boolean
//       friends:      string[]  (mutual friend uids)
//       createdAt:    serverTimestamp
// ============================================================================

export async function ensureUserDoc() {
  const u = auth.currentUser;
  if (!u) return null;
  const ref = doc(db, 'users', u.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      email: u.email ?? null,
      displayName: u.displayName ?? (u.email?.split('@')[0] ?? 'someone'),
      onboarded: false,
      friends: [],
      createdAt: serverTimestamp()
    });
    return { uid: u.uid, onboarded: false, friends: [], displayName: u.displayName ?? null, email: u.email ?? null };
  }
  return { uid: u.uid, ...snap.data() };
}

export async function getUserDoc(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

export async function markOnboarded() {
  const u = auth.currentUser;
  if (!u) return;
  await setDoc(doc(db, 'users', u.uid), { onboarded: true }, { merge: true });
}

export async function getAllUsers() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}


// ============================================================================
//  [MEMORIES]  create / read memories
// ============================================================================
//  Schema:
//     memories/{id}
//       uid / authorEmail / authorName
//       song:        { spotifyId, name, artists[], albumArt, previewUrl, artistId }
//       note / location / photoUrl / date / isPublic
//       genres:      string[]   (cached from Spotify artist)
//       feelings:    string[]   (top 10 from Replicate, lowercased)
//       resonance:   number     (Reddit-style +1 counter)
//       resonators:  string[]   (uids that have +1'd, prevents double-counting)
//       createdAt:   serverTimestamp
// ============================================================================

export async function createMemory({ song, note, location, photoUrl, date, isPublic, feelings = [] }) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  return addDoc(collection(db, 'memories'), {
    uid: user.uid,
    authorEmail: user.email ?? null,
    authorName: user.displayName ?? null,
    song, note, location, photoUrl, date, isPublic,
    feelings,
    resonance: 0,
    resonators: [],
    createdAt: serverTimestamp()
  });
}

export async function getMyMemories() {
  const user = auth.currentUser;
  if (!user) return [];
  const q = query(collection(db, 'memories'), where('uid', '==', user.uid));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
}

export async function getMemoriesByUid(uid) {
  if (!uid) return [];
  const q = query(collection(db, 'memories'), where('uid', '==', uid));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
}

export async function getMemory(id) {
  const ref = doc(db, 'memories', id);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getPublicMemories() {
  const q = query(collection(db, 'memories'), where('isPublic', '==', true));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
}

// Feed = your own + everyone else's public, ranked by resonance then recency.
export async function getFeedMemories() {
  const user = auth.currentUser;
  if (!user) return [];
  const [mine, pub] = await Promise.all([getMyMemories(), getPublicMemories()]);
  const seen = new Set();
  const merged = [];
  for (const m of [...mine, ...pub]) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    merged.push(m);
  }
  return merged.sort((a, b) => {
    // Reddit-ish: resonance dominates, recent breaks ties.
    const ar = a.resonance ?? 0;
    const br = b.resonance ?? 0;
    if (br !== ar) return br - ar;
    return sortKey(b) - sortKey(a);
  });
}

function sortKey(m) {
  if (m.createdAt?.seconds) return m.createdAt.seconds;
  if (m.date) {
    const t = Date.parse(m.date);
    if (!isNaN(t)) return t / 1000;
  }
  return 0;
}


// ============================================================================
//  [FEELINGS / RESONANCE]  patch feelings, +1 a memory
// ============================================================================
export async function updateMemoryGenres(memoryId, genres) {
  return updateDoc(doc(db, 'memories', memoryId), { genres });
}

export async function updateMemoryFeelings(memoryId, feelings) {
  return updateDoc(doc(db, 'memories', memoryId), { feelings });
}

export async function toggleResonance(memoryId) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const ref = doc(db, 'memories', memoryId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { resonance: 0, resonated: false };
  const data = snap.data();
  const list = Array.isArray(data.resonators) ? data.resonators : [];
  const has = list.includes(user.uid);
  if (has) {
    await updateDoc(ref, { resonance: increment(-1), resonators: arrayRemove(user.uid) });
    return { resonance: (data.resonance || 1) - 1, resonated: false };
  } else {
    await updateDoc(ref, { resonance: increment(1),  resonators: arrayUnion(user.uid) });
    return { resonance: (data.resonance || 0) + 1, resonated: true };
  }
}

// Seed-only.
export async function createSeedMemory({ uid, authorName, authorEmail, song, note, location, date, isPublic = true, feelings = [] }) {
  return addDoc(collection(db, 'memories'), {
    uid, authorName, authorEmail,
    song, note, location,
    photoUrl: null,
    date, isPublic,
    feelings,
    resonance: 0,
    resonators: [],
    createdAt: serverTimestamp()
  });
}


// ============================================================================
//  [COMMENTS]  add / read comments on a memory
// ============================================================================
export async function addComment(memoryId, text) {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  return addDoc(collection(db, 'memories', memoryId, 'comments'), {
    uid: user.uid,
    email: user.email,
    name: user.displayName ?? (user.email?.split('@')[0] ?? 'someone'),
    text,
    createdAt: serverTimestamp()
  });
}

export async function getComments(memoryId) {
  const q = query(
    collection(db, 'memories', memoryId, 'comments'),
    orderBy('createdAt', 'asc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}


// ============================================================================
//  [FRIENDS]  mutual symmetric friend system (request / accept / reject)
// ============================================================================
//  Schema:
//     friendRequests/{id}
//       fromUid / fromName / toUid / status: 'pending' | 'accepted' | 'rejected'
//       createdAt
//     users/{uid}.friends: string[]  (uids of mutual friends)
// ============================================================================

export async function sendFriendRequest(toUid) {
  const u = auth.currentUser;
  if (!u) throw new Error('Not signed in');
  if (toUid === u.uid) throw new Error("Can't friend yourself");
  // Avoid duplicates: check if a pending request already exists either direction.
  const q1 = query(collection(db, 'friendRequests'),
    where('fromUid', '==', u.uid), where('toUid', '==', toUid), where('status', '==', 'pending'));
  const q2 = query(collection(db, 'friendRequests'),
    where('fromUid', '==', toUid), where('toUid', '==', u.uid), where('status', '==', 'pending'));
  const [s1, s2] = await Promise.all([getDocs(q1), getDocs(q2)]);
  if (!s1.empty || !s2.empty) return;
  await addDoc(collection(db, 'friendRequests'), {
    fromUid: u.uid,
    fromName: u.displayName ?? (u.email?.split('@')[0] ?? 'someone'),
    fromEmail: u.email ?? null,
    toUid,
    status: 'pending',
    createdAt: serverTimestamp()
  });
}

export async function getIncomingRequests() {
  const u = auth.currentUser;
  if (!u) return [];
  const q = query(collection(db, 'friendRequests'),
    where('toUid', '==', u.uid), where('status', '==', 'pending'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getOutgoingRequests() {
  const u = auth.currentUser;
  if (!u) return [];
  const q = query(collection(db, 'friendRequests'),
    where('fromUid', '==', u.uid), where('status', '==', 'pending'));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function acceptFriendRequest(requestId) {
  const u = auth.currentUser;
  if (!u) throw new Error('Not signed in');
  const ref = doc(db, 'friendRequests', requestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data();
  if (data.toUid !== u.uid) throw new Error('Not your request');
  await updateDoc(ref, { status: 'accepted' });
  // Add mutually to friend lists.
  await Promise.all([
    setDoc(doc(db, 'users', u.uid),       { friends: arrayUnion(data.fromUid) }, { merge: true }),
    setDoc(doc(db, 'users', data.fromUid),{ friends: arrayUnion(u.uid)        }, { merge: true })
  ]);
}

export async function rejectFriendRequest(requestId) {
  await updateDoc(doc(db, 'friendRequests', requestId), { status: 'rejected' });
}

export async function unfriend(uid) {
  const u = auth.currentUser;
  if (!u) return;
  await Promise.all([
    setDoc(doc(db, 'users', u.uid), { friends: arrayRemove(uid) }, { merge: true }),
    setDoc(doc(db, 'users', uid),   { friends: arrayRemove(u.uid) }, { merge: true })
  ]);
}

export async function getMyFriends() {
  const me = await ensureUserDoc();
  if (!me?.friends?.length) return [];
  const docs = await Promise.all(me.friends.map((uid) => getUserDoc(uid)));
  return docs.filter(Boolean);
}


// ============================================================================
//  [CHAT]  feeling-room live messages
// ============================================================================
//  Schema:
//     rooms/{feeling}/messages/{id}
//       uid / name / text / createdAt
//
//  We use onSnapshot for real-time updates. Caller must invoke the
//  unsubscribe function returned by subscribeRoomMessages on cleanup.
// ============================================================================

export function subscribeRoomMessages(feeling, cb) {
  const q = query(
    collection(db, 'rooms', feeling, 'messages'),
    orderBy('createdAt', 'asc'),
    limit(200)
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function postRoomMessage(feeling, text) {
  const u = auth.currentUser;
  if (!u) throw new Error('Not signed in');
  await addDoc(collection(db, 'rooms', feeling, 'messages'), {
    uid: u.uid,
    name: u.displayName ?? (u.email?.split('@')[0] ?? 'someone'),
    text: String(text).slice(0, 500),
    createdAt: serverTimestamp()
  });
}
