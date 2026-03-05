import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTempDir, NodeFfmpegRunner } from '../../src/adapters/node-ffmpeg.js';
import { NodeFfprobeRunner } from '../../src/adapters/node-ffprobe.js';
import { needsTranscode, transcodeAudioSegment } from '../../src/pipeline/audio-transcode.js';
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
    expect(needsTranscode('ac3')).toBe(true);
    expect(needsTranscode('eac3')).toBe(true);
    expect(needsTranscode('flac')).toBe(true);
    expect(needsTranscode('aac')).toBe(false);
    expect(needsTranscode('mp3')).toBe(false);
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
  });
});
