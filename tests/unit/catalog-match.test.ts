import { describe, expect, it } from 'vitest';
import { matchScannedCatalogItems } from '../../app/src/catalog-match.js';

describe('catalog-match', () => {
  it('keeps the same catalog row for an exact rescanned file', () => {
    const result = matchScannedCatalogItems(
      [
        {
          id: 1,
          path: '/shows/show/S01E01.mkv',
          name: 'S01E01.mkv',
          size: 1000,
          lastModified: 123,
        },
      ],
      [
        {
          path: '/shows/show/S01E01.mkv',
          name: 'S01E01.mkv',
          size: 1000,
          lastModified: 123,
        },
      ],
    );

    expect(result.matches[0]).toMatchObject({
      existing: { id: 1 },
      reason: 'path',
    });
    expect(result.missing).toEqual([]);
  });

  it('matches a renamed file by content hash', () => {
    const result = matchScannedCatalogItems(
      [
        {
          id: 1,
          path: '/old/movie.mkv',
          name: 'movie.mkv',
          size: 1000,
          lastModified: 123,
          contentHash: 'hash1',
        },
      ],
      [
        {
          path: '/new/movie-renamed.mkv',
          name: 'movie-renamed.mkv',
          size: 2000,
          lastModified: 999,
          contentHash: 'hash1',
        },
      ],
    );

    expect(result.matches[0]).toMatchObject({
      existing: { id: 1 },
      reason: 'hash',
    });
  });

  it('matches torrent-backed items by torrent identity', () => {
    const result = matchScannedCatalogItems(
      [
        {
          id: 1,
          path: '/virtual/movie.mkv',
          name: 'movie.mkv',
          size: 0,
          lastModified: 0,
          torrentInfoHash: 'abc',
          torrentFileIndex: 0,
        },
      ],
      [
        {
          path: '/different/location/movie.mkv',
          name: 'movie.mkv',
          size: 0,
          lastModified: 0,
          torrentInfoHash: 'abc',
          torrentFileIndex: 0,
        },
      ],
    );

    expect(result.matches[0]).toMatchObject({
      existing: { id: 1 },
      reason: 'torrent',
    });
  });

  it('reports unseen items as missing instead of deleting them', () => {
    const result = matchScannedCatalogItems(
      [
        {
          id: 1,
          path: '/movies/movie-a.mkv',
          name: 'movie-a.mkv',
          size: 1000,
          lastModified: 1,
        },
        {
          id: 2,
          path: '/movies/movie-b.mkv',
          name: 'movie-b.mkv',
          size: 2000,
          lastModified: 2,
        },
      ],
      [
        {
          path: '/movies/movie-a.mkv',
          name: 'movie-a.mkv',
          size: 1000,
          lastModified: 1,
        },
      ],
    );

    expect(result.missing).toEqual([
      {
        id: 2,
        path: '/movies/movie-b.mkv',
        name: 'movie-b.mkv',
        size: 2000,
        lastModified: 2,
      },
    ]);
  });
});
