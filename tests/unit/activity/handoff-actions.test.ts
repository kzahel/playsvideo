import { describe, expect, it } from 'vitest';
import type { ActivityFact } from '../../../app/src/activity/activity-view.js';
import { resolveHandoffCapabilities } from '../../../app/src/activity/handoff-actions.js';
import type { CatalogEntry } from '../../../app/src/db.js';
import type { LocalPlaybackTarget } from '../../../app/src/playback-identity-resolver.js';

const fact: ActivityFact = {
  deviceId: 'phone',
  deviceLabel: 'Phone',
  playbackKey: 'torrent:abc:4',
  positionSec: 120,
  durationSec: 1000,
  watchState: 'in-progress',
  lastPlayedAt: 10,
  torrentInfoHash: 'abc',
  torrentFileIndex: 4,
  torrentMagnetUrl: 'magnet:?xt=urn:btih:abc&so=1',
};

function target(overrides: Partial<CatalogEntry> = {}): LocalPlaybackTarget {
  const catalogEntry: CatalogEntry = {
    id: 1,
    createdAt: 1,
    updatedAt: 1,
    name: 'Video.mkv',
    path: 'Video.mkv',
    size: 100,
    lastModified: 1,
    availability: 'present',
    hasLocalFile: true,
    detectedMediaType: 'movie',
    canonicalPlaybackKey: 'file:Video.mkv|100',
    ...overrides,
  };
  return {
    catalogEntry,
    catalogId: catalogEntry.id,
    localPlaybackKey: catalogEntry.canonicalPlaybackKey!,
    matchedPlaybackKey: fact.playbackKey,
    matchKind: 'torrent',
    confidence: 'high',
    hasLocalFile: catalogEntry.availability === 'present' && catalogEntry.hasLocalFile !== false,
  };
}

describe('handoff capabilities', () => {
  it('offers resume for a playable local target', () => {
    const result = resolveHandoffCapabilities({ fact, localTarget: target() });
    expect(result.availability).toBe('available-here');
    expect(result.canResume).toBe(true);
  });

  it('offers a normalized magnet when media is unavailable locally', () => {
    const result = resolveHandoffCapabilities({ fact });
    expect(result.availability).toBe('download-required');
    expect(result.magnetUrl).toContain('so=4');
    expect(result.magnetUrl?.match(/(?:\?|&)so=/g)).toHaveLength(1);
  });

  it('distinguishes incomplete local torrent entries', () => {
    const result = resolveHandoffCapabilities({
      fact,
      localTarget: target({ hasLocalFile: false, torrentComplete: false }),
    });
    expect(result.availability).toBe('incomplete-download');
    expect(result.canResume).toBe(false);
  });

  it('does not select an ambiguous local match', () => {
    const result = resolveHandoffCapabilities({ fact, ambiguous: true });
    expect(result).toEqual({
      availability: 'ambiguous-local-match',
      canResume: false,
    });
  });
});
