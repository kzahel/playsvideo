import type { FfmpegTranscodeMetrics } from './pipeline/audio-transcode.js';

export interface ConnectTranscodeWorkerMessage {
  type: 'connect';
}

export interface TranscodePortMessage {
  type: 'transcode-port';
  id: number;
}

export interface TranscodeJobRequest {
  type: 'transcode-job';
  jobId: number;
  inputData: ArrayBuffer;
  sourceCodec?: string;
}

export interface TranscodeJobSuccess {
  type: 'transcode-result';
  jobId: number;
  ok: true;
  outputData: ArrayBuffer;
  metrics: FfmpegTranscodeMetrics;
}

export interface TranscodeJobFailure {
  type: 'transcode-result';
  jobId: number;
  ok: false;
  error: string;
}

export type TranscodeJobResponse = TranscodeJobSuccess | TranscodeJobFailure;
