import { initializeApp } from 'firebase/app';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDocs,
  getFirestore,
  runTransaction,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
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
import {
  buildObservedClientMetadata,
  clientMetadataSeed,
  isVirtualDeviceGroupId,
  type ClientMetadataDoc,
  type ClientStatus,
  type DeviceClient,
  type DeviceGroupDoc,
  type DeviceRegistryState,
  type RemoteClientMetadataState,
  type RemoteDeviceGroupState,
} from './device-groups.js';
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
export type {
  ClientMetadataDoc,
  ClientStatus,
  DeviceGroupDoc,
  DeviceRegistryState,
  RemoteClientMetadataState,
  RemoteDeviceGroupState,
};

export interface RemoteDeviceSyncState {
  devices: RemoteDeviceState[];
  registry: DeviceRegistryState;
}

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
  const [entries, seriesMeta, movieMeta] = await Promise.all([
    db.catalog.toArray(),
    db.seriesMetadata.toArray(),
    db.movieMetadata.toArray(),
  ]);
  const seriesMetaByKey = new Map(seriesMeta.map((m) => [m.key, m]));
  const movieMetaByKey = new Map(movieMeta.map((m) => [m.key, m]));

  const chosenByKey = new Map<string, CatalogEntry>();
  for (const entry of entries) {
    if (!entry.canonicalPlaybackKey) continue;
    chosenByKey.set(
      entry.canonicalPlaybackKey,
      chooseMetadataEntry(chosenByKey.get(entry.canonicalPlaybackKey), entry),
    );
  }

  return new Map(
    Array.from(chosenByKey.entries()).map(([playbackKey, entry]) => {
      const meta: PlaybackSyncMetadata = {
        title: catalogEntryTitle(entry),
        seasonNumber: entry.seasonNumber,
        episodeNumber: entry.episodeNumber,
        contentHash: entry.contentHash,
        torrentInfoHash: entry.torrentInfoHash,
        torrentFileIndex: entry.torrentFileIndex,
        torrentMagnetUrl: entry.torrentMagnetUrl,
        torrentComplete: entry.torrentComplete,
      };

      if (entry.seriesMetadataKey) {
        const series = seriesMetaByKey.get(entry.seriesMetadataKey);
        if (series?.status === 'resolved' && series.tmdbId != null) {
          meta.tmdbId = series.tmdbId;
          meta.tmdbMediaType = 'tv';
        }
      } else if (entry.movieMetadataKey) {
        const movie = movieMetaByKey.get(entry.movieMetadataKey);
        if (movie?.status === 'resolved' && movie.tmdbId != null) {
          meta.tmdbId = movie.tmdbId;
          meta.tmdbMediaType = 'movie';
        }
      }

      return [playbackKey, meta];
    }),
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

async function pullAllClientMetadata(uid: string): Promise<RemoteClientMetadataState[]> {
  const snap = await getDocs(collection(firestore, 'sync', uid, 'clientMeta'));
  return snap.docs.map((entry) => ({
    deviceId: entry.id,
    doc: entry.data() as ClientMetadataDoc,
  }));
}

async function pullAllDeviceGroups(uid: string): Promise<RemoteDeviceGroupState[]> {
  const snap = await getDocs(collection(firestore, 'sync', uid, 'deviceGroups'));
  return snap.docs.map((entry) => ({
    groupId: entry.id,
    doc: entry.data() as DeviceGroupDoc,
  }));
}

async function pullAllDeviceSyncState(uid: string): Promise<RemoteDeviceSyncState> {
  const [devices, clients, groups] = await Promise.all([
    pullAllDeviceDocs(uid),
    pullAllClientMetadata(uid),
    pullAllDeviceGroups(uid),
  ]);
  return { devices, registry: { clients, groups } };
}

async function registerCurrentClientMetadata(
  uid: string,
  deviceId: string,
  deviceDoc: DeviceSyncDoc,
): Promise<void> {
  const ref = doc(firestore, 'sync', uid, 'clientMeta', deviceId);
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists() ? (snapshot.data() as ClientMetadataDoc) : undefined;
    const metadata = buildObservedClientMetadata({
      deviceId,
      generatedLabel: deviceDoc.label,
      ...(typeof location !== 'undefined' && location.origin ? { origin: location.origin } : {}),
      kind: isExtension() ? 'extension' : 'web',
      channel: import.meta.env?.DEV ? 'development' : 'production',
      observedAt: deviceDoc.lastSyncedAt,
      existing,
    });
    transaction.set(ref, metadata, { merge: true });
  });
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

const remotePullsByUser = new Map<string, Promise<RemoteDeviceSyncState>>();

