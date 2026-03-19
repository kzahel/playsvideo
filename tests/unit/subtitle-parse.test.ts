import { describe, expect, it } from 'vitest';
import {
  extractSubtitleData,
  parseSubtitleFile,
  subtitleDataToWebVTT,
} from '../../src/pipeline/subtitle.js';

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

/**
 * Build a tx3g sample string the way mediabunny delivers it: raw bytes decoded
 * via TextDecoder('utf-8'). Format: 2-byte big-endian text length + text + optional style boxes.
 */
function buildTx3gSample(text: string, styleBox = true): string {
  const textBytes = new TextEncoder().encode(text);
  const parts: number[] = [
    (textBytes.length >> 8) & 0xff,
    textBytes.length & 0xff,
    ...textBytes,
  ];
  if (styleBox) {
    // Minimal 'styl' box: 4-byte size (18) + 'styl' + 2-byte count (1) + 8-byte record
    const stylBox = [
      0x00, 0x00, 0x00, 0x12, // size = 18
      0x73, 0x74, 0x79, 0x6c, // 'styl'
      0x00, 0x01,             // entry count = 1
      0x00, 0x00, 0x00, 0x00, // start/end char offset
      0x00, 0x01, 0x00, 0x00, // font-id, style flags, font-size, color (partial)
    ];
    parts.push(...stylBox);
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(parts));
}

function makeTx3gInput(texts: string[], withStyle = true) {
  return {
    async getSubtitleTracks() {
      return [
        {
          codec: 'tx3g',
          async *getCues() {
            for (let i = 0; i < texts.length; i++) {
              yield {
                timestamp: i,
                duration: 1,
                text: buildTx3gSample(texts[i], withStyle),
              };
            }
          },
        },
      ];
    },
  };
}

describe('tx3g subtitle cleaning', () => {
  it('strips the 2-byte length prefix and trailing styl box', async () => {
    const input = makeTx3gInput(['Hello world']);
    const data = await extractSubtitleData(input as any, 0);

    expect(data.cues).toHaveLength(1);
    expect(data.cues[0].text).toBe('Hello world');
  });

  it('strips style box from multi-cue tx3g tracks', async () => {
    const input = makeTx3gInput(['First line', 'Second line']);
    const data = await extractSubtitleData(input as any, 0);

    expect(data.cues).toHaveLength(2);
    expect(data.cues[0].text).toBe('First line');
    expect(data.cues[1].text).toBe('Second line');
  });

  it('handles tx3g samples without style boxes', async () => {
    const input = makeTx3gInput(['No style'], false);
    const data = await extractSubtitleData(input as any, 0);

    expect(data.cues).toHaveLength(1);
    expect(data.cues[0].text).toBe('No style');
  });

  it('handles tx3g samples with unicode text and style box', async () => {
    const input = makeTx3gInput(['♩ But when I\'m with you']);
    const data = await extractSubtitleData(input as any, 0);

    expect(data.cues).toHaveLength(1);
    expect(data.cues[0].text).toBe('♩ But when I\'m with you');
    // Must not contain styl box remnants
    expect(data.cues[0].text).not.toContain('styl');
    expect(data.cues[0].text).not.toContain('\ufffd');
  });

  it('filters empty tx3g cues after stripping', async () => {
    // A tx3g sample that is just a length prefix of 0 + styl box = empty text
    const input = makeTx3gInput(['']);
    const data = await extractSubtitleData(input as any, 0);

    expect(data.cues).toHaveLength(0);
  });
});

describe('extractSubtitleData progress', () => {
  it('reports start, cue reads, and completion while extracting text subtitles', async () => {
    const events: Array<{ phase: string; cuesRead: number }> = [];
    const input = {
      async getSubtitleTracks() {
        return [
          {
            codec: 'srt',
            async *getCues() {
              for (let i = 0; i < 251; i++) {
                yield {
                  timestamp: i,
                  duration: 1,
                  text: `cue-${i}`,
                };
              }
            },
          },
        ];
      },
    };

    const data = await extractSubtitleData(input as any, 0, {
      onProgress(progress) {
        events.push({ phase: progress.phase, cuesRead: progress.cuesRead });
      },
    });

    expect(data.cues).toHaveLength(251);
    expect(events[0]).toEqual({ phase: 'starting', cuesRead: 0 });
    expect(events).toContainEqual({ phase: 'reading-cues', cuesRead: 1 });
    expect(events).toContainEqual({ phase: 'reading-cues', cuesRead: 251 });
    expect(events.at(-1)).toEqual({ phase: 'done', cuesRead: 251 });
  });

  it('reports the export step for ass subtitles', async () => {
    const phases: string[] = [];
    const input = {
      async getSubtitleTracks() {
        return [
          {
            codec: 'ass',
            async *getCues() {
              yield {
                timestamp: 0,
                duration: 2,
                text: 'Hello',
              };
            },
            async exportToText() {
              return `[Script Info]
Title: Example

[Events]
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello`;
            },
          },
        ];
      },
    };

    const data = await extractSubtitleData(input as any, 0, {
      onProgress(progress) {
        phases.push(progress.phase);
      },
    });

    expect(data.header).toContain('[Events]');
    expect(phases).toEqual(['starting', 'reading-cues', 'exporting-text', 'done']);
  });
});
