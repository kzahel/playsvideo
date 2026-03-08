import { describe, expect, it } from 'vitest';
import { parseSubtitleFile, subtitleDataToWebVTT } from '../../src/pipeline/subtitle.js';

describe('parseSubtitleFile', () => {
  it('parses SRT and converts it to WebVTT', () => {
    const srt = `1
00:00:01,000 --> 00:00:03,000
Hello

2
00:00:04,500 --> 00:00:06,000
World`;

    const data = parseSubtitleFile(srt, 'movie.en.srt');

    expect(data.codec).toBe('srt');
    expect(data.cues).toHaveLength(2);
    expect(data.cues[0]).toMatchObject({
      startSec: 1,
      endSec: 3,
      text: 'Hello',
    });

    const webvtt = subtitleDataToWebVTT(data);
    expect(webvtt).toContain('WEBVTT');
    expect(webvtt).toContain('Hello');
    expect(webvtt).toContain('World');
  });

  it('parses WebVTT and preserves cue settings', () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:02.500 line:10%
Caption`;

    const data = parseSubtitleFile(vtt, 'movie.vtt');

    expect(data.codec).toBe('webvtt');
    expect(data.cues).toHaveLength(1);
    expect(data.cues[0]).toMatchObject({
      startSec: 1,
      endSec: 2.5,
      text: 'Caption',
      settings: 'line:10%',
    });
  });

  it('keeps external ASS/SSA opaque for future rendering work', () => {
    const ass = `[Script Info]
Title: Example

[Events]
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello`;

    const data = parseSubtitleFile(ass, 'movie.ass');

    expect(data.codec).toBe('ass');
    expect(data.cues).toEqual([]);
    expect(data.header).toContain('[Events]');
  });
});
