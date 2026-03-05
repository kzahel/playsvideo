import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FfmpegRunner } from '../pipeline/types.js';

export class NodeFfmpegRunner implements FfmpegRunner {
  private ffmpegPath: string;

  constructor(ffmpegPath = 'ffmpeg') {
    this.ffmpegPath = ffmpegPath;
  }

  async run(args: string[]): Promise<{ exitCode: number; stderr: string }> {
    return new Promise((resolve) => {
      execFile(
        this.ffmpegPath,
        args,
        { maxBuffer: 100 * 1024 * 1024 },
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
