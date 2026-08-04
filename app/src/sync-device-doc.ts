import type { RemotePlaybackEntry, WatchState } from './db.js';

export interface DeviceSyncEntry {
  position: number;
  watchState: WatchState;
  durationSec: number;
  watchedAt: number;
  title?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  contentHash?: string;
  torrentInfoHash?: string;
  torrentFileIndex?: number;
  torrentMagnetUrl?: string;
  torrentComplete?: boolean;
  tmdbId?: number;
  tmdbMediaType?: 'tv' | 'movie';
}

export interface DeviceSyncDoc {
  v: 2;
  label: string;
  lastSyncedAt: number;
  entries: Record<string, DeviceSyncEntry>;
}

export interface DevicePlaybackFact {
  playbackKey: string;
  positionSec: number;
  durationSec: number;
  watchState: WatchState;
  lastPlayedAt: number;
}

export interface PlaybackSyncMetadata {
  title?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  contentHash?: string;
  torrentInfoHash?: string;
  torrentFileIndex?: number;
  torrentMagnetUrl?: string;
  torrentComplete?: boolean;
  tmdbId?: number;
  tmdbMediaType?: 'tv' | 'movie';
}

export interface RemoteDeviceState {
  deviceId: string;
  doc: DeviceSyncDoc;
}

export interface MergedRemotePlaybackEntry extends DeviceSyncEntry {
  playbackKey: string;
  sourceDeviceId: string;
  sourceDeviceLabel: string;
}

export const MAX_DEVICE_SYNC_ENTRIES = 500;

const OPTIONAL_ENTRY_METADATA_FIELDS = [
  'title',
  'seasonNumber',
  'episodeNumber',
  'contentHash',
  'torrentInfoHash',
  'torrentFileIndex',
  'torrentMagnetUrl',
  'torrentComplete',
  'tmdbId',
  'tmdbMediaType',
] as const satisfies ReadonlyArray<keyof DeviceSyncEntry>;

export function buildDeviceSyncDoc(input: {
  label: string;
  lastSyncedAt: number;
  playback: DevicePlaybackFact[];
  metadataByPlaybackKey?: Map<string, PlaybackSyncMetadata>;
}): DeviceSyncDoc {
  const entries: Record<string, DeviceSyncEntry> = {};
  const metadataByPlaybackKey = input.metadataByPlaybackKey ?? new Map();

  const eligiblePlayback = input.playback
    .filter((row) => row.durationSec > 0)
    .sort((left, right) => right.lastPlayedAt - left.lastPlayedAt)
    .slice(0, MAX_DEVICE_SYNC_ENTRIES);

  for (const row of eligiblePlayback) {
    const metadata = metadataByPlaybackKey.get(row.playbackKey);
    const entry: DeviceSyncEntry = {
      position: row.positionSec,
      watchState: row.watchState,
      durationSec: row.durationSec,
      watchedAt: row.lastPlayedAt,
    };
    if (metadata?.title != null) entry.title = metadata.title;
    if (metadata?.seasonNumber != null) entry.seasonNumber = metadata.seasonNumber;
    if (metadata?.episodeNumber != null) entry.episodeNumber = metadata.episodeNumber;
    if (metadata?.contentHash != null) entry.contentHash = metadata.contentHash;
    if (metadata?.torrentInfoHash != null) entry.torrentInfoHash = metadata.torrentInfoHash;
    if (metadata?.torrentFileIndex != null) entry.torrentFileIndex = metadata.torrentFileIndex;
    if (metadata?.torrentMagnetUrl != null) entry.torrentMagnetUrl = metadata.torrentMagnetUrl;
    if (metadata?.torrentComplete != null) entry.torrentComplete = metadata.torrentComplete;
    if (metadata?.tmdbId != null) entry.tmdbId = metadata.tmdbId;
    if (metadata?.tmdbMediaType != null) entry.tmdbMediaType = metadata.tmdbMediaType;
    entries[row.playbackKey] = entry;
  }

  return {
    v: 2,
    label: input.label,
    lastSyncedAt: input.lastSyncedAt,
    entries,
  };
}

export function flattenRemoteDeviceDocs(
  devices: RemoteDeviceState[],
  options: { excludeDeviceId?: string; updatedAt?: number } = {},
): RemotePlaybackEntry[] {
  const rows: RemotePlaybackEntry[] = [];
  const updatedAt = options.updatedAt ?? Date.now();

  for (const { deviceId, doc } of devices) {
    if (options.excludeDeviceId && deviceId === options.excludeDeviceId) {
      continue;
    }

    for (const [playbackKey, entry] of Object.entries(doc.entries)) {
      rows.push({
        deviceId,
        deviceLabel: doc.label,
        deviceLastSyncedAt: doc.lastSyncedAt,
        playbackKey,
        positionSec: entry.position,
        durationSec: entry.durationSec,
        watchState: entry.watchState,
        lastPlayedAt: entry.watchedAt,
        title: entry.title,
        seasonNumber: entry.seasonNumber,
        episodeNumber: entry.episodeNumber,
        contentHash: entry.contentHash,
        torrentInfoHash: entry.torrentInfoHash,
        torrentFileIndex: entry.torrentFileIndex,
        torrentMagnetUrl: entry.torrentMagnetUrl,
        torrentComplete: entry.torrentComplete,
        tmdbId: entry.tmdbId,
        tmdbMediaType: entry.tmdbMediaType,
        updatedAt,
      });
    }
  }

  return rows;
}

export function mergeRemoteDeviceDocs(
  devices: RemoteDeviceState[],
  options: { excludeDeviceId?: string } = {},
): Map<string, MergedRemotePlaybackEntry> {
  const merged = new Map<string, MergedRemotePlaybackEntry>();

  for (const { deviceId, doc } of devices) {
    if (options.excludeDeviceId && deviceId === options.excludeDeviceId) {
      continue;
    }

    for (const [playbackKey, entry] of Object.entries(doc.entries)) {
      const existing = merged.get(playbackKey);
      const incoming: MergedRemotePlaybackEntry = {
          ...entry,
          playbackKey,
          sourceDeviceId: deviceId,
          sourceDeviceLabel: doc.label,
      };
      if (!existing) {
        merged.set(playbackKey, incoming);
        continue;
      }

      const selected = entry.watchedAt > existing.watchedAt ? incoming : { ...existing };
      const metadataSource = entry.watchedAt > existing.watchedAt ? existing : incoming;
      for (const field of OPTIONAL_ENTRY_METADATA_FIELDS) {
        if (selected[field] == null && metadataSource[field] != null) {
          Object.assign(selected, { [field]: metadataSource[field] });
        }
      }
      merged.set(playbackKey, selected);
    }
  }

  return merged;
}
