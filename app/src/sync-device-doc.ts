import type { RemotePlaybackEntry, WatchState } from './db.js';

export interface DeviceSyncEntry {
  position: number;
  watchState: WatchState;
  durationSec: number;
  watchedAt: number;
  title?: string;
  contentHash?: string;
  torrentInfoHash?: string;
  torrentFileIndex?: number;
  torrentMagnetUrl?: string;
  torrentComplete?: boolean;
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
  contentHash?: string;
  torrentInfoHash?: string;
  torrentFileIndex?: number;
  torrentMagnetUrl?: string;
  torrentComplete?: boolean;
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

export function buildDeviceSyncDoc(input: {
  label: string;
  lastSyncedAt: number;
  playback: DevicePlaybackFact[];
  metadataByPlaybackKey?: Map<string, PlaybackSyncMetadata>;
}): DeviceSyncDoc {
  const entries: Record<string, DeviceSyncEntry> = {};
  const metadataByPlaybackKey = input.metadataByPlaybackKey ?? new Map();

  for (const row of input.playback) {
    if (row.durationSec <= 0) continue;

    const metadata = metadataByPlaybackKey.get(row.playbackKey);
    const entry: DeviceSyncEntry = {
      position: row.positionSec,
      watchState: row.watchState,
      durationSec: row.durationSec,
      watchedAt: row.lastPlayedAt,
    };
    if (metadata?.title != null) entry.title = metadata.title;
    if (metadata?.contentHash != null) entry.contentHash = metadata.contentHash;
    if (metadata?.torrentInfoHash != null) entry.torrentInfoHash = metadata.torrentInfoHash;
    if (metadata?.torrentFileIndex != null) entry.torrentFileIndex = metadata.torrentFileIndex;
    if (metadata?.torrentMagnetUrl != null) entry.torrentMagnetUrl = metadata.torrentMagnetUrl;
    if (metadata?.torrentComplete != null) entry.torrentComplete = metadata.torrentComplete;
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
        playbackKey,
        positionSec: entry.position,
        durationSec: entry.durationSec,
        watchState: entry.watchState,
        lastPlayedAt: entry.watchedAt,
        title: entry.title,
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
      if (!existing || entry.watchedAt > existing.watchedAt) {
        merged.set(playbackKey, {
          ...entry,
          playbackKey,
          sourceDeviceId: deviceId,
          sourceDeviceLabel: doc.label,
        });
      }
    }
  }

  return merged;
}
