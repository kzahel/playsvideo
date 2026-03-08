import { describe, expect, it } from 'vitest';
import { buildSegmentPlan, normalizeKeyframeTimestamps } from '../../src/pipeline/segment-plan.js';

describe('normalizeKeyframeTimestamps', () => {
  it('keeps first keyframe as first boundary (no synthetic 0)', () => {
    const result = normalizeKeyframeTimestamps([2, 4, 6], 10);
    expect(result[0]).toBe(2);
    expect(result[result.length - 1]).toBe(10);
  });

  it('adds 0 when keyframe list is empty', () => {
    const result = normalizeKeyframeTimestamps([], 10);
    expect(result).toEqual([0, 10]);
  });

  it('deduplicates timestamps within 1ms', () => {
    const result = normalizeKeyframeTimestamps([0, 0.0005, 2, 2.0003, 4], 6);
    expect(result).toEqual([0, 2, 4, 6]);
  });

  it('filters out NaN and negative values', () => {
    const result = normalizeKeyframeTimestamps([NaN, -1, 0, 2, Infinity], 4);
    expect(result).toEqual([0, 2, 4]);
  });

  it('throws on invalid duration', () => {
    expect(() => normalizeKeyframeTimestamps([0, 1], 0)).toThrow();
    expect(() => normalizeKeyframeTimestamps([0, 1], -1)).toThrow();
    expect(() => normalizeKeyframeTimestamps([0, 1], NaN)).toThrow();
  });
});

describe('buildSegmentPlan', () => {
  it('cuts on the first keyframe at or after each global target boundary', () => {
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      durationSec: 10,
      targetSegmentDurationSec: 4,
    });

    expect(plan).toMatchObject([
      { sequence: 0, startSec: 0, durationSec: 4 },
      { sequence: 1, startSec: 4, durationSec: 4 },
      { sequence: 2, startSec: 8, durationSec: 2 },
    ]);
  });

  it('handles single long gap between keyframes', () => {
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: [0, 10],
      durationSec: 10,
      targetSegmentDurationSec: 4,
    });

    expect(plan.length).toBe(1);
    expect(plan[0].durationSec).toBe(10);
  });

  it('uses 4s target duration by default', () => {
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: [0, 2, 4, 6, 8],
      durationSec: 8,
    });

    expect(plan).toMatchObject([
      { startSec: 0, durationSec: 4 },
      { startSec: 4, durationSec: 4 },
    ]);
  });

  it('generates correct URIs', () => {
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: [0, 4, 8],
      durationSec: 8,
      targetSegmentDurationSec: 4,
    });

    expect(plan[0].uri).toBe('seg-0.m4s');
    expect(plan[1].uri).toBe('seg-1.m4s');
  });

  it('respects sequenceStart', () => {
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: [0, 4],
      durationSec: 4,
      sequenceStart: 5,
    });

    expect(plan[0].sequence).toBe(5);
    expect(plan[0].uri).toBe('seg-5.m4s');
  });

  it('starts segment 0 at time 0 even when first keyframe is later', () => {
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: [0.07, 2.5, 5.0],
      durationSec: 5,
      targetSegmentDurationSec: 2,
    });

    // Segment 0 starts at 0, not 0.07, so the full duration is covered
    expect(plan[0]).toMatchObject({ sequence: 0, startSec: 0 });
    expect(plan[0].durationSec).toBeCloseTo(2.5, 2);
    // Segment 1 starts at the second keyframe and runs to the end.
    expect(plan[1]).toMatchObject({ sequence: 1, startSec: 2.5 });
  });

  it('matches ffmpeg-style global threshold cuts across uneven keyframes', () => {
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: [0, 2.25225, 2.669333, 6.047708, 10.176833, 12.971292, 17.017],
      durationSec: 17.017,
      targetSegmentDurationSec: 4,
    });

    expect(plan).toHaveLength(4);
    expect(plan[0]).toMatchObject({ startSec: 0 });
    expect(plan[0].durationSec).toBeCloseTo(6.047708, 6);
    expect(plan[1]).toMatchObject({ startSec: 6.047708 });
    expect(plan[1].durationSec).toBeCloseTo(4.129125, 6);
    expect(plan[2]).toMatchObject({ startSec: 10.176833 });
    expect(plan[2].durationSec).toBeCloseTo(2.794459, 6);
    expect(plan[3]).toMatchObject({ startSec: 12.971292 });
    expect(plan[3].durationSec).toBeCloseTo(4.045708, 6);
  });

  it('covers the full duration', () => {
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
      durationSec: 20,
      targetSegmentDurationSec: 6,
    });

    const totalDuration = plan.reduce((sum, s) => sum + s.durationSec, 0);
    expect(totalDuration).toBeCloseTo(20, 2);
  });
});
