import { describe, expect, it } from 'vitest';
import type { CatalogEntry, SeriesMetadataEntry } from '../../app/src/db.js';
import {
  buildCatalogAliasEntries,
  createLocalPlaybackTargetIndex,
  resolveLocalPlaybackTarget,
} from '../../app/src/playback-identity-resolver.js';

function catalog(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 1,
    createdAt: 1,
    updatedAt: 1,
    name: 'Example.S01E03.mkv',
    path: 'Example.S01E03.mkv',
    size: 1000,
    lastModified: 1,
    availability: 'present',
    hasLocalFile: true,
    detectedMediaType: 'tv',
    parsedTitle: 'Example',
    seasonNumber: 1,
    episodeNumber: 3,
    seriesMetadataKey: 'tv:example',
    canonicalPlaybackKey: 'file:Example.S01E03.mkv|1000',
    ...overrides,
  };
}

function series(): SeriesMetadataEntry {
  return {
    key: 'tv:example',
    query: 'Example',
    normalizedQuery: 'example',
    fetchedAt: 1,
    status: 'resolved',
    tmdbId: 123,
  };
}

describe('playback identity resolver', () => {
  it('resolves a torrent identity to a file-keyed local catalog entry', () => {
    const entry = catalog({ torrentInfoHash: 'abc', torrentFileIndex: 4 });
    const index = createLocalPlaybackTargetIndex({ catalogEntries: [entry] });
    const result = resolveLocalPlaybackTarget(index, {
      playbackKey: 'torrent:abc:4',
      torrentInfoHash: 'abc',
      torrentFileIndex: 4,
    });

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.target.catalogId).toBe(1);
    expect(result.target.localPlaybackKey).toBe('file:Example.S01E03.mkv|1000');
    expect(result.target.confidence).toBe('high');
  });

  it('resolves a TMDB episode across different canonical keys', () => {
    const entry = catalog();
    const index = createLocalPlaybackTargetIndex({
      catalogEntries: [entry],
      seriesMetadata: [series()],
    });
    const result = resolveLocalPlaybackTarget(index, {
      playbackKey: 'torrent:remote:8',
      tmdbId: 123,
      tmdbMediaType: 'tv',
      seasonNumber: 1,
      episodeNumber: 3,
    });

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') return;
    expect(result.target.matchKind).toBe('tmdb');
    expect(result.target.confidence).toBe('medium');
  });

  it('reports ambiguous weak matches instead of choosing a file', () => {
    const first = catalog({ id: 1 });
    const second = catalog({ id: 2, path: 'copy/Example.S01E03.mkv' });
    const index = createLocalPlaybackTargetIndex({ catalogEntries: [first, second] });
    const result = resolveLocalPlaybackTarget(index, {
      playbackKey: 'file:Example.S01E03.mkv|1000',
    });

    expect(result).toEqual({
      status: 'ambiguous',
      playbackKey: 'file:Example.S01E03.mkv|1000',
      catalogIds: [1, 2],
    });
  });

  it('builds durable aliases for every known candidate', () => {
    const entry = catalog({
      torrentInfoHash: 'abc',
      torrentFileIndex: 4,
      contentHash: 'hash123',
    });
    const aliases = buildCatalogAliasEntries({
      catalogEntries: [entry],
      seriesMetadata: [series()],
      createdAt: 50,
    });

    expect(aliases.map((alias) => alias.playbackKey)).toEqual([
      'torrent:abc:4',
      'hash:hash123',
      'tmdb:tv:123:s01:e03',
      'file:Example.S01E03.mkv|1000',
    ]);
    expect(aliases.every((alias) => alias.createdAt === 50)).toBe(true);
  });
});
