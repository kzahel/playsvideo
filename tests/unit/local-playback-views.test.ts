import { describe, expect, it } from 'vitest';
import type { CatalogEntry, PlaybackEntry } from '../../app/src/db.js';
import {
  applyLocalPlaybackToCatalogEntries,
  getNowPlayingView,
} from '../../app/src/local-playback-views.js';

function makeCatalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 1,
    createdAt: 1,
    updatedAt: 1,
    name: 'video.mkv',
    path: 'video.mkv',
    directoryId: 1,
    size: 1000,
    lastModified: 123,
    availability: 'present',
    detectedMediaType: 'unknown',
    canonicalPlaybackKey: 'file:video.mkv|1000',
    ...overrides,
  };
}

function makePlaybackEntry(overrides: Partial<PlaybackEntry> = {}): PlaybackEntry {
  return {
    deviceId: 'device-1',
    playbackKey: 'file:video.mkv|1000',
    positionSec: 120,
    durationSec: 3600,
    watchState: 'in-progress',
    lastPlayedAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe('local-playback-views', () => {
  it('applies local playback state to catalog entries', () => {
    const result = applyLocalPlaybackToCatalogEntries({
      catalogEntries: [makeCatalogEntry()],
      playbackEntries: [makePlaybackEntry()],
    });

    expect(result[0]).toMatchObject({
      id: 1,
      watchState: 'in-progress',
      playbackPositionSec: 120,
      durationSec: 3600,
      playbackKey: 'file:video.mkv|1000',
    });
  });

  it('defaults to unwatched when no playback row exists', () => {
    const result = applyLocalPlaybackToCatalogEntries({
      catalogEntries: [makeCatalogEntry()],
      playbackEntries: [],
    });

    expect(result[0]).toMatchObject({
      watchState: 'unwatched',
      playbackPositionSec: 0,
    });
  });

  it('finds now playing from playback and catalog even when no live library row exists', () => {
    const result = getNowPlayingView({
      catalogEntries: [makeCatalogEntry({ parsedTitle: 'My Video' })],
      playbackEntries: [makePlaybackEntry()],
    });

    expect(result).toEqual({
      id: 1,
      name: 'My Video',
      watchState: 'in-progress',
      durationSec: 3600,
      playbackPositionSec: 120,
    });
  });
});
