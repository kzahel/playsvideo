import { describe, expect, it } from 'vitest';
import type { ActivityFact } from '../../../app/src/activity/activity-view.js';
import {
  resolveHandoffCapabilities,
  resolveHandoffResumePoint,
} from '../../../app/src/activity/handoff-actions.js';
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

  it('explains when unavailable media has no recovery locator', () => {
    const result = resolveHandoffCapabilities({
      fact: {
        ...fact,
        torrentInfoHash: undefined,
        torrentFileIndex: undefined,
        torrentMagnetUrl: undefined,
      },
    });

    expect(result).toEqual({ availability: 'no-source', canResume: false });
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

  it('requires confirmation before resuming a low-confidence local match', () => {
    const localTarget = { ...target(), confidence: 'low' as const };

    expect(resolveHandoffCapabilities({ fact, localTarget })).toEqual(
      expect.objectContaining({ canResume: false, requiresConfirmation: true }),
    );
    expect(resolveHandoffCapabilities({ fact, localTarget, lowConfidenceConfirmed: true })).toEqual(
      expect.objectContaining({ canResume: true, requiresConfirmation: false }),
    );
  });

  it('scales a medium-confidence resume position when local duration differs materially', () => {
    const resume = resolveHandoffResumePoint(fact, {
      ...target(),
      confidence: 'medium',
      localDurationSec: 2000,
    });

    expect(resume).toEqual({ positionSec: 240, durationSec: 2000, translated: true });
  });

  it('keeps a high-confidence resume position when local duration differs', () => {
    const resume = resolveHandoffResumePoint(fact, {
      ...target(),
      localDurationSec: 2000,
    });

    expect(resume).toEqual({ positionSec: 120, durationSec: 2000, translated: false });
  });
});
