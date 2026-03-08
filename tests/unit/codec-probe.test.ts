import { describe, expect, it, vi } from 'vitest';
import {
  audioNeedsTranscode,
  type CodecProber,
  createBrowserProber,
  createNodeProber,
} from '../../src/pipeline/codec-probe.js';

describe('codec-probe', () => {
  const prober = createNodeProber();

  describe('createNodeProber audio', () => {
    it('allows aac only', () => {
      expect(prober.canPlayAudio('aac')).toBe(true);
    });

    it('rejects mp3, ac3, eac3, dts, flac, opus', () => {
      expect(prober.canPlayAudio('mp3')).toBe(false);
      expect(prober.canPlayAudio('ac3')).toBe(false);
      expect(prober.canPlayAudio('eac3')).toBe(false);
      expect(prober.canPlayAudio('dts')).toBe(false);
      expect(prober.canPlayAudio('flac')).toBe(false);
      expect(prober.canPlayAudio('opus')).toBe(false);
    });

    it('rejects unknown codecs', () => {
      expect(prober.canPlayAudio('unknown')).toBe(false);
    });
  });

  describe('createNodeProber video', () => {
    it('allows avc', () => {
      expect(prober.canPlayVideo('avc')).toBe(true);
    });

    it('allows hevc', () => {
      expect(prober.canPlayVideo('hevc')).toBe(true);
    });

    it('rejects vp9 and av1', () => {
      expect(prober.canPlayVideo('vp9')).toBe(false);
      expect(prober.canPlayVideo('av1')).toBe(false);
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

    it('dts needs transcode', () => {
      expect(audioNeedsTranscode(prober, 'dts')).toBe(true);
    });

    it('unknown codecs need transcode (safe default)', () => {
      expect(audioNeedsTranscode(prober, 'vorbis')).toBe(true);
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

  describe('createBrowserProber', () => {
    function mockMediaSource(supported: Set<string>) {
      const isTypeSupported = vi.fn((mime: string) => supported.has(mime));
      vi.stubGlobal('MediaSource', { isTypeSupported });
      return isTypeSupported;
    }

    it('hevc queries correct MIME type', () => {
      const spy = mockMediaSource(new Set(['video/mp4; codecs="hev1.1.6.L93.B0"']));
      const bp = createBrowserProber();
      expect(bp.canPlayVideo('hevc')).toBe(true);
      expect(spy).toHaveBeenCalledWith('video/mp4; codecs="hev1.1.6.L93.B0"');
    });

    it('hevc rejected when browser lacks support (Chromium, Firefox)', () => {
      mockMediaSource(new Set());
      const bp = createBrowserProber();
      expect(bp.canPlayVideo('hevc')).toBe(false);
    });

    it('hevc with fullCodecString overrides default', () => {
      const spy = mockMediaSource(new Set(['video/mp4; codecs="hev1.2.4.L120.B0"']));
      const bp = createBrowserProber();
      expect(bp.canPlayVideo('hevc', 'hev1.2.4.L120.B0')).toBe(true);
      expect(spy).toHaveBeenCalledWith('video/mp4; codecs="hev1.2.4.L120.B0"');
    });

    it('avc queries correct MIME type', () => {
      const spy = mockMediaSource(new Set(['video/mp4; codecs="avc1.640028"']));
      const bp = createBrowserProber();
      expect(bp.canPlayVideo('avc')).toBe(true);
      expect(spy).toHaveBeenCalledWith('video/mp4; codecs="avc1.640028"');
    });

    it('caches repeated queries', () => {
      const spy = mockMediaSource(new Set(['video/mp4; codecs="hev1.1.6.L93.B0"']));
      const bp = createBrowserProber();
      bp.canPlayVideo('hevc');
      bp.canPlayVideo('hevc');
      bp.canPlayVideo('hevc');
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('unknown video codec returns false without querying', () => {
      const spy = mockMediaSource(new Set());
      const bp = createBrowserProber();
      expect(bp.canPlayVideo('unknown')).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });

    it('chromium-like: avc supported, hevc not', () => {
      mockMediaSource(
        new Set([
          'video/mp4; codecs="avc1.640028"',
          'video/mp4; codecs="vp09.00.10.08"',
          'video/mp4; codecs="av01.0.01M.08"',
        ]),
      );
      const bp = createBrowserProber();
      expect(bp.canPlayVideo('avc')).toBe(true);
      expect(bp.canPlayVideo('vp9')).toBe(true);
      expect(bp.canPlayVideo('av1')).toBe(true);
      expect(bp.canPlayVideo('hevc')).toBe(false);
    });

    it('safari-like: avc and hevc supported, vp9 and av1 not', () => {
      mockMediaSource(
        new Set(['video/mp4; codecs="avc1.640028"', 'video/mp4; codecs="hev1.1.6.L93.B0"']),
      );
      const bp = createBrowserProber();
      expect(bp.canPlayVideo('avc')).toBe(true);
      expect(bp.canPlayVideo('hevc')).toBe(true);
      expect(bp.canPlayVideo('vp9')).toBe(false);
      expect(bp.canPlayVideo('av1')).toBe(false);
    });

    it('audio codecs query correct MIME types', () => {
      const spy = mockMediaSource(
        new Set(['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="mp4a.69"']),
      );
      const bp = createBrowserProber();
      expect(bp.canPlayAudio('aac')).toBe(true);
      expect(bp.canPlayAudio('mp3')).toBe(true);
      expect(bp.canPlayAudio('ac3')).toBe(false);
      expect(spy).toHaveBeenCalledWith('audio/mp4; codecs="mp4a.40.2"');
      expect(spy).toHaveBeenCalledWith('audio/mp4; codecs="mp4a.69"');
      expect(spy).not.toHaveBeenCalledWith('audio/mp4; codecs="ac-3"');
    });

    it('treats ac3 and eac3 as pipeline-unsafe even if MSE reports support', () => {
      const spy = mockMediaSource(
        new Set(['audio/mp4; codecs="ac-3"', 'audio/mp4; codecs="ec-3"']),
      );
      const bp = createBrowserProber();
      expect(bp.canPlayAudio('ac3')).toBe(false);
      expect(bp.canPlayAudio('eac3')).toBe(false);
      expect(spy).not.toHaveBeenCalledWith('audio/mp4; codecs="ac-3"');
      expect(spy).not.toHaveBeenCalledWith('audio/mp4; codecs="ec-3"');
    });
  });
});
