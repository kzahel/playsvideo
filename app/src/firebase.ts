import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, getDocs, collection } from 'firebase/firestore';
import {
  getAuth,
  connectAuthEmulator,
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
import { getDeviceId, getDeviceLabel } from './device.js';

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

if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
  const firestoreHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST;
  const authHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST;
  if (firestoreHost) {
    const [host, port] = firestoreHost.split(':');
    connectFirestoreEmulator(firestore, host, Number(port));
  }
  if (authHost) {
    connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  }
}

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

// --- Sync (per-device) ---

export interface SyncEntry {
  position: number;
  watchState: WatchState;
  durationSec: number;
  watchedAt: number;
  title?: string;
  contentHash?: string;
  torrentInfoHash?: string;
  torrentFileIndex?: number;
  torrentMagnetUrl?: string;
}

export interface DeviceSyncDoc {
  v: 2;
  label: string;
  lastSyncedAt: number;
  entries: Record<string, SyncEntry>;
}

export interface RemoteDeviceState {
  deviceId: string;
  doc: DeviceSyncDoc;
}

// --- Sync key builders ---

export function buildSyncKey(
  entry: LibraryEntry,
  seriesMetadataByKey: Map<string, SeriesMetadataEntry>,
  movieMetadataByKey: Map<string, MovieMetadataEntry>,
): string {
  // Priority 1: torrent identity (works even for incomplete files)
  if (entry.torrentInfoHash != null && entry.torrentFileIndex != null) {
    return `torrent:${entry.torrentInfoHash}:${entry.torrentFileIndex}`;
  }

  // Priority 2: content hash (stable across renames)
  if (entry.contentHash) {
    return `hash:${entry.contentHash}`;
  }

  // Priority 3: TMDB identity (cross-device without file access)
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

  // Priority 4: file-based fallback
  return `file:${entry.name}|${entry.size}|${entry.durationSec}`;
}

function buildSyncKeyMap(
  entries: LibraryEntry[],
  seriesMetadata: SeriesMetadataEntry[],
  movieMetadata: MovieMetadataEntry[],
): Map<number, string> {
  const seriesMetadataByKey = new Map(seriesMetadata.map((e) => [e.key, e]));
  const movieMetadataByKey = new Map(movieMetadata.map((e) => [e.key, e]));
  const keyByEntryId = new Map<number, string>();
  for (const entry of entries) {
    keyByEntryId.set(entry.id, buildSyncKey(entry, seriesMetadataByKey, movieMetadataByKey));
  }
  return keyByEntryId;
}

function entryTitle(entry: LibraryEntry): string {
  return entry.parsedTitle ?? entry.name;
}

export async function buildLocalSyncKeyIndex(): Promise<Map<string, number>> {
  const [entries, seriesMetadata, movieMetadata] = await Promise.all([
    db.library.toArray(),
    db.seriesMetadata.toArray(),
    db.movieMetadata.toArray(),
  ]);
  const keyMap = buildSyncKeyMap(entries, seriesMetadata, movieMetadata);
  const syncKeyToEntryId = new Map<string, number>();
  for (const [entryId, syncKey] of keyMap) {
    syncKeyToEntryId.set(syncKey, entryId);
  }
  return syncKeyToEntryId;
}

// --- Firestore I/O ---

async function pushDeviceDoc(uid: string, deviceId: string, deviceDoc: DeviceSyncDoc): Promise<void> {
  await setDoc(doc(firestore, 'sync', uid, 'devices', deviceId), deviceDoc);
}

async function pullAllDeviceDocs(uid: string): Promise<RemoteDeviceState[]> {
  const snap = await getDocs(collection(firestore, 'sync', uid, 'devices'));
  const results: RemoteDeviceState[] = [];
  for (const d of snap.docs) {
    results.push({ deviceId: d.id, doc: d.data() as DeviceSyncDoc });
  }
  return results;
}

// --- Merge logic (pure) ---

