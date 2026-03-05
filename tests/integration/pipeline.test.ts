import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDir, NodeFfmpegRunner } from '../../src/adapters/node-ffmpeg.js';
import { NodeFfprobeRunner } from '../../src/adapters/node-ffprobe.js';
import { runPipeline } from '../../src/pipeline/pipeline.js';
import { parsePlaylist } from '../../src/pipeline/playlist.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
const ffprobe = new NodeFfprobeRunner();

describe('pipeline', () => {
  it('processes h264+aac MP4 (no transcode needed)', async () => {
    const tempDir = await makeTempDir();
    const result = await runPipeline({
      filePath: join(FIXTURES_DIR, 'test-h264-aac.mp4'),
      ffmpeg: new NodeFfmpegRunner(tempDir),
      targetSegmentDuration: 4,
    });

    expect(result.init.byteLength).toBeGreaterThan(0);
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.totalDurationSec).toBeGreaterThan(2);

    // Playlist should be valid
    const parsed = parsePlaylist(result.playlist);
    expect(parsed.mapUri).toBe('init.mp4');
    expect(parsed.endList).toBe(true);
    expect(parsed.entries.length).toBe(result.segments.length);

    // Write and verify first segment
    const outDir = join(tempDir, 'hls');
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'init.mp4'), result.init);

    const seg = result.segments[0];
    const combined = new Uint8Array(result.init.byteLength + seg.data.byteLength);
    combined.set(result.init, 0);
    combined.set(seg.data, result.init.byteLength);
    const segPath = join(outDir, 'verify.mp4');
    await writeFile(segPath, combined);

    const decodable = await ffprobe.verifyDecodable(segPath);
    expect(decodable.ok, `Segment not decodable: ${decodable.stderr}`).toBe(true);

    const probe = await ffprobe.probe(segPath);
    expect(probe.streams.find((s) => s.codecType === 'video')?.codecName).toBe('h264');
    expect(probe.streams.find((s) => s.codecType === 'audio')?.codecName).toBe('aac');
  });

  it('processes h264+ac3 MKV (transcode needed)', async () => {
    const tempDir = await makeTempDir();
    const result = await runPipeline({
      filePath: join(FIXTURES_DIR, 'test-h264-ac3.mkv'),
      ffmpeg: new NodeFfmpegRunner(tempDir),
      targetSegmentDuration: 4,
    });

    expect(result.init.byteLength).toBeGreaterThan(0);
    expect(result.segments.length).toBeGreaterThan(0);

    // Write and verify first segment
    const seg = result.segments[0];
    const combined = new Uint8Array(result.init.byteLength + seg.data.byteLength);
    combined.set(result.init, 0);
    combined.set(seg.data, result.init.byteLength);
    const segPath = join(tempDir, 'verify.mp4');
    await writeFile(segPath, combined);

    const decodable = await ffprobe.verifyDecodable(segPath);
    expect(decodable.ok, `Segment not decodable: ${decodable.stderr}`).toBe(true);

    // Audio should be AAC (transcoded from AC3)
    const probe = await ffprobe.probe(segPath);
    expect(probe.streams.find((s) => s.codecType === 'video')?.codecName).toBe('h264');
    expect(probe.streams.find((s) => s.codecType === 'audio')?.codecName).toBe('aac');
  });

  it('processes 10s MKV with multiple segments', async () => {
    const tempDir = await makeTempDir();
    const result = await runPipeline({
      filePath: join(FIXTURES_DIR, 'test-h264-ac3-10s.mkv'),
      ffmpeg: new NodeFfmpegRunner(tempDir),
      targetSegmentDuration: 4,
    });

    // Should produce multiple segments
    expect(result.segments.length).toBeGreaterThanOrEqual(2);

    // Total planned duration should be close to 10s
    const totalPlannedDuration = result.segments.reduce((sum, s) => sum + s.durationSec, 0);
    expect(totalPlannedDuration).toBeGreaterThan(8);
    expect(totalPlannedDuration).toBeLessThan(12);

    // Verify each segment is decodable
    for (const seg of result.segments) {
      const combined = new Uint8Array(result.init.byteLength + seg.data.byteLength);
      combined.set(result.init, 0);
      combined.set(seg.data, result.init.byteLength);
      const segPath = join(tempDir, `verify-${seg.index}.mp4`);
      await writeFile(segPath, combined);

      const decodable = await ffprobe.verifyDecodable(segPath);
      expect(decodable.ok, `Segment ${seg.index} not decodable: ${decodable.stderr}`).toBe(true);
    }

    // Write full HLS output and verify playlist is playable
    const outDir = join(tempDir, 'hls');
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, 'init.mp4'), result.init);
    for (const seg of result.segments) {
      await writeFile(join(outDir, `seg-${seg.index}.m4s`), seg.data);
    }
    await writeFile(join(outDir, 'playlist.m3u8'), result.playlist);

    const playable = await ffprobe.verifyDecodable(join(outDir, 'playlist.m3u8'));
    expect(playable.ok, `Playlist not playable: ${playable.stderr}`).toBe(true);
  });
});
