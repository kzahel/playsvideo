import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTempDir, NodeFfmpegRunner } from '../../src/adapters/node-ffmpeg.js';
import { NodeFfprobeRunner } from '../../src/adapters/node-ffprobe.js';
import { transcodeAudioSegment } from '../../src/pipeline/audio-transcode.js';
import { audioNeedsTranscode, createNodeProber } from '../../src/pipeline/codec-probe.js';
import { collectPacketsInRange, demuxFile } from '../../src/pipeline/demux.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
let ffmpeg: NodeFfmpegRunner;
const ffprobe = new NodeFfprobeRunner();

describe('audio-transcode', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it('identifies codecs that need transcode', () => {
    const prober = createNodeProber();
    expect(audioNeedsTranscode(prober, 'ac3')).toBe(true);
    expect(audioNeedsTranscode(prober, 'eac3')).toBe(true);
    expect(audioNeedsTranscode(prober, 'flac')).toBe(true);
    expect(audioNeedsTranscode(prober, 'aac')).toBe(false);
    expect(audioNeedsTranscode(prober, 'mp3')).toBe(false);
  });

  it('transcodes AC3 packets to AAC', async () => {
    const demux = await demuxFile(join(FIXTURES_DIR, 'test-h264-ac3.mkv'));
    dispose = demux.dispose;

    expect(demux.audioCodec).toBe('ac3');
    const ac3Packets = await collectPacketsInRange(demux.audioSink!, 0, 3);
    expect(ac3Packets.length).toBeGreaterThan(0);

    const tempDir = await makeTempDir();
    ffmpeg = new NodeFfmpegRunner(tempDir);
    const result = await transcodeAudioSegment({
      packets: ac3Packets,
      sampleRate: 48000,
      audioStartSec: 0,
      ffmpeg,
    });

    expect(result.packets.length).toBeGreaterThan(0);

    // AAC frames: 1024 samples at 48kHz = ~21.3ms per frame
    // 3 seconds = ~140 frames
    expect(result.packets.length).toBeGreaterThan(100);
    expect(result.packets.length).toBeLessThan(200);

    // Timestamps should be monotonically increasing from 0
    for (let i = 1; i < result.packets.length; i++) {
      expect(result.packets[i].timestamp).toBeGreaterThan(result.packets[i - 1].timestamp);
    }

    // All packets should be keyframes (AAC)
    for (const pkt of result.packets) {
      expect(pkt.type).toBe('key');
      expect(pkt.data.byteLength).toBeGreaterThan(0);
    }

    // Verify the AAC output is decodable by writing to ADTS file
    const totalSize = result.packets.reduce((s, p) => s + p.data.byteLength, 0);
    const aacData = new Uint8Array(totalSize);
    let offset = 0;
    for (const pkt of result.packets) {
      aacData.set(pkt.data, offset);
      offset += pkt.data.byteLength;
    }
    const aacPath = join(tempDir, 'verify.aac');
    await writeFile(aacPath, aacData);

    const decodable = await ffprobe.verifyDecodable(aacPath);
    expect(decodable.ok, `AAC not decodable: ${decodable.stderr}`).toBe(true);

    // Verify transcode metrics are populated
    const m = result.metrics;
    expect(m.inputPackets).toBeGreaterThan(0);
    expect(m.inputBytes).toBeGreaterThan(0);
    expect(m.audioDurationSec).toBeGreaterThan(0);
    expect(m.totalMs).toBeGreaterThan(0);
    expect(m.ffmpegMs).toBeGreaterThan(0);
    expect(m.outputPackets).toBeGreaterThan(0);
    expect(m.outputBytes).toBeGreaterThan(0);
    expect(m.outputDurationSec).toBeGreaterThan(0);
    expect(m.realtimeRatio).toBeGreaterThan(0);
    // Phase timings should be non-negative
    expect(m.concatMs).toBeGreaterThanOrEqual(0);
    expect(m.writeMs).toBeGreaterThanOrEqual(0);
    expect(m.readMs).toBeGreaterThanOrEqual(0);
    expect(m.parseMs).toBeGreaterThanOrEqual(0);
    expect(m.cleanupMs).toBeGreaterThanOrEqual(0);
  });
});
