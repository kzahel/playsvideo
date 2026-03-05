import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import type { FfmpegRunner } from '../pipeline/types.js';

let instance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const ff = new FFmpeg();
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    await ff.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
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
