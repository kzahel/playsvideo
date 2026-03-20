import { describe, expect, it } from 'vitest';
import { buildSyncKey } from '../../../app/src/firebase.js';
import type { CatalogEntry, SeriesMetadataEntry, MovieMetadataEntry } from '../../../app/src/db.js';

function makeCatalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 1,
    createdAt: 1,
    updatedAt: 1,
    name: 'video.mkv',
    path: '/videos/video.mkv',
    directoryId: 1,
    size: 1_000_000,
    lastModified: Date.now(),
    availability: 'present',
    detectedMediaType: 'unknown',
    ...overrides,
  };
}

describe('buildSyncKey', () => {
  const noSeries = new Map<string, SeriesMetadataEntry>();
  const noMovies = new Map<string, MovieMetadataEntry>();

  it('prefers torrent key when infohash + fileIndex present', () => {
    const entry = makeCatalogEntry({
      torrentInfoHash: 'abc123def456',
      torrentFileIndex: 3,
      contentHash: 'somehash',
    });
    expect(buildSyncKey(entry, noSeries, noMovies)).toBe('torrent:abc123def456:3');
  });

  it('uses content hash when no torrent data', () => {
    const entry = makeCatalogEntry({ contentHash: 'deadbeef1234567890abcdef1234567890abcdef' });
    expect(buildSyncKey(entry, noSeries, noMovies)).toBe(
      'hash:deadbeef1234567890abcdef1234567890abcdef',
    );
  });

  it('uses TMDB TV key when available and no hash/torrent', () => {
    const entry = makeCatalogEntry({
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
    const entry = makeCatalogEntry({
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

  it('falls back to a stable file-based key without duration', () => {
    const entry = makeCatalogEntry({ name: 'video.mkv', size: 999 });
    expect(buildSyncKey(entry, noSeries, noMovies)).toBe('file:video.mkv|999');
  });

  it('torrent key with fileIndex 0 is valid', () => {
    const entry = makeCatalogEntry({ torrentInfoHash: 'hash', torrentFileIndex: 0 });
    expect(buildSyncKey(entry, noSeries, noMovies)).toBe('torrent:hash:0');
  });
});
