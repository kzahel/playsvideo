/**
 * Codec support detection for HLS/MSE playback.
 *
 * Determines whether audio/video codecs can be played natively via MSE
 * or need transcoding. The CodecProber interface is platform-swappable:
 * browser uses MediaSource.isTypeSupported(), Node/test uses a static whitelist.
 */

/** Fallback MSE codec strings when decoderConfig is unavailable. */
const AUDIO_CODEC_MAP: Record<string, string> = {
  aac: 'mp4a.40.2',
  mp3: 'mp4a.69',
  ac3: 'ac-3',
  eac3: 'ec-3',
  flac: 'flac',
  opus: 'opus',
};

const VIDEO_CODEC_MAP: Record<string, string> = {
  avc: 'avc1.640028',
  hevc: 'hev1.1.6.L93.B0',
  vp9: 'vp09.00.10.08',
  av1: 'av01.0.01M.08',
};

export interface CodecProber {
  /** Can MSE play this audio codec in an fMP4 container? */
  canPlayAudio(shortCodec: string, fullCodecString?: string): boolean;
  /** Can MSE play this video codec in an fMP4 container? */
  canPlayVideo(shortCodec: string, fullCodecString?: string): boolean;
}

/**
 * Browser prober — queries MediaSource.isTypeSupported() with result caching.
 * Create once at module level in the worker.
 */
export function createBrowserProber(): CodecProber {
  const cache = new Map<string, boolean>();

  function isSupported(mime: string): boolean {
    const cached = cache.get(mime);
    if (cached !== undefined) return cached;
    const result = MediaSource.isTypeSupported(mime);
    cache.set(mime, result);
    return result;
  }

  return {
    canPlayAudio(shortCodec, fullCodecString) {
      const codecStr = fullCodecString ?? AUDIO_CODEC_MAP[shortCodec];
      if (!codecStr) return false;
      return isSupported(`audio/mp4; codecs="${codecStr}"`);
    },
    canPlayVideo(shortCodec, fullCodecString) {
      const codecStr = fullCodecString ?? VIDEO_CODEC_MAP[shortCodec];
      if (!codecStr) return false;
      return isSupported(`video/mp4; codecs="${codecStr}"`);
    },
  };
}

/** Conservative static whitelist for Node.js / tests. Matches prior behavior. */
const NODE_SAFE_AUDIO = new Set(['aac', 'mp3']);
const NODE_SAFE_VIDEO = new Set(['avc', 'hevc']);

export function createNodeProber(): CodecProber {
  return {
    canPlayAudio(shortCodec) {
      return NODE_SAFE_AUDIO.has(shortCodec);
    },
    canPlayVideo(shortCodec) {
      return NODE_SAFE_VIDEO.has(shortCodec);
    },
  };
}

/** Does this audio codec need transcoding in the given environment? */
export function audioNeedsTranscode(
  prober: CodecProber,
  shortCodec: string,
  fullCodecString?: string,
): boolean {
  return !prober.canPlayAudio(shortCodec, fullCodecString);
}
