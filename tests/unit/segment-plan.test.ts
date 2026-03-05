import { describe, expect, it } from 'vitest';
import { buildSegmentPlan, normalizeKeyframeTimestamps } from '../../src/pipeline/segment-plan.js';

describe('normalizeKeyframeTimestamps', () => {
  it('adds 0 if missing and duration as final boundary', () => {
    const result = normalizeKeyframeTimestamps([2, 4, 6], 10);
    expect(result[0]).toBe(0);
    expect(result[result.length - 1]).toBe(10);
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
  it('creates segments at keyframe boundaries with target duration', () => {
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      durationSec: 10,
      targetSegmentDurationSec: 4,
    });

    expect(plan.length).toBe(3);
    expect(plan[0]).toMatchObject({ sequence: 0, startSec: 0, durationSec: 4 });
    expect(plan[1]).toMatchObject({ sequence: 1, startSec: 4, durationSec: 4 });
    expect(plan[2]).toMatchObject({ sequence: 2, startSec: 8, durationSec: 2 });
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

  it('defaults target duration to 4s', () => {
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: [0, 2, 4, 6, 8],
      durationSec: 8,
    });

    // With 2s keyframe interval and 4s target: [0-4], [4-8]
    expect(plan.length).toBe(2);
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
