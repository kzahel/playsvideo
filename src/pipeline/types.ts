export interface KeyframeEntry {
  timestamp: number; // seconds
  sequenceNumber: number;
}

export interface KeyframeIndex {
  duration: number; // seconds
  keyframes: KeyframeEntry[];
}

export interface PlannedSegment {
  sequence: number;
  uri: string;
  startSec: number;
  durationSec: number;
}

export interface PlaylistEntry {
  uri: string;
  durationSec: number;
  discontinuity?: boolean;
}

export interface PlaylistSpec {
  targetDuration: number;
  mediaSequence: number;
  entries: PlaylistEntry[];
  endList: boolean;
  mapUri?: string;
}

export interface FfmpegRunner {
  run(args: string[]): Promise<{ exitCode: number; stderr: string }>;
  writeInput(name: string, data: Uint8Array): Promise<void>;
  readOutput(name: string): Promise<Uint8Array>;
  deleteFile?(name: string): Promise<void>;
}

export interface ProbeStream {
  index: number;
  codecType: 'video' | 'audio' | 'subtitle' | 'data';
  codecName: string;
  width?: number;
  height?: number;
  sampleRate?: number;
  channels?: number;
  duration?: number;
}

export interface ProbeResult {
  format: string;
  duration: number;
  bitRate?: number;
  streams: ProbeStream[];
}

export interface AdtsFrame {
  data: Uint8Array;
  frameSize: number;
  sampleRate: number;
  channels: number;
}
