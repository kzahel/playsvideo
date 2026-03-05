import type { PlannedSegment } from './types.js';

const EPSILON_SEC = 1 / 1000;

export function normalizeKeyframeTimestamps(
  timestampsSec: number[],
  durationSec: number,
): number[] {
  const duration = Number(durationSec);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`durationSec must be > 0 (received ${String(durationSec)})`);
  }

  const normalized = [...timestampsSec]
    .map(Number)
    .filter((v) => Number.isFinite(v) && v >= 0 && v <= duration + EPSILON_SEC)
    .map((v) => Math.max(0, Math.min(duration, v)))
    .sort((a, b) => a - b);

  if (!normalized.length || normalized[0] > EPSILON_SEC) {
    normalized.unshift(0);
  }

  const deduped: number[] = [];
  for (const value of normalized) {
    if (!deduped.length || Math.abs(value - deduped[deduped.length - 1]) > EPSILON_SEC) {
      deduped.push(value);
    }
  }

  if (duration - deduped[deduped.length - 1] > EPSILON_SEC) {
    deduped.push(duration);
  } else {
    deduped[deduped.length - 1] = duration;
  }

  if (deduped.length < 2) {
    throw new Error('Not enough boundaries for segmentation.');
  }

  return deduped;
}

export interface BuildSegmentPlanOptions {
  keyframeTimestampsSec: number[];
  durationSec: number;
  targetSegmentDurationSec?: number;
  sequenceStart?: number;
}

export function buildSegmentPlan(options: BuildSegmentPlanOptions): PlannedSegment[] {
  const durationSec = Number(options.durationSec);
  const sequenceStart = Math.max(0, Math.floor(Number(options.sequenceStart) || 0));
  const tsd = options.targetSegmentDurationSec;
  const targetDuration = tsd != null && Number.isFinite(tsd) && tsd > 0 ? tsd : 4;

  const boundaries = normalizeKeyframeTimestamps(options.keyframeTimestampsSec, durationSec);
  const plan: PlannedSegment[] = [];
  let cursor = 0;
  let sequence = sequenceStart;

  while (cursor < boundaries.length - 1) {
    const startSec = boundaries[cursor];
    let endIndex = cursor + 1;

    while (
      endIndex < boundaries.length - 1 &&
      boundaries[endIndex] - startSec + EPSILON_SEC < targetDuration
    ) {
      endIndex += 1;
    }

    const endSec = boundaries[endIndex];
    const duration = Math.max(EPSILON_SEC, endSec - startSec);
    plan.push({
      sequence,
      uri: `seg-${sequence}.m4s`,
      startSec,
      durationSec: duration,
    });

    sequence += 1;
    cursor = endIndex;
  }

  return plan;
}
