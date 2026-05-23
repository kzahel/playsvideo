import { describe, expect, it } from 'vitest';
import type { SubtitleTrackInfo } from '../../src/pipeline/types.js';
import {
  formatSubtitleTrackLabel,
  normalizeSubtitleLanguageCode,
  subtitleLanguageLabel,
} from '../../src/subtitle-labels.js';

function subtitleInfo(overrides: Partial<SubtitleTrackInfo>): SubtitleTrackInfo {
  return {
    index: 0,
    codec: 'srt',
    language: 'und',
    name: null,
    disposition: {
      default: false,
      forced: false,
      hearingImpaired: false,
    },
    ...overrides,
  };
}

describe('subtitle track labels', () => {
  it('labels two-letter language codes returned by mediabunny', () => {
    expect(formatSubtitleTrackLabel(subtitleInfo({ language: 'en' }), 0)).toBe('English');
    expect(formatSubtitleTrackLabel(subtitleInfo({ language: 'ar' }), 2)).toBe('Arabic');
    expect(formatSubtitleTrackLabel(subtitleInfo({ language: 'bg' }), 3)).toBe('Bulgarian');
  });

  it('combines short subtitle titles with language context', () => {
    expect(
      formatSubtitleTrackLabel(
        subtitleInfo({
          language: 'en',
          name: 'SDH',
          disposition: { default: false, forced: false, hearingImpaired: true },
        }),
        1,
      ),
    ).toBe('English (SDH)');
    expect(
      formatSubtitleTrackLabel(
        subtitleInfo({
          language: 'en',
          name: 'Forced',
          disposition: { default: false, forced: true, hearingImpaired: false },
        }),
        0,
      ),
    ).toBe('English (Forced)');
  });

  it('keeps descriptive regional titles without duplicating the language', () => {
    expect(
      formatSubtitleTrackLabel(
        subtitleInfo({ language: 'es', name: 'Spanish (Latin America)' }),
        10,
      ),
    ).toBe('Spanish (Latin America)');
    expect(
      formatSubtitleTrackLabel(subtitleInfo({ language: 'zh', name: 'Chinese (Traditional)' }), 5),
    ).toBe('Chinese (Traditional)');
  });

  it('uses title metadata when language is undetermined', () => {
    expect(
      formatSubtitleTrackLabel(
        subtitleInfo({ language: 'und', name: 'Cantonese (Traditional)' }),
        41,
      ),
    ).toBe('Cantonese (Traditional)');
  });

  it('normalizes common ISO-639 variants for srclang and display', () => {
    expect(normalizeSubtitleLanguageCode('eng')).toBe('en');
    expect(normalizeSubtitleLanguageCode('ger')).toBe('de');
    expect(normalizeSubtitleLanguageCode('chi')).toBe('zh');
    expect(subtitleLanguageLabel('cze')).toBe('Czech');
  });
});
