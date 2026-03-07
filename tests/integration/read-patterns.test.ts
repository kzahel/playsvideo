import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ALL_FORMATS, BufferSource, EncodedPacketSink, Input, Source } from 'mediabunny';
import { getKeyframeIndex } from '../../src/pipeline/demux.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');

/**
 * Wraps a BufferSource to intercept and record every _read() call.
 * The internal _read/_retrieveSize/_dispose methods are @internal in mediabunny's
 * typings, so we access them via `as any`.
 */
class TrackingSource extends Source {
  reads: Array<{ start: number; end: number }> = [];
  private inner: Source;

  constructor(buffer: ArrayBuffer) {
    super();
    this.inner = new BufferSource(buffer);
  }

  _retrieveSize() {
    return (this.inner as any)._retrieveSize();
  }

  _read(start: number, end: number) {
    this.reads.push({ start, end });
    return (this.inner as any)._read(start, end);
  }

  _dispose() {
    (this.inner as any)._dispose();
  }

  clearReads() {
    this.reads = [];
  }
}

describe('read patterns during keyframe index building', () => {
  let input: Input | undefined;

  afterEach(() => {
    input?.dispose();
    input = undefined;
  });

  it('MP4: getKeyframeIndex triggers zero additional reads (sample tables are in-memory)', async () => {
    const buffer = await readFile(join(FIXTURES_DIR, 'codec-h264-high.mp4'));
    const source = new TrackingSource(buffer.buffer as ArrayBuffer);

    input = new Input({ formats: ALL_FORMATS, source });

    // Phase 1: demux — parse container metadata
    const videoTrack = await input.getPrimaryVideoTrack();
    const videoSink = new EncodedPacketSink(videoTrack);
    const duration = Number(await videoTrack.computeDuration());

    // Record reads from the demux phase, then clear
    const demuxReads = [...source.reads];
    expect(demuxReads.length).toBeGreaterThan(0);
    source.clearReads();

    // Phase 2: build keyframe index with metadataOnly
    const index = await getKeyframeIndex(videoSink, duration);
    expect(index.keyframes.length).toBeGreaterThan(0);

    // For MP4, keyframe info lives in the moov atom's sample tables (stss/stco/etc.),
    // which are already parsed into memory. No additional reads needed.
    expect(source.reads).toEqual([]);
  });

  it('MKV: getKeyframeIndex triggers reads scattered across the file (cluster seeking)', async () => {
    const buffer = await readFile(join(FIXTURES_DIR, 'test-h264-ac3-10s.mkv'));
    const fileSize = buffer.byteLength;
    const source = new TrackingSource(buffer.buffer as ArrayBuffer);

    input = new Input({ formats: ALL_FORMATS, source });

    // Phase 1: demux — parse container metadata
    const videoTrack = await input.getPrimaryVideoTrack();
    const videoSink = new EncodedPacketSink(videoTrack);
    const duration = Number(await videoTrack.computeDuration());

    source.clearReads();

    // Phase 2: build keyframe index with metadataOnly
    const index = await getKeyframeIndex(videoSink, duration);
    expect(index.keyframes.length).toBeGreaterThanOrEqual(9);

    const keyframeReads = source.reads;

    // MKV with metadataOnly: true still seeks to each cluster to find keyframes,
    // producing reads scattered across the file (not just beginning/end).
    expect(keyframeReads.length).toBeGreaterThan(0);

    // Verify reads span a wide range of file offsets
    const offsets = keyframeReads.map((r) => r.start);
    const minOffset = Math.min(...offsets);
    const maxOffset = Math.max(...offsets);
    const span = maxOffset - minOffset;

    // Reads should span at least 50% of the file, proving cluster-seeking behavior
    expect(span).toBeGreaterThan(fileSize * 0.5);

    // Should have reads at many distinct positions (not just a few big reads)
    const uniqueStarts = new Set(offsets);
    expect(uniqueStarts.size).toBeGreaterThan(3);
  });
});
