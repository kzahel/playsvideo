import { describe, expect, it } from 'vitest';
import { buildSyncKey } from '../../../app/src/firebase.js';
import type { LibraryEntry, SeriesMetadataEntry, MovieMetadataEntry } from '../../../app/src/db.js';

function makeLibraryEntry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    id: 1,
    directoryId: 1,
    name: 'video.mkv',
    path: '/videos/video.mkv',
    size: 1_000_000,
    lastModified: Date.now(),
    watchState: 'unwatched',
    playbackPositionSec: 0,
    durationSec: 3600,
    addedAt: Date.now(),
    detectedMediaType: 'unknown',
    ...overrides,
  };
}

describe('buildSyncKey', () => {
  const noSeries = new Map<string, SeriesMetadataEntry>();
  const noMovies = new Map<string, MovieMetadataEntry>();

  it('prefers torrent key when infohash + fileIndex present', () => {
    const entry = makeLibraryEntry({
      torrentInfoHash: 'abc123def456',
      torrentFileIndex: 3,
      contentHash: 'somehash',
    });
    expect(buildSyncKey(entry, noSeries, noMovies)).toBe('torrent:abc123def456:3');
  });

  it('uses content hash when no torrent data', () => {
    const entry = makeLibraryEntry({ contentHash: 'deadbeef1234567890abcdef1234567890abcdef' });
    expect(buildSyncKey(entry, noSeries, noMovies)).toBe(
      'hash:deadbeef1234567890abcdef1234567890abcdef',
    );
  });

  it('uses TMDB TV key when available and no hash/torrent', () => {
    const entry = makeLibraryEntry({
      detectedMediaType: 'tv',
      seriesMetadataKey: 'breaking-bad',
      seasonNumber: 5,
      episodeNumber: 3,
    });
    const seriesMap = new Map<string, SeriesMetadataEntry>([
      [
        'breaking-bad',
        {
          key: 'breaking-bad',
          query: '',
          normalizedQuery: '',
          fetchedAt: 0,
          status: 'resolved',
          tmdbId: 1396,
        } as SeriesMetadataEntry,
      ],
    ]);
    expect(buildSyncKey(entry, seriesMap, noMovies)).toBe('tmdb:tv:1396:s05:e03');
  });

  it('uses TMDB movie key when available and no hash/torrent', () => {
    const entry = makeLibraryEntry({
      detectedMediaType: 'movie',
      movieMetadataKey: 'inception',
    });
    const movieMap = new Map<string, MovieMetadataEntry>([
      [
        'inception',
        {
          key: 'inception',
          query: '',
          normalizedQuery: '',
          fetchedAt: 0,
          status: 'resolved',
          tmdbId: 27205,
        } as MovieMetadataEntry,
      ],
    ]);
    expect(buildSyncKey(entry, noSeries, movieMap)).toBe('tmdb:movie:27205');
  });

  it('falls back to file-based key', () => {
    const entry = makeLibraryEntry({ name: 'video.mkv', size: 999, durationSec: 120.5 });
    expect(buildSyncKey(entry, noSeries, noMovies)).toBe('file:video.mkv|999|120.5');
  });

  it('torrent key with fileIndex 0 is valid', () => {
    const entry = makeLibraryEntry({ torrentInfoHash: 'hash', torrentFileIndex: 0 });
    expect(buildSyncKey(entry, noSeries, noMovies)).toBe('torrent:hash:0');
  });
});
