import { execFile } from 'node:child_process';
import { mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FfmpegRunner } from '../pipeline/types.js';

export class NodeFfmpegRunner implements FfmpegRunner {
  private ffmpegPath: string;
  private dir: string;

  constructor(dir: string, ffmpegPath = 'ffmpeg') {
    this.dir = dir;
    this.ffmpegPath = ffmpegPath;
  }

  async writeInput(name: string, data: Uint8Array): Promise<void> {
    await writeFile(join(this.dir, name), data);
  }

  async readOutput(name: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(join(this.dir, name)));
  }

  async deleteFile(name: string): Promise<void> {
    await unlink(join(this.dir, name)).catch(() => {});
  }

  async run(args: string[]): Promise<{ exitCode: number; stderr: string }> {
    return new Promise((resolve) => {
      execFile(
        this.ffmpegPath,
        args,
        { maxBuffer: 100 * 1024 * 1024, cwd: this.dir },
        (error, _stdout, stderr) => {
          resolve({
            exitCode:
              error?.code !== undefined ? (typeof error.code === 'number' ? error.code : 1) : 0,
            stderr: stderr || '',
          });
        },
      );
    });
  }
}

export async function makeTempDir(prefix = 'playsvideo-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}
