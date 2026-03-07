import { EncodedPacket } from 'mediabunny';
import { parseAdtsFrames } from './adts-parse.js';
import type { FfmpegRunner } from './types.js';

const SAMPLES_PER_AAC_FRAME = 1024;
const DEFAULT_OUTPUT_SAMPLE_RATE = 48000;
const DEFAULT_OUTPUT_CHANNELS = 2;

const runnerLocks = new WeakMap<FfmpegRunner, { tail: Promise<void> }>();
let transcodeJobCounter = 0;

/** Map short codec names to ffmpeg input format (-f) flags. */
const INPUT_FORMAT: Record<string, string> = {
  ac3: 'ac3',
  eac3: 'eac3',
  dts: 'dts',
  mp3: 'mp3',
  flac: 'flac',
  opus: 'ogg',
};

export interface TranscodeOptions {
  packets: EncodedPacket[];
  sampleRate: number;
  /** Timestamp of the first original audio packet — used as base for transcoded timestamps */
  audioStartSec: number;
  ffmpeg: FfmpegRunner;
  /** Source audio codec (e.g. 'ac3', 'mp3'). Determines ffmpeg input format. Defaults to 'ac3'. */
  sourceCodec?: string;
}

export interface TranscodeMetrics {
  inputPackets: number;
  inputBytes: number;
  /** Duration of input audio (last packet end - first packet start) */
  audioDurationSec: number;
  /** Phase timings in milliseconds */
  concatMs: number;
  writeMs: number;
  ffmpegMs: number;
  readMs: number;
  cleanupMs: number;
  parseMs: number;
  totalMs: number;
  outputPackets: number;
  outputBytes: number;
  /** Duration computed from output frame count */
  outputDurationSec: number;
  /** ffmpeg-reported realtime multiplier (e.g. 63 = 63x realtime), null if not parseable */
  ffmpegSpeed: number | null;
  /** ffmpeg-reported output duration in ms, null if not parseable */
  ffmpegTimeMs: number | null;
  /** totalMs / (audioDurationSec * 1000) — values <1 mean faster than realtime */
  realtimeRatio: number;
}

export interface TranscodeResult {
  packets: EncodedPacket[];
  decoderConfig: AudioDecoderConfig;
  metrics: TranscodeMetrics;
}

export function makeAacDecoderConfig(
  sourceConfig: AudioDecoderConfig | null,
): AudioDecoderConfig {
  return {
    codec: 'mp4a.40.2',
    numberOfChannels: DEFAULT_OUTPUT_CHANNELS,
    sampleRate: sourceConfig?.sampleRate ?? DEFAULT_OUTPUT_SAMPLE_RATE,
  };
}

/** Parse ffmpeg's final stats line for speed and time values. */
function parseFfmpegStats(stderr: string): { speed: number | null; timeMs: number | null } {
  const speedMatch = stderr.match(/speed=\s*([\d.]+)x/);
  const timeMatch = stderr.match(/time=(\d+):(\d+):([\d.]+)/);
  return {
    speed: speedMatch ? Number.parseFloat(speedMatch[1]) : null,
    timeMs: timeMatch
      ? (Number.parseInt(timeMatch[1], 10) * 3600 +
          Number.parseInt(timeMatch[2], 10) * 60 +
          Number.parseFloat(timeMatch[3])) *
        1000
      : null,
  };
}

function now(): number {
  return performance.now();
}

function nextTranscodeJobId(): number {
  transcodeJobCounter += 1;
  return transcodeJobCounter;
}

function getRunnerLockState(runner: FfmpegRunner): { tail: Promise<void> } {
  let state = runnerLocks.get(runner);
  if (!state) {
    state = { tail: Promise.resolve() };
    runnerLocks.set(runner, state);
  }
  return state;
}

