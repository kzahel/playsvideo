import { describe, expect, it } from 'vitest';
import {
  generateEventPlaylist,
  generateVodPlaylist,
  parsePlaylist,
} from '../../src/pipeline/playlist.js';

describe('generateVodPlaylist', () => {
  it('generates a valid VOD playlist with ENDLIST', () => {
    const m3u8 = generateVodPlaylist({
      targetDuration: 4,
      mediaSequence: 0,
      mapUri: 'init.mp4',
      entries: [
        { uri: 'seg-0.m4s', durationSec: 4.0 },
        { uri: 'seg-1.m4s', durationSec: 3.5 },
      ],
      endList: true,
    });

    expect(m3u8).toContain('#EXTM3U');
    expect(m3u8).toContain('#EXT-X-VERSION:7');
    expect(m3u8).toContain('#EXT-X-TARGETDURATION:4');
    expect(m3u8).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(m3u8).toContain('#EXT-X-MAP:URI="init.mp4"');
    expect(m3u8).toContain('#EXTINF:4.000000,');
    expect(m3u8).toContain('seg-0.m4s');
    expect(m3u8).toContain('#EXT-X-ENDLIST');
  });
});

describe('generateEventPlaylist', () => {
  it('generates an EVENT playlist without ENDLIST', () => {
    const m3u8 = generateEventPlaylist({
      targetDuration: 4,
      mediaSequence: 0,
      mapUri: 'init.mp4',
      entries: [{ uri: 'seg-0.m4s', durationSec: 4.0 }],
      endList: false,
    });

    expect(m3u8).toContain('#EXT-X-PLAYLIST-TYPE:EVENT');
    expect(m3u8).not.toContain('#EXT-X-ENDLIST');
  });
});

describe('parsePlaylist', () => {
  it('round-trips through generate and parse', () => {
    const original = {
      targetDuration: 6,
      mediaSequence: 0,
      mapUri: 'init.mp4',
      entries: [
        { uri: 'seg-0.m4s', durationSec: 4.5 },
        { uri: 'seg-1.m4s', durationSec: 6.0 },
        { uri: 'seg-2.m4s', durationSec: 2.1 },
      ],
      endList: true,
    };

    const m3u8 = generateVodPlaylist(original);
    const parsed = parsePlaylist(m3u8);

    expect(parsed.targetDuration).toBe(6);
    expect(parsed.mediaSequence).toBe(0);
    expect(parsed.mapUri).toBe('init.mp4');
    expect(parsed.endList).toBe(true);
    expect(parsed.entries.length).toBe(3);
    expect(parsed.entries[0].uri).toBe('seg-0.m4s');
    expect(parsed.entries[0].durationSec).toBeCloseTo(4.5, 4);
  });

  it('handles discontinuity markers', () => {
    const m3u8 = generateVodPlaylist({
      targetDuration: 4,
      mediaSequence: 0,
      entries: [
        { uri: 'seg-0.m4s', durationSec: 4.0 },
        { uri: 'seg-1.m4s', durationSec: 4.0, discontinuity: true },
      ],
      endList: true,
    });

    const parsed = parsePlaylist(m3u8);
    expect(parsed.entries[0].discontinuity).toBeFalsy();
    expect(parsed.entries[1].discontinuity).toBe(true);
  });
});
