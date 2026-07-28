import type { ThumbnailFrameDiagnostics } from './protocol.js';

interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type ThumbnailFrameScore = Omit<ThumbnailFrameDiagnostics, 'timestampSec'>;

export function buildThumbnailCandidateTimestamps(durationSec: number): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return [];
  }

  const openingGuardSec = Math.min(30, Math.max(1, durationSec * 0.08));
  const closingGuardSec = Math.min(60, Math.max(1, durationSec * 0.12));
  const latestTimestampSec = Math.max(openingGuardSec, durationSec - closingGuardSec);
  const candidates = [
    durationSec * 0.08,
    durationSec * 0.12,
    durationSec * 0.2,
    durationSec * 0.3,
  ]
    .map((timestamp) =>
      Math.min(latestTimestampSec, Math.max(openingGuardSec, timestamp)),
    )
    .map((timestamp) => Math.round(timestamp * 1000) / 1000)
    .sort((left, right) => left - right);

  return candidates.filter(
    (timestamp, index) =>
      index === 0 || Math.abs(timestamp - candidates[index - 1]) >= 0.25,
  );
}

export function scoreThumbnailPixels(frame: PixelBuffer): ThumbnailFrameScore {
  const stride = 4;
  let sampleCount = 0;
  let darkPixelCount = 0;
  let lumaSum = 0;
  let lumaSquaredSum = 0;
  let edgeSum = 0;
  let edgeCount = 0;
  const rowLuma = new Float32Array(Math.ceil(frame.width / stride));
  const previousRowLuma = new Float32Array(rowLuma.length);

  for (let y = 0; y < frame.height; y += stride) {
    let previousLuma: number | null = null;
    let sampleX = 0;

    for (let x = 0; x < frame.width; x += stride) {
      const offset = (y * frame.width + x) * 4;
      const luma =
        frame.data[offset] * 0.2126 +
        frame.data[offset + 1] * 0.7152 +
        frame.data[offset + 2] * 0.0722;

      rowLuma[sampleX] = luma;
      sampleCount += 1;
      lumaSum += luma;
      lumaSquaredSum += luma * luma;
      if (luma < 24) {
        darkPixelCount += 1;
      }

      if (previousLuma != null) {
        edgeSum += Math.abs(luma - previousLuma);
        edgeCount += 1;
      }
      if (y > 0) {
        edgeSum += Math.abs(luma - previousRowLuma[sampleX]);
        edgeCount += 1;
      }

      previousLuma = luma;
      sampleX += 1;
    }

    previousRowLuma.set(rowLuma);
  }

  const meanLuma = sampleCount > 0 ? lumaSum / sampleCount : 0;
  const variance =
    sampleCount > 0
      ? Math.max(0, lumaSquaredSum / sampleCount - meanLuma * meanLuma)
      : 0;
  const standardDeviation = Math.sqrt(variance);
  const edgeScore = edgeCount > 0 ? edgeSum / edgeCount : 0;
  const darkPixelRatio = sampleCount > 0 ? darkPixelCount / sampleCount : 1;
  const accepted =
    meanLuma >= 24 &&
    meanLuma <= 235 &&
    darkPixelRatio <= 0.72 &&
    standardDeviation >= 12 &&
    edgeScore >= 4;
  const score =
    standardDeviation * 0.8 +
    edgeScore * 1.4 -
    darkPixelRatio * 80 -
    Math.max(0, 35 - meanLuma) * 2 -
    Math.max(0, meanLuma - 225) * 2;

  return {
    meanLuma,
    standardDeviation,
    edgeScore,
    darkPixelRatio,
    score,
    accepted,
  };
}

export function selectBestThumbnailFrame(
  candidates: ThumbnailFrameDiagnostics[],
): ThumbnailFrameDiagnostics | null {
  if (candidates.length === 0) {
    return null;
  }

  const accepted = candidates.filter((candidate) => candidate.accepted);
  const pool = accepted.length > 0 ? accepted : candidates;
  return pool.reduce((best, candidate) =>
    candidate.score > best.score ? candidate : best,
  );
}