async function withRunnerLock<T>(runner: FfmpegRunner, fn: () => Promise<T>): Promise<T> {
  const state = getRunnerLockState(runner);
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function transcodeAudioSegment(opts: TranscodeOptions): Promise<TranscodeResult> {
  if (opts.packets.length === 0) {
    return {
      packets: [],
      decoderConfig: makeAacDecoderConfig({
        codec: 'mp4a.40.2',
        numberOfChannels: DEFAULT_OUTPUT_CHANNELS,
        sampleRate: opts.sampleRate,
      }),
      metrics: {
        inputPackets: 0,
        inputBytes: 0,
        audioDurationSec: 0,
        concatMs: 0,
        writeMs: 0,
        ffmpegMs: 0,
        readMs: 0,
        cleanupMs: 0,
        parseMs: 0,
        totalMs: 0,
        outputPackets: 0,
        outputBytes: 0,
        outputDurationSec: 0,
        ffmpegSpeed: null,
        ffmpegTimeMs: null,
        realtimeRatio: 0,
      },
    };
  }

  const tTotal = now();

  // Concatenate source audio packets into raw bitstream
  const tConcat = now();
  const totalSize = opts.packets.reduce((sum, p) => sum + p.data.byteLength, 0);
  const rawAudio = new Uint8Array(totalSize);
  let offset = 0;
  for (const pkt of opts.packets) {
    rawAudio.set(pkt.data, offset);
    offset += pkt.data.byteLength;
  }
  const concatMs = now() - tConcat;

  const firstPkt = opts.packets[0];
  const lastPkt = opts.packets[opts.packets.length - 1];
  const audioDurationSec = lastPkt.timestamp + lastPkt.duration - firstPkt.timestamp;

  const codec = opts.sourceCodec ?? 'ac3';
  const inputFormat = INPUT_FORMAT[codec] ?? codec;
  const jobId = nextTranscodeJobId();
  const inputName = `transcode-input-${jobId}.${inputFormat}`;
  const outputName = `transcode-output-${jobId}.aac`;

  let writeMs = 0;
  let ffmpegMs = 0;
  let readMs = 0;
  let cleanupMs = 0;
  let ffmpegSpeed: number | null = null;
  let ffmpegTimeMs: number | null = null;
  let aacData: Uint8Array = new Uint8Array(0);

  await withRunnerLock(opts.ffmpeg, async () => {
    try {
      const tWrite = now();
      await opts.ffmpeg.writeInput(inputName, rawAudio);
      writeMs = now() - tWrite;

      const tFfmpeg = now();
      const result = await opts.ffmpeg.run([
        '-hide_banner',
        '-loglevel',
        'info',
        '-f',
        inputFormat,
        '-i',
        inputName,
        '-c:a',
        'aac',
        '-ac',
        String(DEFAULT_OUTPUT_CHANNELS),
        '-b:a',
        '160k',
        '-f',
        'adts',
        '-y',
        outputName,
      ]);
      ffmpegMs = now() - tFfmpeg;

      if (result.exitCode !== 0) {
        throw new Error(`Audio transcode failed: ${result.stderr}`);
      }

      ({ speed: ffmpegSpeed, timeMs: ffmpegTimeMs } = parseFfmpegStats(result.stderr));

      const tRead = now();
      aacData = await opts.ffmpeg.readOutput(outputName);
      readMs = now() - tRead;
    } finally {
      const tCleanup = now();
      await opts.ffmpeg.deleteFile?.(inputName);
      await opts.ffmpeg.deleteFile?.(outputName);
      cleanupMs = now() - tCleanup;
    }
  });

  const tParse = now();
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
  const parseMs = now() - tParse;

  const totalMs = now() - tTotal;
  const outputBytes = aacData.byteLength;
  const outputDurationSec = frames.length * frameDuration;

  const decoderConfig: AudioDecoderConfig = {
    codec: 'mp4a.40.2', // AAC-LC
    numberOfChannels: frames[0]?.channels ?? DEFAULT_OUTPUT_CHANNELS,
    sampleRate: frames[0]?.sampleRate ?? opts.sampleRate,
  };

  const metrics: TranscodeMetrics = {
    inputPackets: opts.packets.length,
    inputBytes: totalSize,
    audioDurationSec,
    concatMs,
    writeMs,
    ffmpegMs,
    readMs,
    cleanupMs,
    parseMs,
    totalMs,
    outputPackets: packets.length,
    outputBytes,
    outputDurationSec,
    ffmpegSpeed,
    ffmpegTimeMs,
    realtimeRatio: audioDurationSec > 0 ? totalMs / (audioDurationSec * 1000) : 0,
  };

  return { packets, decoderConfig, metrics };
}
