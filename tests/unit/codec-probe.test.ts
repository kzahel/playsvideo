import { describe, expect, it } from 'vitest';
import {
  audioNeedsTranscode,
  type CodecProber,
  createNodeProber,
} from '../../src/pipeline/codec-probe.js';

describe('codec-probe', () => {
  const prober = createNodeProber();

  describe('createNodeProber audio', () => {
    it('allows aac and mp3', () => {
      expect(prober.canPlayAudio('aac')).toBe(true);
      expect(prober.canPlayAudio('mp3')).toBe(true);
    });

    it('rejects ac3, eac3, flac, opus', () => {
      expect(prober.canPlayAudio('ac3')).toBe(false);
      expect(prober.canPlayAudio('eac3')).toBe(false);
      expect(prober.canPlayAudio('flac')).toBe(false);
      expect(prober.canPlayAudio('opus')).toBe(false);
    });

    it('rejects unknown codecs', () => {
      expect(prober.canPlayAudio('unknown')).toBe(false);
    });
  });

  describe('createNodeProber video', () => {
    it('allows avc and hevc', () => {
      expect(prober.canPlayVideo('avc')).toBe(true);
      expect(prober.canPlayVideo('hevc')).toBe(true);
    });

    it('rejects unknown codecs', () => {
      expect(prober.canPlayVideo('unknown')).toBe(false);
    });
  });

  describe('audioNeedsTranscode', () => {
    it('ac3 needs transcode with node prober', () => {
      expect(audioNeedsTranscode(prober, 'ac3')).toBe(true);
    });

    it('aac does not need transcode', () => {
      expect(audioNeedsTranscode(prober, 'aac')).toBe(false);
    });

    it('unknown codecs need transcode (safe default)', () => {
      expect(audioNeedsTranscode(prober, 'dts')).toBe(true);
    });

    it('custom prober can override decisions', () => {
      const allYes: CodecProber = {
        canPlayAudio: () => true,
        canPlayVideo: () => true,
      };
      expect(audioNeedsTranscode(allYes, 'ac3')).toBe(false);
      expect(audioNeedsTranscode(allYes, 'dts')).toBe(false);
    });
  });
});
