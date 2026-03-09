import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ALL_FORMATS,
  EncodedPacketSink,
  Input,
  StreamSource,
  type EncodedPacket,
} from 'mediabunny';
import { buildMkvKeyframeIndexFromSource } from '../../src/pipeline/mkv-keyframe-index.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
const MKV_FIXTURE = join(FIXTURES_DIR, 'test-h264-ac3-10s.mkv');

interface ReadRecord {
  start: number;
  end: number;
}

function createTrackingSource(buffer: Uint8Array) {
  const reads: ReadRecord[] = [];

  const source = new StreamSource({
    getSize: () => buffer.byteLength,
    read: (start, end) => {
      reads.push({ start, end });
      return buffer.subarray(start, end);
    },
  });

  return {
    source,
    reads,
    clearReads: () => {
      reads.length = 0;
    },
    totalBytesRead: () => reads.reduce((sum, read) => sum + (read.end - read.start), 0),
  };
}

describe('mkv metadata io', () => {
  let buffer: Uint8Array;
  let fileSize: number;

  beforeAll(() => {
    if (!existsSync(MKV_FIXTURE)) {
      execFileSync('bash', [join(FIXTURES_DIR, 'generate.sh')], {
        cwd: FIXTURES_DIR,
        stdio: 'pipe',
      });
    }
    buffer = readFileSync(MKV_FIXTURE);
    fileSize = buffer.byteLength;
  });

  it('buildMkvKeyframeIndexFromSource reads only a small fraction of the file', async () => {
    const { source, totalBytesRead } = createTrackingSource(buffer);

    const index = await buildMkvKeyframeIndexFromSource(source);

    expect(index).not.toBeNull();
    expect(index!.keyframes.length).toBeGreaterThanOrEqual(9);
    expect(totalBytesRead()).toBeLessThan(fileSize * 0.05);
  });

  it('cue-derived timestamps stay close to mediabunny keyframe iteration', async () => {
    const { source } = createTrackingSource(buffer);
    const index = await buildMkvKeyframeIndexFromSource(source);
    expect(index).not.toBeNull();

    using input = new Input({
      formats: ALL_FORMATS,
      source: new StreamSource({
        getSize: () => buffer.byteLength,
        read: (start, end) => buffer.subarray(start, end),
      }),
    });
    const videoTrack = await input.getPrimaryVideoTrack();
    expect(videoTrack).not.toBeNull();
    const sink = new EncodedPacketSink(videoTrack!);

    const mbTimestamps: number[] = [];
    let packet: EncodedPacket | null = await sink.getKeyPacket(0, {
      metadataOnly: true,
    });
    while (packet) {
      mbTimestamps.push(packet.timestamp);
      const next = await sink.getNextKeyPacket(packet, { metadataOnly: true });
      if (!next || next.sequenceNumber === packet.sequenceNumber) break;
      packet = next;
    }

    for (const cue of index!.keyframes) {
      const closest = mbTimestamps.reduce((best, timestamp) =>
        Math.abs(timestamp - cue.timestamp) < Math.abs(best - cue.timestamp) ? timestamp : best,
      );
      expect(Math.abs(closest - cue.timestamp)).toBeLessThan(2);
    }
  });

  it('still documents the expensive metadataOnly mediabunny iteration path', async () => {
    const { source, clearReads, totalBytesRead } = createTrackingSource(buffer);

    using input = new Input({ formats: ALL_FORMATS, source });
    const videoTrack = await input.getPrimaryVideoTrack();
    expect(videoTrack).not.toBeNull();
    const sink = new EncodedPacketSink(videoTrack!);

    clearReads();

    let packet: EncodedPacket | null = await sink.getKeyPacket(0, {
      metadataOnly: true,
    });
    while (packet) {
      const next = await sink.getNextKeyPacket(packet, { metadataOnly: true });
      if (!next || next.sequenceNumber === packet.sequenceNumber) break;
      packet = next;
    }

    expect(totalBytesRead()).toBeGreaterThan(fileSize * 0.5);
  });
});
