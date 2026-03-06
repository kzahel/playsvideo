import { EncodedPacket } from 'mediabunny';
import { parseAdtsFrames } from './adts-parse.js';
import type { FfmpegRunner } from './types.js';

const SAMPLES_PER_AAC_FRAME = 1024;
const INPUT_NAME = 'transcode-input.ac3';
const OUTPUT_NAME = 'transcode-output.aac';

export interface TranscodeOptions {
  packets: EncodedPacket[];
  sampleRate: number;
  /** Timestamp of the first original audio packet — used as base for transcoded timestamps */
  audioStartSec: number;
  ffmpeg: FfmpegRunner;
}

export interface TranscodeResult {
  packets: EncodedPacket[];
  decoderConfig: AudioDecoderConfig;
}

export async function transcodeAudioSegment(opts: TranscodeOptions): Promise<TranscodeResult> {
  if (opts.packets.length === 0) {
    return {
      packets: [],
      decoderConfig: { codec: 'mp4a.40.2', numberOfChannels: 2, sampleRate: opts.sampleRate },
    };
  }

  // Concatenate source audio packets into raw bitstream
  const totalSize = opts.packets.reduce((sum, p) => sum + p.data.byteLength, 0);
  const rawAudio = new Uint8Array(totalSize);
  let offset = 0;
  for (const pkt of opts.packets) {
    rawAudio.set(pkt.data, offset);
    offset += pkt.data.byteLength;
  }

  await opts.ffmpeg.writeInput(INPUT_NAME, rawAudio);

  const result = await opts.ffmpeg.run([
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'ac3',
    '-i',
    INPUT_NAME,
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-b:a',
    '160k',
    '-f',
    'adts',
    '-y',
    OUTPUT_NAME,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Audio transcode failed: ${result.stderr}`);
  }

  const aacData = await opts.ffmpeg.readOutput(OUTPUT_NAME);
  await opts.ffmpeg.deleteFile?.(INPUT_NAME);
  await opts.ffmpeg.deleteFile?.(OUTPUT_NAME);

  const frames = parseAdtsFrames(aacData);
  const frameDuration = SAMPLES_PER_AAC_FRAME / opts.sampleRate;

  let timestamp = opts.audioStartSec;
  const packets = frames.map((frame, i) => {
    const pkt = new EncodedPacket(
      frame.data,
      'key', // all AAC frames are keyframes
      timestamp,
      frameDuration,
      i,
    );
    timestamp += frameDuration;
    return pkt;
  });

  const decoderConfig: AudioDecoderConfig = {
    codec: 'mp4a.40.2', // AAC-LC
    numberOfChannels: frames[0]?.channels ?? 2,
    sampleRate: frames[0]?.sampleRate ?? opts.sampleRate,
  };

  return { packets, decoderConfig };
}
