import type { ActivityFact } from '../activity/activity-view.js';
import { db, type PendingHandoffEntry } from '../db.js';
import {
  loadLocalPlaybackTargetIndex,
  resolveLocalPlaybackTarget,
  type LocalPlaybackTargetIndex,
} from '../playback-identity-resolver.js';

export const PENDING_HANDOFF_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const CONSUMED_HANDOFF_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function pendingHandoffId(fact: Pick<
  ActivityFact,
  'playbackKey' | 'torrentInfoHash' | 'torrentFileIndex'
>): string {
  if (fact.torrentInfoHash && fact.torrentFileIndex != null) {
    return `torrent:${fact.torrentInfoHash.toLocaleLowerCase()}:${fact.torrentFileIndex}`;
  }
  return `playback:${fact.playbackKey}`;
}

export function createPendingHandoff(input: {
  fact: ActivityFact;
  magnetUrl: string;
  existing?: PendingHandoffEntry;
  now?: number;
}): PendingHandoffEntry {
  const now = input.now ?? Date.now();
  return {
    id: pendingHandoffId(input.fact),
    createdAt: input.existing?.createdAt ?? now,
    updatedAt: now,
    expiresAt: now + PENDING_HANDOFF_RETENTION_MS,
    sourceDeviceId: input.fact.deviceId,
    sourceDeviceLabel: input.fact.deviceLabel,
    sourcePlaybackKey: input.fact.playbackKey,
    positionSec: input.fact.positionSec,
    durationSec: input.fact.durationSec,
    watchState: input.fact.watchState,
    title: input.fact.title,
    contentHash: input.fact.contentHash,
    torrentInfoHash: input.fact.torrentInfoHash,
    torrentFileIndex: input.fact.torrentFileIndex,
    magnetUrl: input.magnetUrl,
    status: 'waiting-for-media',
  };
}

export function reconcilePendingHandoffEntry(
  entry: PendingHandoffEntry,
  targetIndex: LocalPlaybackTargetIndex,
  now = Date.now(),
): PendingHandoffEntry {
  if (entry.status === 'consumed') return entry;
  if (entry.expiresAt <= now) {
    return { ...entry, status: 'expired', updatedAt: now };
  }

  const resolution = resolveLocalPlaybackTarget(targetIndex, {
    playbackKey: entry.sourcePlaybackKey,
    contentHash: entry.contentHash,
    torrentInfoHash: entry.torrentInfoHash,
    torrentFileIndex: entry.torrentFileIndex,
  });
  if (resolution.status !== 'resolved' || !resolution.target.hasLocalFile) {
    return {
      ...entry,
      status: 'waiting-for-media',
      targetCatalogId: undefined,
      localPlaybackKey: undefined,
      readyAt: undefined,
      updatedAt: now,
    };
  }

  return {
    ...entry,
    status: 'ready',
    targetCatalogId: resolution.target.catalogId,
    localPlaybackKey: resolution.target.localPlaybackKey,
    readyAt: entry.readyAt ?? now,
    updatedAt: now,
  };
}

export async function recordPendingHandoff(
  fact: ActivityFact,
  magnetUrl: string,
): Promise<PendingHandoffEntry> {
  const id = pendingHandoffId(fact);
  const existing = await db.pendingHandoffs.get(id);
  const entry = createPendingHandoff({ fact, magnetUrl, existing });
  await db.pendingHandoffs.put(entry);
  return entry;
}

export async function reconcilePendingHandoffs(
  targetIndex?: LocalPlaybackTargetIndex,
): Promise<PendingHandoffEntry[]> {
  const [entries, index] = await Promise.all([
    db.pendingHandoffs.toArray(),
    targetIndex ? Promise.resolve(targetIndex) : loadLocalPlaybackTargetIndex(),
  ]);
  const now = Date.now();
  const reconciled = entries.map((entry) => reconcilePendingHandoffEntry(entry, index, now));
  if (reconciled.length > 0) {
    await db.pendingHandoffs.bulkPut(reconciled);
  }
  return reconciled;
}

export async function consumePendingHandoff(id: string): Promise<void> {
  const entry = await db.pendingHandoffs.get(id);
  if (!entry || entry.status === 'consumed') return;
  const now = Date.now();
  await db.pendingHandoffs.put({
    ...entry,
    status: 'consumed',
    consumedAt: now,
    updatedAt: now,
    expiresAt: now + CONSUMED_HANDOFF_RETENTION_MS,
  });
}

export async function dismissPendingHandoff(id: string): Promise<void> {
  await db.pendingHandoffs.delete(id);
}

export async function cleanupExpiredPendingHandoffs(now = Date.now()): Promise<void> {
  const expired = await db.pendingHandoffs.where('expiresAt').belowOrEqual(now).primaryKeys();
  if (expired.length > 0) {
    await db.pendingHandoffs.bulkDelete(expired);
  }
}
