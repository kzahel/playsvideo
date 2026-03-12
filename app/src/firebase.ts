import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithCredential,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { db, type WatchState } from './db.js';
import { isExtension } from './context.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDz7vblhBTeObWFFDUNM4MwkjiRl4PudxE',
  authDomain: 'playsvideo-b6648.firebaseapp.com',
  projectId: 'playsvideo-b6648',
  storageBucket: 'playsvideo-b6648.firebasestorage.app',
  messagingSenderId: '725762274994',
  appId: '1:725762274994:web:a98e6ccf6fb27cf834fbab',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const firestore = getFirestore(app);

export { auth };

// --- Auth helpers ---

export async function signInGoogle(): Promise<User> {
  if (isExtension() && chrome?.identity?.getAuthToken) {
    const token = await new Promise<string>((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (tok) => {
        if (chrome.runtime.lastError || !tok) {
          reject(new Error(chrome.runtime.lastError?.message ?? 'No token'));
        } else {
          resolve(tok);
        }
      });
    });
    const credential = GoogleAuthProvider.credential(null, token);
    const result = await signInWithCredential(auth, credential);
    return result.user;
  }
  const result = await signInWithPopup(auth, new GoogleAuthProvider());
  return result.user;
}

export async function signUpEmail(email: string, password: string): Promise<User> {
  const result = await createUserWithEmailAndPassword(auth, email, password);
  return result.user;
}

export async function signInEmail(email: string, password: string): Promise<User> {
  const result = await signInWithEmailAndPassword(auth, email, password);
  return result.user;
}

export async function logOut(): Promise<void> {
  await auth.signOut();
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

// --- Sync blob ---

export interface SyncEntry {
  position: number;
  watchState: WatchState;
  durationSec: number;
  watchedAt: number;
}

export interface SyncBlob {
  v: 1;
  entries: Record<string, SyncEntry>;
}

function syncKey(name: string, size: number, durationSec: number): string {
  return `${name}|${size}|${durationSec}`;
}

export async function pullSyncBlob(uid: string): Promise<SyncBlob | null> {
  const snap = await getDoc(doc(firestore, 'sync', uid));
  if (!snap.exists()) return null;
  return snap.data() as SyncBlob;
}

export async function pushSyncBlob(uid: string, blob: SyncBlob): Promise<void> {
  await setDoc(doc(firestore, 'sync', uid), blob);
}

export async function buildLocalBlob(): Promise<SyncBlob> {
  const entries = await db.library.toArray();
  const blob: SyncBlob = { v: 1, entries: {} };
  for (const entry of entries) {
    if (entry.durationSec <= 0) continue;
    const key = syncKey(entry.name, entry.size, entry.durationSec);
    blob.entries[key] = {
      position: entry.playbackPositionSec,
      watchState: entry.watchState,
      durationSec: entry.durationSec,
      watchedAt: Date.now(),
    };
  }
  return blob;
}

function pickWinner(local: SyncEntry, remote: SyncEntry): SyncEntry {
  if (remote.watchedAt > local.watchedAt) return remote;
  return local;
}

export async function mergeAndSync(uid: string): Promise<void> {
  const [remote, local] = await Promise.all([pullSyncBlob(uid), buildLocalBlob()]);

  const merged: SyncBlob = { v: 1, entries: { ...local.entries } };

  if (remote?.entries) {
    for (const [key, remoteEntry] of Object.entries(remote.entries)) {
      const localEntry = merged.entries[key];
      if (!localEntry) {
        merged.entries[key] = remoteEntry;
      } else {
        merged.entries[key] = pickWinner(localEntry, remoteEntry);
      }
    }
  }

  // Apply remote winners to local IDB
  if (remote?.entries) {
    const allLocal = await db.library.toArray();
    for (const entry of allLocal) {
      if (entry.durationSec <= 0) continue;
      const key = syncKey(entry.name, entry.size, entry.durationSec);
      const winner = merged.entries[key];
      if (winner && remote.entries[key] && remote.entries[key].watchedAt > (local.entries[key]?.watchedAt ?? 0)) {
        await db.library.update(entry.id, {
          playbackPositionSec: winner.position,
          watchState: winner.watchState,
        });
      }
    }
  }

  await pushSyncBlob(uid, merged);
}

export async function scheduleSyncIfLoggedIn(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await mergeAndSync(user.uid);
  } catch (err) {
    console.warn('Sync failed:', err);
  }
}