export function pullAndCacheDeviceSyncState(uid: string): Promise<RemoteDeviceSyncState> {
  const existing = remotePullsByUser.get(uid);
  if (existing) return existing;

  const run = (async () => {
    const [deviceId, state] = await Promise.all([getDeviceId(), pullAllDeviceSyncState(uid)]);
    const remotePlaybackRows = flattenRemoteDeviceDocs(state.devices, {
      excludeDeviceId: deviceId,
      updatedAt: Date.now(),
    });

    await db.transaction('rw', db.remotePlayback, async () => {
      await db.remotePlayback.clear();
      if (remotePlaybackRows.length > 0) {
        await db.remotePlayback.bulkPut(remotePlaybackRows);
      }
    });
    return state;
  })();

  remotePullsByUser.set(uid, run);
  const clearRun = () => {
    if (remotePullsByUser.get(uid) === run) remotePullsByUser.delete(uid);
  };
  void run.then(clearRun, clearRun);
  return run;
}

export async function pullAndCacheDeviceDocs(uid: string): Promise<RemoteDeviceState[]> {
  return (await pullAndCacheDeviceSyncState(uid)).devices;
}

export async function mergeAndSync(uid: string): Promise<void> {
  const [deviceId] = await Promise.all([getDeviceId(), pullAndCacheDeviceSyncState(uid)]);
  const deviceDoc = await buildDeviceDoc();
  await pushDeviceDoc(uid, deviceId, deviceDoc);
  try {
    await registerCurrentClientMetadata(uid, deviceId, deviceDoc);
  } catch (err) {
    console.warn('Client metadata registration failed:', err);
  }
}

export async function saveLogicalDeviceGroup(input: {
  uid: string;
  groupId?: string;
  name: string;
  clients: DeviceClient[];
  deleteGroupIds?: string[];
}): Promise<string> {
  const trimmedName = input.name.trim();
  if (!trimmedName) throw new Error('Device name is required');
  if (input.clients.length === 0) throw new Error('A device group requires at least one client');

  const groupId =
    input.groupId && !isVirtualDeviceGroupId(input.groupId)
      ? input.groupId
      : crypto.randomUUID();
  const now = Date.now();
  const updatesExistingGroup = input.groupId === groupId;
  const batch = writeBatch(firestore);
  batch.set(
    doc(firestore, 'sync', input.uid, 'deviceGroups', groupId),
    updatesExistingGroup
      ? { v: 1, name: trimmedName, updatedAt: now }
      : ({ v: 1, name: trimmedName, createdAt: now, updatedAt: now } satisfies DeviceGroupDoc),
    { merge: true },
  );
  for (const client of input.clients) {
    batch.set(
      doc(firestore, 'sync', input.uid, 'clientMeta', client.deviceId),
      { ...clientMetadataSeed(client), groupId },
      { merge: true },
    );
  }
  for (const sourceGroupId of input.deleteGroupIds ?? []) {
    if (sourceGroupId !== groupId && !isVirtualDeviceGroupId(sourceGroupId)) {
      batch.delete(doc(firestore, 'sync', input.uid, 'deviceGroups', sourceGroupId));
    }
  }
  await batch.commit();
  return groupId;
}

export async function setDeviceClientStatus(input: {
  uid: string;
  client: DeviceClient;
  status: Exclude<ClientStatus, 'forgotten'>;
}): Promise<void> {
  await setDoc(
    doc(firestore, 'sync', input.uid, 'clientMeta', input.client.deviceId),
    { ...clientMetadataSeed(input.client), status: input.status },
    { merge: true },
  );
}

export async function forgetDeviceClient(input: {
  uid: string;
  client: DeviceClient;
}): Promise<void> {
  if (input.client.deviceId === (await getDeviceId())) {
    throw new Error('The current client cannot be forgotten');
  }
  const batch = writeBatch(firestore);
  batch.delete(doc(firestore, 'sync', input.uid, 'devices', input.client.deviceId));
  batch.set(
    doc(firestore, 'sync', input.uid, 'clientMeta', input.client.deviceId),
    { ...clientMetadataSeed(input.client), status: 'forgotten' },
    { merge: true },
  );
  await batch.commit();
}

let syncRequested = false;
let requestedSyncUid: string | null = null;
let activeSync: Promise<void> | null = null;

export function requestMergeAndSync(uid: string): Promise<void> {
  requestedSyncUid = uid;
  syncRequested = true;
  if (!activeSync) {
    activeSync = Promise.resolve()
      .then(async () => {
        while (syncRequested && requestedSyncUid) {
          syncRequested = false;
          await mergeAndSync(requestedSyncUid);
        }
      })
      .finally(() => {
        activeSync = null;
      });
  }
  return activeSync;
}

export async function scheduleSyncIfLoggedIn(): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  try {
    await requestMergeAndSync(user.uid);
  } catch (err) {
    console.warn('Sync failed:', err);
  }
}

export { pullAllDeviceDocs };
