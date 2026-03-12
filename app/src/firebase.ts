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
import { db, type LibraryEntry, type MovieMetadataEntry, type SeriesMetadataEntry, type WatchState } from './db.js';
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

function buildFallbackSyncKey(entry: Pick<LibraryEntry, 'name' | 'size' | 'durationSec'>): string {
  return `file:${syncKey(entry.name, entry.size, entry.durationSec)}`;
}

function buildPreferredSyncKey(
  entry: LibraryEntry,
  seriesMetadataByKey: Map<string, SeriesMetadataEntry>,
  movieMetadataByKey: Map<string, MovieMetadataEntry>,
): string {
  if (
    entry.detectedMediaType === 'tv' &&
    entry.seriesMetadataKey &&
    entry.seasonNumber != null &&
    entry.episodeNumber != null
  ) {
    const seriesMetadata = seriesMetadataByKey.get(entry.seriesMetadataKey);
    if (seriesMetadata?.status === 'resolved' && seriesMetadata.tmdbId != null) {
      const episodeKey =
        entry.endingEpisodeNumber != null
          ? `${String(entry.episodeNumber).padStart(2, '0')}-${String(entry.endingEpisodeNumber).padStart(2, '0')}`
          : String(entry.episodeNumber).padStart(2, '0');
      return `tmdb:tv:${seriesMetadata.tmdbId}:s${String(entry.seasonNumber).padStart(2, '0')}:e${episodeKey}`;
    }
  }

  if (entry.detectedMediaType === 'movie' && entry.movieMetadataKey) {
    const movieMetadata = movieMetadataByKey.get(entry.movieMetadataKey);
    if (movieMetadata?.status === 'resolved' && movieMetadata.tmdbId != null) {
      return `tmdb:movie:${movieMetadata.tmdbId}`;
    }
  }

  return buildFallbackSyncKey(entry);
}

function buildSyncIdentityContext(
  entries: LibraryEntry[],
  seriesMetadata: SeriesMetadataEntry[],
  movieMetadata: MovieMetadataEntry[],
): {
  preferredKeyByEntryId: Map<number, string>;
  fallbackKeyByEntryId: Map<number, string>;
  legacyToPreferredKey: Map<string, string>;
} {
  const seriesMetadataByKey = new Map(seriesMetadata.map((entry) => [entry.key, entry]));
  const movieMetadataByKey = new Map(movieMetadata.map((entry) => [entry.key, entry]));
  const preferredKeyByEntryId = new Map<number, string>();
  const fallbackKeyByEntryId = new Map<number, string>();
  const legacyToPreferredKey = new Map<string, string>();

  for (const entry of entries) {
    const preferredKey = buildPreferredSyncKey(entry, seriesMetadataByKey, movieMetadataByKey);
    const fallbackKey = buildFallbackSyncKey(entry);
    preferredKeyByEntryId.set(entry.id, preferredKey);
    fallbackKeyByEntryId.set(entry.id, fallbackKey);
    if (preferredKey !== fallbackKey) {
      legacyToPreferredKey.set(fallbackKey, preferredKey);
    }
  }

  return {
    preferredKeyByEntryId,
    fallbackKeyByEntryId,
    legacyToPreferredKey,
  };
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
  const [entries, seriesMetadata, movieMetadata] = await Promise.all([
    db.library.toArray(),
    db.seriesMetadata.toArray(),
    db.movieMetadata.toArray(),
  ]);
  const { preferredKeyByEntryId } = buildSyncIdentityContext(entries, seriesMetadata, movieMetadata);
  const blob: SyncBlob = { v: 1, entries: {} };
  for (const entry of entries) {
    if (entry.durationSec <= 0) continue;
    const key = preferredKeyByEntryId.get(entry.id) ?? buildFallbackSyncKey(entry);
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
  const [remote, entries, seriesMetadata, movieMetadata] = await Promise.all([
    pullSyncBlob(uid),
    db.library.toArray(),
    db.seriesMetadata.toArray(),
    db.movieMetadata.toArray(),
  ]);
  const {
    preferredKeyByEntryId,
    fallbackKeyByEntryId,
    legacyToPreferredKey,
  } = buildSyncIdentityContext(entries, seriesMetadata, movieMetadata);

  const local: SyncBlob = { v: 1, entries: {} };
  for (const entry of entries) {
    if (entry.durationSec <= 0) continue;
    const key = preferredKeyByEntryId.get(entry.id) ?? buildFallbackSyncKey(entry);
    local.entries[key] = {
      position: entry.playbackPositionSec,
      watchState: entry.watchState,
      durationSec: entry.durationSec,
      watchedAt: Date.now(),
    };
  }

  const merged: SyncBlob = { v: 1, entries: { ...local.entries } };

  if (remote?.entries) {
    for (const [key, remoteEntry] of Object.entries(remote.entries)) {
      const canonicalKey = legacyToPreferredKey.get(key) ?? key;
      const localEntry = merged.entries[canonicalKey];
      if (!localEntry) {
        merged.entries[canonicalKey] = remoteEntry;
      } else {
        merged.entries[canonicalKey] = pickWinner(localEntry, remoteEntry);
      }
    }
  }

  // Apply remote winners to local IDB
  if (remote?.entries) {
    for (const entry of entries) {
      if (entry.durationSec <= 0) continue;
      const preferredKey = preferredKeyByEntryId.get(entry.id) ?? buildFallbackSyncKey(entry);
      const fallbackKey = fallbackKeyByEntryId.get(entry.id) ?? buildFallbackSyncKey(entry);
      const remoteEntry = remote.entries[preferredKey] ?? remote.entries[fallbackKey];
      const winner = merged.entries[preferredKey];
      const localWatchedAt =
        local.entries[preferredKey]?.watchedAt ?? local.entries[fallbackKey]?.watchedAt ?? 0;
      if (winner && remoteEntry && remoteEntry.watchedAt > localWatchedAt) {
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
