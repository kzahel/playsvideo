import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { FfmpegRunner } from '../pipeline/types.js';

// Audio-only bundle (~1.5 MB) — AC3/EAC3/DTS/MP3/FLAC/Opus decode → AAC encode
// Uses new URL(..., import.meta.url) so any bundler (Vite, Webpack, Rollup, esbuild) can resolve it.
const audioJsUrl = new URL('../vendor/ffmpeg-core-audio/ffmpeg-core.js', import.meta.url).href;
const audioWasmUrl = new URL('../vendor/ffmpeg-core-audio/ffmpeg-core.wasm', import.meta.url).href;

export type FfmpegTier = 'audio' | 'full';

/** Full tier is not currently used — reserved for future video transcode support. */
const FULL_TIER_ENABLED = false;

/** Codecs the minimal audio bundle can handle (all decoders built into ffmpeg-core-audio). */
const AUDIO_TIER_CODECS = new Set(['ac3', 'eac3', 'dts', 'mp3', 'flac', 'opus']);

const TIER_URLS: Record<'audio', { coreURL: string; wasmURL: string }> = {
  audio: { coreURL: audioJsUrl, wasmURL: audioWasmUrl },
};

let instance: FFmpeg | null = null;
let loadedTier: FfmpegTier | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
let pendingTier: FfmpegTier | null = null;

/** Full is a superset of audio — never downgrade. */
const TIER_RANK: Record<FfmpegTier, number> = { audio: 0, full: 1 };

async function ensureTier(tier: FfmpegTier): Promise<FFmpeg> {
  if (tier === 'full' && !FULL_TIER_ENABLED) {
    throw new Error(
      'Full ffmpeg tier is not currently enabled — only audio transcode is supported',
    );
  }

  // Already loaded a sufficient tier
  if (instance && loadedTier !== null && TIER_RANK[loadedTier] >= TIER_RANK[tier]) {
    return instance;
  }

  // Already loading a sufficient tier
  if (loadPromise && pendingTier !== null && TIER_RANK[pendingTier] >= TIER_RANK[tier]) {
    return loadPromise;
  }

  // Wait for any in-progress load before upgrading
  if (loadPromise) {
    await loadPromise;
  }

  // Terminate existing instance if upgrading
  if (instance) {
    console.log(`[ffmpeg] upgrading ${loadedTier} → ${tier}`);
    instance.terminate();
    instance = null;
    loadedTier = null;
  }

  pendingTier = tier;
  loadPromise = (async () => {
    const ff = new FFmpeg();
    console.log(`[ffmpeg] loading ${tier} bundle`);
    await ff.load(TIER_URLS[tier as 'audio']);
    console.log(`[ffmpeg] ${tier} bundle ready`);
    instance = ff;
    loadedTier = tier;
    return ff;
  })();

  return loadPromise;
}

export function tierForCodec(codec: string): FfmpegTier {
  return AUDIO_TIER_CODECS.has(codec) ? 'audio' : 'full';
}

export class WasmFfmpegRunner implements FfmpegRunner {
  private tier: FfmpegTier = 'audio';

  /**
   * Pre-load the smallest sufficient bundle for the given audio codec.
   * Call before the first run() to avoid loading the full 32 MB bundle
   * when only audio transcode is needed.
   */
  async loadForCodec(codec: string): Promise<void> {
    this.tier = tierForCodec(codec);
    await ensureTier(this.tier);
  }

  private getFFmpeg(): Promise<FFmpeg> {
    return ensureTier(this.tier);
  }

  async writeInput(name: string, data: Uint8Array): Promise<void> {
    const ff = await this.getFFmpeg();
    await ff.writeFile(name, data);
  }

  async readOutput(name: string): Promise<Uint8Array> {
    const ff = await this.getFFmpeg();
    const data = await ff.readFile(name);
    if (typeof data === 'string') throw new Error('Expected binary output');
    return data;
  }

  async deleteFile(name: string): Promise<void> {
    const ff = await this.getFFmpeg();
    try {
      await ff.deleteFile(name);
    } catch {
      // ignore — file may not exist
    }
  }

  async run(args: string[]): Promise<{ exitCode: number; stderr: string }> {
    const ff = await this.getFFmpeg();
    const stderr: string[] = [];
    const handler = ({ message }: { message: string }) => stderr.push(message);
    ff.on('log', handler);
    try {
      const exitCode = await ff.exec(args);
      return { exitCode, stderr: stderr.join('\n') };
    } finally {
      ff.off('log', handler);
    }
  }
}
