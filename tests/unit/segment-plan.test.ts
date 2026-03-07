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
  it('creates one segment per keyframe boundary', () => {
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      durationSec: 10,
      targetSegmentDurationSec: 4,
    });

    // Cuts at every keyframe regardless of targetSegmentDurationSec
    expect(plan.length).toBe(10);
    expect(plan[0]).toMatchObject({ sequence: 0, startSec: 0, durationSec: 1 });
    expect(plan[9]).toMatchObject({ sequence: 9, startSec: 9, durationSec: 1 });
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

  it('cuts at every keyframe regardless of target duration', () => {
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: [0, 2, 4, 6, 8],
      durationSec: 8,
    });

    // One segment per keyframe interval
    expect(plan.length).toBe(4);
    expect(plan[0]).toMatchObject({ startSec: 0, durationSec: 2 });
    expect(plan[1]).toMatchObject({ startSec: 2, durationSec: 2 });
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
    });

    // Segment 0 starts at 0, not 0.07, so the full duration is covered
    expect(plan[0]).toMatchObject({ sequence: 0, startSec: 0 });
    expect(plan[0].durationSec).toBeCloseTo(2.5, 2);
    // Segment 1 starts at the second keyframe
    expect(plan[1]).toMatchObject({ sequence: 1, startSec: 2.5 });
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
