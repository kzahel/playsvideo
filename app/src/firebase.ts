import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDocs, collection } from 'firebase/firestore';
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
import {
  db,
  type CatalogEntry,
  type MovieMetadataEntry,
  type PlaybackEntry,
  type RemotePlaybackEntry,
  type SeriesMetadataEntry,
  type WatchState,
} from './db.js';
import { isExtension } from './context.js';
import { getDeviceId, getDeviceLabel } from './device.js';
import { buildPlaybackKeyCandidates } from './playback-key.js';
import {
  buildDeviceSyncDoc,
  flattenRemoteDeviceDocs,
  mergeRemoteDeviceDocs,
  type DeviceSyncDoc,
  type DeviceSyncEntry,
  type PlaybackSyncMetadata,
  type RemoteDeviceState,
} from './sync-device-doc.js';

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

export type SyncEntry = DeviceSyncEntry;
export type { DeviceSyncDoc, RemoteDeviceState };

// --- Sync key builders ---

export function buildSyncKey(
  entry: CatalogEntry,
  seriesMetadataByKey: Map<string, SeriesMetadataEntry>,
  movieMetadataByKey: Map<string, MovieMetadataEntry>,
): string {
  const [candidate] = buildPlaybackKeyCandidates(
    {
      name: entry.name,
      size: entry.size,
      detectedMediaType: entry.detectedMediaType,
      seriesMetadataKey: entry.seriesMetadataKey,
      movieMetadataKey: entry.movieMetadataKey,
      seasonNumber: entry.seasonNumber,
      episodeNumber: entry.episodeNumber,
      endingEpisodeNumber: entry.endingEpisodeNumber,
      contentHash: entry.contentHash,
      torrentInfoHash: entry.torrentInfoHash,
      torrentFileIndex: entry.torrentFileIndex,
    },
    {
      seriesMetadataByKey,
      movieMetadataByKey,
    },
  );
  return candidate.key;
}

function catalogEntryTitle(entry: CatalogEntry): string {
  return entry.parsedTitle ?? entry.name;
}

function chooseMetadataEntry(
  current: CatalogEntry | undefined,
  next: CatalogEntry,
): CatalogEntry {
  if (!current) return next;
  if (current.availability !== 'present' && next.availability === 'present') return next;
  if ((next.updatedAt ?? 0) > (current.updatedAt ?? 0)) return next;
  return current;
}

async function buildCatalogPlaybackMetadata(): Promise<Map<string, PlaybackSyncMetadata>> {
  const entries = await db.catalog.toArray();
  const chosenByKey = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    if (!entry.canonicalPlaybackKey) continue;
    chosenByKey.set(
      entry.canonicalPlaybackKey,
      chooseMetadataEntry(chosenByKey.get(entry.canonicalPlaybackKey), entry),
    );
  }

  return new Map(
    Array.from(chosenByKey.entries()).map(([playbackKey, entry]) => [
      playbackKey,
      {
        title: catalogEntryTitle(entry),
        seasonNumber: entry.seasonNumber,
        episodeNumber: entry.episodeNumber,
        contentHash: entry.contentHash,
        torrentInfoHash: entry.torrentInfoHash,
        torrentFileIndex: entry.torrentFileIndex,
        torrentMagnetUrl: entry.torrentMagnetUrl,
        torrentComplete: entry.torrentComplete,
      },
    ]),
  );
}

export async function buildLocalSyncKeyIndex(): Promise<Map<string, number>> {
  const entries = await db.catalog.toArray();
  const syncKeyToEntryId = new Map<string, number>();
  for (const entry of entries) {
    if (entry.canonicalPlaybackKey) {
      syncKeyToEntryId.set(entry.canonicalPlaybackKey, entry.id);
    }
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

export function mergeDeviceDocs(
  devices: RemoteDeviceState[],
): ReturnType<typeof mergeRemoteDeviceDocs> {
  return mergeRemoteDeviceDocs(devices);
}

// --- Main sync operations ---

export async function buildDeviceDoc(): Promise<DeviceSyncDoc> {
  const [playback, metadataByPlaybackKey, label] = await Promise.all([
    db.playback.toArray(),
    buildCatalogPlaybackMetadata(),
    getDeviceLabel(),
  ]);
  return buildDeviceSyncDoc({
    label,
    lastSyncedAt: Date.now(),
    playback,
    metadataByPlaybackKey,
  });
}

export async function mergeAndSync(uid: string): Promise<void> {
  const [deviceId, allDeviceDocs] = await Promise.all([
    getDeviceId(),
    pullAllDeviceDocs(uid),
  ]);
  const remotePlaybackRows = flattenRemoteDeviceDocs(allDeviceDocs, {
    excludeDeviceId: deviceId,
    updatedAt: Date.now(),
  });

  await db.transaction('rw', db.remotePlayback, async () => {
    await db.remotePlayback.clear();
    if (remotePlaybackRows.length > 0) {
      await db.remotePlayback.bulkPut(remotePlaybackRows);
    }
  });

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
