import { describe, expect, it } from 'vitest';
import { parseMediaMetadata } from '../../app/src/media-metadata.js';

describe('parseMediaMetadata', () => {
  it('parses named SxxEyy episodes', () => {
    expect(parseMediaMetadata('Sample Show s01e07.mkv')).toMatchObject({
      detectedMediaType: 'tv',
      parsedTitle: 'Sample Show',
      seasonNumber: 1,
      episodeNumber: 7,
      seriesMetadataKey: 'tv:sample show:',
    });
  });

  it('ignores release tags after the episode code', () => {
    expect(parseMediaMetadata('Sample.Show.S01E07.1080p.WEB-DL.x265.mkv')).toEqual({
      detectedMediaType: 'tv',
      parsedTitle: 'Sample Show',
      parsedYear: undefined,
      seasonNumber: 1,
      episodeNumber: 7,
      endingEpisodeNumber: undefined,
      seriesMetadataKey: 'tv:sample show:',
    });
  });

  it('does not mistake Bluey 720p release tags for an episode range', () => {
    expect(
      parseMediaMetadata('Season 01/Bluey.S01E01.720p.DSNP.WEBRip.x264-GalaxyTV.mkv'),
    ).toMatchObject({
      detectedMediaType: 'tv',
      parsedTitle: 'Bluey',
      seasonNumber: 1,
      episodeNumber: 1,
      endingEpisodeNumber: undefined,
    });
  });

  it('does not mistake a hyphenated resolution tag for an episode range', () => {
    expect(parseMediaMetadata('Bluey.S01E01-720p.WEBRip.mkv')).toMatchObject({
      detectedMediaType: 'tv',
      parsedTitle: 'Bluey',
      seasonNumber: 1,
      episodeNumber: 1,
      endingEpisodeNumber: undefined,
    });
  });

  it.each([
    ['Sample.Show.S01E07-E08.mkv', 8],
    ['Sample.Show.S01E07-08.mkv', 8],
    ['Sample Show 1x07-08.mkv', 8],
  ])('parses multi-episode filename %s', (filename, endingEpisodeNumber) => {
    expect(parseMediaMetadata(filename)).toMatchObject({
      detectedMediaType: 'tv',
      seasonNumber: 1,
      episodeNumber: 7,
      endingEpisodeNumber,
    });
  });

  it('falls back to the parent folder for bare episode filenames', () => {
    expect(parseMediaMetadata('Sample Show/Season 01/S01E07.mkv')).toMatchObject({
      detectedMediaType: 'tv',
      parsedTitle: 'Sample Show',
      seasonNumber: 1,
      episodeNumber: 7,
    });
  });

  it('parses x-style episode notation', () => {
    expect(parseMediaMetadata('Andor 1x02.mkv')).toMatchObject({
      detectedMediaType: 'tv',
      parsedTitle: 'Andor',
      seasonNumber: 1,
      episodeNumber: 2,
    });
  });

  it('parses simple movie titles with years', () => {
    expect(parseMediaMetadata('Dune (2021) 2160p WEB-DL.mkv')).toMatchObject({
      detectedMediaType: 'movie',
      parsedTitle: 'Dune',
      parsedYear: 2021,
    });
  });
});
