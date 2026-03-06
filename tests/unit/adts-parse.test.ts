import { describe, expect, it } from 'vitest';
import { parseAdtsFrames } from '../../src/pipeline/adts-parse.js';

describe('parseAdtsFrames', () => {
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
