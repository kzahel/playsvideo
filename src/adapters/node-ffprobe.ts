import { execFile } from 'node:child_process';
import type { ProbeResult, ProbeStream } from '../pipeline/types.js';

export class NodeFfprobeRunner {
  private ffprobePath: string;

  constructor(ffprobePath = 'ffprobe') {
    this.ffprobePath = ffprobePath;
  }

  async probe(inputPath: string): Promise<ProbeResult> {
    const stdout = await this.execJson([
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      inputPath,
    ]);

    const data = JSON.parse(stdout);
    const streams: ProbeStream[] = (data.streams || []).map((s: Record<string, unknown>) => ({
      index: s.index as number,
      codecType: s.codec_type as ProbeStream['codecType'],
      codecName: s.codec_name as string,
      width: s.width as number | undefined,
      height: s.height as number | undefined,
      sampleRate: s.sample_rate ? parseInt(s.sample_rate as string, 10) : undefined,
      channels: s.channels as number | undefined,
      duration: s.duration ? parseFloat(s.duration as string) : undefined,
    }));

    return {
      format: data.format?.format_name ?? 'unknown',
      duration: parseFloat(data.format?.duration ?? '0'),
      bitRate: data.format?.bit_rate ? parseFloat(data.format.bit_rate as string) : undefined,
      streams,
    };
  }

  async verifyDecodable(
    inputPath: string,
    ffmpegPath = 'ffmpeg',
  ): Promise<{ ok: boolean; stderr: string }> {
    return new Promise((resolve) => {
      execFile(
        ffmpegPath,
        ['-hide_banner', '-loglevel', 'error', '-i', inputPath, '-f', 'null', '-'],
        { maxBuffer: 10 * 1024 * 1024 },
        (error, _stdout, stderr) => {
          resolve({ ok: !error, stderr: stderr || '' });
        },
      );
    });
  }

  private execJson(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.ffprobePath, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`ffprobe failed: ${stderr || error.message}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }
}
