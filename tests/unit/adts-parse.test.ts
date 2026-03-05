import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseAdtsFrames } from '../../src/pipeline/adts-parse.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
const AAC_FILE = join(FIXTURES_DIR, 'test-audio.aac');

beforeAll(() => {
  // Generate a small ADTS file from our test fixture
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    join(FIXTURES_DIR, 'test-h264-aac.mp4'),
    '-vn',
    '-c:a',
    'copy',
    '-f',
    'adts',
    '-y',
    AAC_FILE,
  ]);
});

describe('parseAdtsFrames', () => {
  it('parses valid ADTS frames from a real AAC file', async () => {
    const data = new Uint8Array(await readFile(AAC_FILE));
    const frames = parseAdtsFrames(data);

    expect(frames.length).toBeGreaterThan(0);

    // 3 seconds of audio at 48kHz with 1024 samples/frame = ~140 frames
    expect(frames.length).toBeGreaterThan(100);
    expect(frames.length).toBeLessThan(200);

    // All frames should have valid properties
    for (const frame of frames) {
      expect(frame.frameSize).toBeGreaterThan(7); // at least header size
      expect(frame.data.byteLength).toBe(frame.frameSize);
      expect(frame.sampleRate).toBe(48000);
      expect(frame.channels).toBeGreaterThan(0);
    }

    // Total data should account for entire file
    const totalBytes = frames.reduce((sum, f) => sum + f.frameSize, 0);
    expect(totalBytes).toBe(data.byteLength);
  });

  it('handles empty input', () => {
    const frames = parseAdtsFrames(new Uint8Array(0));
    expect(frames).toEqual([]);
  });

  it('handles truncated data', () => {
    const data = new Uint8Array([0xff, 0xf1, 0x00, 0x00]); // incomplete ADTS header
    const frames = parseAdtsFrames(data);
    expect(frames).toEqual([]);
  });
});
