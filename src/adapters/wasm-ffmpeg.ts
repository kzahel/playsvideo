import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { FfmpegRunner } from '../pipeline/types.js';

// Vite resolves these to asset URLs at build time
import coreJsUrl from '../vendor/ffmpeg-core/ffmpeg-core.js?url';
import coreWasmUrl from '../vendor/ffmpeg-core/ffmpeg-core.wasm?url';

let instance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const ff = new FFmpeg();
    await ff.load({
      coreURL: coreJsUrl,
      wasmURL: coreWasmUrl,
    });
    instance = ff;
    return ff;
  })();
  return loadPromise;
}

export class WasmFfmpegRunner implements FfmpegRunner {
  async writeInput(name: string, data: Uint8Array): Promise<void> {
    const ff = await getFFmpeg();
    await ff.writeFile(name, data);
  }

  async readOutput(name: string): Promise<Uint8Array> {
    const ff = await getFFmpeg();
    const data = await ff.readFile(name);
    if (typeof data === 'string') throw new Error('Expected binary output');
    return data;
  }

  async deleteFile(name: string): Promise<void> {
    const ff = await getFFmpeg();
    try {
      await ff.deleteFile(name);
    } catch {
      // ignore — file may not exist
    }
  }

  async run(args: string[]): Promise<{ exitCode: number; stderr: string }> {
    const ff = await getFFmpeg();
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
