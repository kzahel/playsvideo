import { describe, expect, it } from 'vitest';
import type { MovieMetadataEntry, SeriesMetadataEntry } from '../../app/src/db.js';
import {
  buildPlaybackKeyCandidates,
  chooseCanonicalPlaybackKey,
} from '../../app/src/playback-key.js';

describe('playback-key', () => {
  const noSeries = new Map<string, SeriesMetadataEntry>();
  const noMovies = new Map<string, MovieMetadataEntry>();

  it('prefers torrent over all other playback identities', () => {
    const result = buildPlaybackKeyCandidates(
      {
        name: 'video.mkv',
        size: 1_000,
        detectedMediaType: 'movie',
        movieMetadataKey: 'movie',
        contentHash: 'deadbeef',
        torrentInfoHash: 'abc123',
        torrentFileIndex: 0,
      },
      {
        movieMetadataByKey: new Map([
          [
            'movie',
            {
              key: 'movie',
              query: '',
              normalizedQuery: '',
              fetchedAt: 0,
              status: 'resolved',
              tmdbId: 10,
            },
          ],
        ]),
      },
    );

    expect(result.map((candidate) => candidate.key)).toEqual([
      'torrent:abc123:0',
      'hash:deadbeef',
      'tmdb:movie:10',
      'file:video.mkv|1000',
    ]);
  });

  it('builds a TMDB tv key when metadata is available', () => {
    const result = chooseCanonicalPlaybackKey(
      {
        name: 'Episode.mkv',
        size: 2_000,
        detectedMediaType: 'tv',
        seriesMetadataKey: 'bb',
        seasonNumber: 5,
        episodeNumber: 14,
      },
      {
        seriesMetadataByKey: new Map<string, SeriesMetadataEntry>([
          [
            'bb',
            {
              key: 'bb',
              query: '',
              normalizedQuery: '',
              fetchedAt: 0,
              status: 'resolved',
              tmdbId: 1396,
            },
          ],
        ]),
      },
    );

    expect(result).toEqual({
      key: 'tmdb:tv:1396:s05:e14',
      source: 'tmdb',
    });
  });

  it('falls back without TMDB and does not depend on duration', () => {
    const result = chooseCanonicalPlaybackKey(
      {
        name: 'video.mkv',
        size: 999,
        detectedMediaType: 'unknown',
      },
      {
        seriesMetadataByKey: noSeries,
        movieMetadataByKey: noMovies,
      },
    );

    expect(result).toEqual({
      key: 'file:video.mkv|999',
      source: 'file',
    });
  });

  it('uses content hash before TMDB when no torrent data exists', () => {
    const result = chooseCanonicalPlaybackKey(
      {
        name: 'video.mkv',
        size: 999,
        detectedMediaType: 'movie',
        movieMetadataKey: 'movie',
        contentHash: 'cafebabe',
      },
      {
        movieMetadataByKey: new Map<string, SeriesMetadataEntry | MovieMetadataEntry>([
          [
            'movie',
            {
              key: 'movie',
              query: '',
              normalizedQuery: '',
              fetchedAt: 0,
              status: 'resolved',
              tmdbId: 22,
            },
          ],
        ]) as Map<string, MovieMetadataEntry>,
      },
    );

    expect(result).toEqual({
      key: 'hash:cafebabe',
      source: 'hash',
    });
  });
});
