export interface ThumbnailFrameDiagnostics {
  timestampSec: number;
  meanLuma: number;
  standardDeviation: number;
  edgeScore: number;
  darkPixelRatio: number;
  score: number;
  accepted: boolean;
}

export interface GenerateThumbnailRequest {
  type: 'generate';
  jobId: number;
  file: File;
}

export interface GeneratedThumbnailResult {
  type: 'generated';
  jobId: number;
  blob: Blob;
  width: number;
  height: number;
  selectedTimestampSec: number;
  durationSec: number;
  debugReason: string;
  candidates: ThumbnailFrameDiagnostics[];
}

export interface ThumbnailGenerationError {
  type: 'error';
  jobId: number;
  message: string;
}

export type ThumbnailWorkerRequest = GenerateThumbnailRequest;
export type ThumbnailWorkerResponse = GeneratedThumbnailResult | ThumbnailGenerationError;