export interface MergedEntry extends SyncEntry {
  sourceDeviceId: string;
  sourceDeviceLabel: string;
}

export function mergeDeviceDocs(
  devices: RemoteDeviceState[],
): Map<string, MergedEntry> {
  const merged = new Map<string, MergedEntry>();
  for (const { deviceId, doc: deviceDoc } of devices) {
    for (const [key, entry] of Object.entries(deviceDoc.entries)) {
      const existing = merged.get(key);
      if (!existing || entry.watchedAt > existing.watchedAt) {
        merged.set(key, { ...entry, sourceDeviceId: deviceId, sourceDeviceLabel: deviceDoc.label });
      }
    }
  }
  return merged;
}

// --- Main sync operations ---

export async function buildDeviceDoc(): Promise<DeviceSyncDoc> {
  const [entries, seriesMetadata, movieMetadata, label] = await Promise.all([
    db.library.toArray(),
    db.seriesMetadata.toArray(),
    db.movieMetadata.toArray(),
    getDeviceLabel(),
  ]);
  const keyMap = buildSyncKeyMap(entries, seriesMetadata, movieMetadata);
  const syncEntries: Record<string, SyncEntry> = {};
  for (const entry of entries) {
    if (entry.durationSec <= 0) continue;
    const key = keyMap.get(entry.id);
    if (!key) continue;
    const syncEntry: SyncEntry = {
      position: entry.playbackPositionSec,
      watchState: entry.watchState,
      durationSec: entry.durationSec,
      watchedAt: entry.lastPlayedAt ?? Date.now(),
      title: entryTitle(entry),
    };
    if (entry.contentHash) syncEntry.contentHash = entry.contentHash;
    if (entry.torrentInfoHash) syncEntry.torrentInfoHash = entry.torrentInfoHash;
    if (entry.torrentFileIndex != null) syncEntry.torrentFileIndex = entry.torrentFileIndex;
    if (entry.torrentMagnetUrl) syncEntry.torrentMagnetUrl = entry.torrentMagnetUrl;
    syncEntries[key] = syncEntry;
  }
  return {
    v: 2,
    label,
    lastSyncedAt: Date.now(),
    entries: syncEntries,
  };
}

export async function mergeAndSync(uid: string): Promise<void> {
  const [deviceId, entries, seriesMetadata, movieMetadata, allDeviceDocs] = await Promise.all([
    getDeviceId(),
    db.library.toArray(),
    db.seriesMetadata.toArray(),
    db.movieMetadata.toArray(),
    pullAllDeviceDocs(uid),
  ]);

  const keyMap = buildSyncKeyMap(entries, seriesMetadata, movieMetadata);

  // Build reverse lookup: syncKey -> entryId
  const entryIdByKey = new Map<number, string>();
  const entryByKey = new Map<string, LibraryEntry>();
  for (const entry of entries) {
    const key = keyMap.get(entry.id);
    if (key) {
      entryIdByKey.set(entry.id, key);
      entryByKey.set(key, entry);
    }
  }

  // Merge all remote devices (excluding self) to find best remote state per key
  const otherDevices = allDeviceDocs.filter((d) => d.deviceId !== deviceId);
  const remoteMerged = mergeDeviceDocs(otherDevices);

  // Apply remote winners to local IDB where remote is newer
  for (const [key, remoteEntry] of remoteMerged) {
    const localEntry = entryByKey.get(key);
    if (!localEntry) continue;
    const localWatchedAt = localEntry.lastPlayedAt ?? 0;
    if (remoteEntry.watchedAt > localWatchedAt) {
      await db.library.update(localEntry.id, {
        playbackPositionSec: remoteEntry.position,
        watchState: remoteEntry.watchState,
      });
    }
  }

  // Push this device's doc
  const deviceDoc = await buildDeviceDoc();
  await pushDeviceDoc(uid, deviceId, deviceDoc);
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

export { pullAllDeviceDocs };
