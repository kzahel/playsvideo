import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPacketsInRange, demuxFile, getKeyframeIndex } from '../../src/pipeline/demux.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');

describe('demux', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it('opens an MP4 and identifies video+audio tracks', async () => {
    const result = await demuxFile(join(FIXTURES_DIR, 'test-h264-aac.mp4'));
    dispose = result.dispose;

    expect(result.videoCodec).toBe('avc');
    expect(result.audioCodec).toBe('aac');
    expect(result.duration).toBeGreaterThan(2);
    expect(result.duration).toBeLessThan(5);
    expect(result.videoTrack).toBeTruthy();
    expect(result.audioTrack).toBeTruthy();
    expect(result.videoSink).toBeTruthy();
    expect(result.audioSink).toBeTruthy();
  });

  it('opens an MKV with AC3 audio', async () => {
    const result = await demuxFile(join(FIXTURES_DIR, 'test-h264-ac3.mkv'));
    dispose = result.dispose;

    expect(result.videoCodec).toBe('avc');
    expect(result.audioCodec).toBe('ac3');
  });

  it('extracts keyframe index', async () => {
    const result = await demuxFile(join(FIXTURES_DIR, 'test-h264-ac3-10s.mkv'));
    dispose = result.dispose;

    const index = await getKeyframeIndex(result.videoSink, result.duration);

    expect(index.keyframes.length).toBeGreaterThan(0);
    expect(index.keyframes[0].timestamp).toBeCloseTo(0, 1);
    expect(index.duration).toBeGreaterThan(9);

    // With -g 30 at 30fps, expect keyframe every 1s
    expect(index.keyframes.length).toBeGreaterThanOrEqual(9);
  });

  it('collects video packets for a time range', async () => {
    const result = await demuxFile(join(FIXTURES_DIR, 'test-h264-ac3-10s.mkv'));
    dispose = result.dispose;

    const packets = await collectPacketsInRange(result.videoSink, 0, 3);

    expect(packets.length).toBeGreaterThan(0);
    // At 30fps, 3 seconds = ~90 frames
    expect(packets.length).toBeGreaterThan(50);
    expect(packets.length).toBeLessThan(150);

    // First packet should be near time 0
    expect(packets[0].timestamp).toBeLessThan(0.5);

    // All packets should have data
    for (const pkt of packets) {
      expect(pkt.data.byteLength).toBeGreaterThan(0);
    }
  });

  it('collects audio packets for a time range', async () => {
    const result = await demuxFile(join(FIXTURES_DIR, 'test-h264-ac3-10s.mkv'));
    dispose = result.dispose;

    const packets = await collectPacketsInRange(result.audioSink!, 0, 3);

    expect(packets.length).toBeGreaterThan(0);
    // AC3 at 48kHz with 1536 samples/frame = ~93 frames for 3s
    expect(packets.length).toBeGreaterThan(50);

    for (const pkt of packets) {
      expect(pkt.data.byteLength).toBeGreaterThan(0);
    }
  });
});
