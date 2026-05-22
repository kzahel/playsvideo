import { describe, expect, it } from 'vitest';
import { collectPacketsInRange } from '../../src/pipeline/demux.js';
import { getSegmentAudioStartSec } from '../../src/pipeline/segment-processor.js';

interface FakePacket {
  timestamp: number;
  duration: number;
  type: 'key' | 'delta';
  sequenceNumber: number;
  isMetadataOnly: false;
}

function packet(timestamp: number, type: 'key' | 'delta', sequenceNumber: number): FakePacket {
  return {
    timestamp,
    duration: 0.04,
    type,
    sequenceNumber,
    isMetadataOnly: false,
  };
}

function fakeSink(packets: FakePacket[]) {
  return {
    getFirstPacket: async () => packets[0] ?? null,
    getPacket: async (timestamp: number) =>
      [...packets].reverse().find((p) => p.timestamp <= timestamp) ?? null,
    getKeyPacket: async (timestamp: number) =>
      [...packets].reverse().find((p) => p.type === 'key' && p.timestamp <= timestamp) ?? null,
    getNextKeyPacket: async (current: FakePacket) =>
      packets.find((p) => p.type === 'key' && p.sequenceNumber > current.sequenceNumber) ?? null,
    getNextPacket: async (current: FakePacket) =>
      packets.find((p) => p.sequenceNumber === current.sequenceNumber + 1) ?? null,
  };
}

describe('collectPacketsInRange', () => {
  it('advances to the next keyframe when an approximate boundary would rewind too far', async () => {
    const packets = [
      packet(0, 'key', 0),
      packet(0.04, 'delta', 1),
      packet(10.125, 'key', 2),
      packet(10.0, 'delta', 3),
      packet(10.04, 'delta', 4),
    ];

    const collected = await collectPacketsInRange(fakeSink(packets) as never, 10, 11, {
      startFromKeyframe: true,
      maxKeyframeRewindSec: 0.5,
    });

    expect(collected.map((p) => p.sequenceNumber)).toEqual([2, 3, 4]);
  });

  it('keeps a nearby previous keyframe for preroll', async () => {
    const packets = [
      packet(9.75, 'key', 0),
      packet(9.8, 'delta', 1),
      packet(10.04, 'delta', 2),
      packet(10.6, 'key', 3),
    ];

    const collected = await collectPacketsInRange(fakeSink(packets) as never, 10, 11, {
      startFromKeyframe: true,
      maxKeyframeRewindSec: 0.5,
    });

    expect(collected.map((p) => p.sequenceNumber)).toEqual([0, 1, 2, 3]);
  });
});

describe('getSegmentAudioStartSec', () => {
  it('starts audio at small video preroll to avoid buffered holes', () => {
    expect(getSegmentAudioStartSec(10, [packet(9.875, 'key', 0) as never])).toBe(9.875);
  });

  it('caps large audio preroll', () => {
    expect(getSegmentAudioStartSec(10, [packet(0, 'key', 0) as never])).toBe(9.25);
  });
});
