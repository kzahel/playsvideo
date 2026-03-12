import { describe, expect, it } from 'vitest';
import { isSiblingSubtitleCandidate } from '../../app/src/subtitle-sibling.js';

describe('isSiblingSubtitleCandidate', () => {
  it('matches an exact sibling subtitle name', () => {
    expect(isSiblingSubtitleCandidate('Movie.mkv', 'Movie.srt')).toBe(true);
  });

  it('matches a language-suffixed sibling subtitle name', () => {
    expect(isSiblingSubtitleCandidate('Movie.2021.mkv', 'Movie.2021.en.srt')).toBe(true);
  });

  it('matches a dash-suffixed sibling subtitle name', () => {
    expect(isSiblingSubtitleCandidate('Show.S01E02.mkv', 'Show.S01E02-forced.vtt')).toBe(true);
  });

  it('does not match unrelated subtitle files from the same folder', () => {
    expect(isSiblingSubtitleCandidate('Show.S01E02.mkv', 'Show.S01E03.srt')).toBe(false);
  });

  it('ignores unsupported subtitle extensions', () => {
    expect(isSiblingSubtitleCandidate('Movie.mkv', 'Movie.ass')).toBe(false);
  });
});
