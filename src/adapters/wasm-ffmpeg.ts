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

/** Emscripten module interface returned by createFFmpegCore. */
interface FFmpegCoreModule {
  exec(...args: string[]): number;
  ret: number;
  FS: {
    writeFile(name: string, data: Uint8Array): void;
    readFile(name: string): Uint8Array;
    unlink(name: string): void;
  };
  setLogger(fn: (data: { type: string; message: string }) => void): void;
  reset(): void;
}

type CreateFFmpegCore = (opts: { mainScriptUrlOrBlob: string }) => Promise<FFmpegCoreModule>;

let coreModule: FFmpegCoreModule | null = null;
let loadedTier: FfmpegTier | null = null;
let loadPromise: Promise<FFmpegCoreModule> | null = null;
let pendingTier: FfmpegTier | null = null;

/** Full is a superset of audio — never downgrade. */
const TIER_RANK: Record<FfmpegTier, number> = { audio: 0, full: 1 };

async function ensureTier(tier: FfmpegTier): Promise<FFmpegCoreModule> {
  if (tier === 'full' && !FULL_TIER_ENABLED) {
    throw new Error(
      'Full ffmpeg tier is not currently enabled — only audio transcode is supported',
    );
  }

  // Already loaded a sufficient tier
  if (coreModule && loadedTier !== null && TIER_RANK[loadedTier] >= TIER_RANK[tier]) {
    return coreModule;
  }

  // Already loading a sufficient tier
  if (loadPromise && pendingTier !== null && TIER_RANK[pendingTier] >= TIER_RANK[tier]) {
    return loadPromise;
  }

  // Wait for any in-progress load before upgrading
  if (loadPromise) {
    await loadPromise;
  }

  // Discard existing module if upgrading
  if (coreModule) {
    console.log(`[ffmpeg] upgrading ${loadedTier} → ${tier}`);
    coreModule = null;
    loadedTier = null;
  }

  pendingTier = tier;
  loadPromise = (async () => {
    const { coreURL, wasmURL } = TIER_URLS[tier as 'audio'];
    console.log(`[ffmpeg] loading ${tier} bundle`);
    const { default: createFFmpegCore } = (await import(/* @vite-ignore */ coreURL)) as {
      default: CreateFFmpegCore;
    };
    const core = await createFFmpegCore({
      mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL: '' }))}`,
    });
    console.log(`[ffmpeg] ${tier} bundle ready`);
    coreModule = core;
    loadedTier = tier;
    return core;
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

  private getCore(): Promise<FFmpegCoreModule> {
    return ensureTier(this.tier);
  }

  async writeInput(name: string, data: Uint8Array): Promise<void> {
    const core = await this.getCore();
    core.FS.writeFile(name, data);
  }

  async readOutput(name: string): Promise<Uint8Array> {
    const core = await this.getCore();
    return core.FS.readFile(name);
  }

  async deleteFile(name: string): Promise<void> {
    const core = await this.getCore();
    try {
      core.FS.unlink(name);
    } catch {
      // ignore — file may not exist
    }
  }

  async run(args: string[]): Promise<{ exitCode: number; stderr: string }> {
    const core = await this.getCore();
    const stderr: string[] = [];
    core.setLogger(({ message }) => stderr.push(message));
    try {
      const exitCode = core.exec(...args);
      core.reset();
      return { exitCode, stderr: stderr.join('\n') };
    } finally {
      core.setLogger(() => {});
    }
  }
}
