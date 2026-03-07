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

  if (!normalized.length) {
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

  const boundaries = normalizeKeyframeTimestamps(options.keyframeTimestampsSec, durationSec);
  const plan: PlannedSegment[] = [];
  let sequence = sequenceStart;

  // Cut at every keyframe boundary — matches ffmpeg HLS behavior.
  // ffmpeg cuts at each keyframe regardless of hls_time; the target duration
  // only affects the M3U8 EXT-X-TARGETDURATION header, not segment boundaries.
  for (let i = 0; i < boundaries.length - 1; i++) {
    // Segment 0 always starts at 0 so the HLS playlist covers the full
    // duration, even when the first video keyframe is slightly after 0.
    const startSec = i === 0 ? 0 : boundaries[i];
    const endSec = boundaries[i + 1];
    const duration = Math.max(EPSILON_SEC, endSec - startSec);
    plan.push({
      sequence,
      uri: `seg-${sequence}.m4s`,
      startSec,
      durationSec: duration,
    });
    sequence += 1;
  }

  return plan;
}
