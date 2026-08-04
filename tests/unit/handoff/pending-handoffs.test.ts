import { describe, expect, it } from 'vitest';
import type { ActivityFact } from '../../../app/src/activity/activity-view.js';
import type { CatalogEntry } from '../../../app/src/db.js';
import {
  createPendingHandoff,
  pendingHandoffId,
  PENDING_HANDOFF_RETENTION_MS,
  reconcilePendingHandoffEntry,
} from '../../../app/src/handoff/pending-handoffs.js';
import { createLocalPlaybackTargetIndex } from '../../../app/src/playback-identity-resolver.js';

const fact: ActivityFact = {
  deviceId: 'phone',
  deviceLabel: 'Phone',
  playbackKey: 'torrent:abc:3',
  positionSec: 120,
  durationSec: 1000,
  watchState: 'in-progress',
  lastPlayedAt: 50,
  title: 'Example',
  torrentInfoHash: 'ABC',
  torrentFileIndex: 3,
};

function catalog(hasLocalFile: boolean): CatalogEntry {
  return {
    id: 9,
    createdAt: 1,
    updatedAt: 1,
    name: 'Example.mkv',
    path: 'Example.mkv',
    size: 100,
    lastModified: 1,
    availability: 'present',
    hasLocalFile,
    detectedMediaType: 'movie',
    torrentInfoHash: 'ABC',
    torrentFileIndex: 3,
    canonicalPlaybackKey: 'file:Example.mkv|100',
  };
}

describe('pending handoffs', () => {
  it('uses stable torrent identity and bounded retention', () => {
    const entry = createPendingHandoff({
      fact,
      magnetUrl: 'magnet:?xt=urn:btih:abc&so=3',
      now: 100,
    });
    expect(pendingHandoffId(fact)).toBe('torrent:abc:3');
    expect(entry.expiresAt).toBe(100 + PENDING_HANDOFF_RETENTION_MS);
    expect(entry.status).toBe('waiting-for-media');
  });

  it('deduplicates by retaining the original creation time', () => {
    const existing = createPendingHandoff({
      fact,
      magnetUrl: 'magnet:?xt=urn:btih:abc&so=3',
      now: 100,
    });
    const updated = createPendingHandoff({
      fact: { ...fact, positionSec: 500 },
      magnetUrl: existing.magnetUrl,
      existing,
      now: 200,
    });
    expect(updated.createdAt).toBe(100);
    expect(updated.positionSec).toBe(500);
  });

  it('becomes ready only when the matching catalog target has a local file', () => {
    const waiting = createPendingHandoff({
      fact,
      magnetUrl: 'magnet:?xt=urn:btih:abc&so=3',
      now: 100,
    });
    const unavailableIndex = createLocalPlaybackTargetIndex({
      catalogEntries: [catalog(false)],
    });
    const availableIndex = createLocalPlaybackTargetIndex({
      catalogEntries: [catalog(true)],
    });

    expect(reconcilePendingHandoffEntry(waiting, unavailableIndex, 200).status).toBe(
      'waiting-for-media',
    );
    const ready = reconcilePendingHandoffEntry(waiting, availableIndex, 300);
    expect(ready.status).toBe('ready');
    expect(ready.targetCatalogId).toBe(9);
    expect(ready.localPlaybackKey).toBe('file:Example.mkv|100');
  });

  it('expires stale unconsumed handoffs', () => {
    const waiting = createPendingHandoff({
      fact,
      magnetUrl: 'magnet:?xt=urn:btih:abc&so=3',
      now: 100,
    });
    const result = reconcilePendingHandoffEntry(
      waiting,
      createLocalPlaybackTargetIndex({ catalogEntries: [] }),
      waiting.expiresAt,
    );
    expect(result.status).toBe('expired');
  });
});
