import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTempDir, NodeFfmpegRunner } from '../../src/adapters/node-ffmpeg.js';
import { NodeFfprobeRunner } from '../../src/adapters/node-ffprobe.js';
import { transcodeAudioSegment } from '../../src/pipeline/audio-transcode.js';
import { audioNeedsTranscode, createNodeProber } from '../../src/pipeline/codec-probe.js';
import { collectPacketsInRange, demuxFile, getKeyframeIndex } from '../../src/pipeline/demux.js';
import { muxToFmp4 } from '../../src/pipeline/mux.js';
import { parsePlaylist } from '../../src/pipeline/playlist.js';
import { buildSegmentPlan } from '../../src/pipeline/segment-plan.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
const GOLDEN_DIR = join(import.meta.dirname, '..', 'golden', 'output');
const BIGVIDEO = join(FIXTURES_DIR, 'bigvideo.mp4');
const ffprobe = new NodeFfprobeRunner();

const hasBigVideo = existsSync(BIGVIDEO);
const hasGolden = existsSync(join(GOLDEN_DIR, 'playlist.m3u8'));
const describeIfBigVideo = hasBigVideo ? describe : describe.skip;

describeIfBigVideo('bigvideo full-file validation', () => {
  let demux: Awaited<ReturnType<typeof demuxFile>>;
  let goldenPlaylist: ReturnType<typeof parsePlaylist>;

  it('demuxes the full 2.3GB file', async () => {
    demux = await demuxFile(BIGVIDEO);

    expect(demux.videoCodec).toBe('avc');
    expect(demux.audioCodec).toBe('ac3');
    expect(demux.duration).toBeGreaterThan(5500);
    expect(demux.duration).toBeLessThan(5600);
    expect(demux.videoDecoderConfig).toBeTruthy();
    expect(demux.audioDecoderConfig).toBeTruthy();
    expect(audioNeedsTranscode(createNodeProber(), demux.audioCodec!)).toBe(true);
  });

  it('builds keyframe index across full file', async () => {
    const index = await getKeyframeIndex(demux.videoSink, demux.duration);

    // Should have many keyframes for a 93-min file
    expect(index.keyframes.length).toBeGreaterThan(500);
    expect(index.duration).toBeGreaterThan(5500);

    // First keyframe should be at or near 0
    expect(index.keyframes[0].timestamp).toBeLessThan(1);

    // Keyframes should be monotonically increasing
    for (let i = 1; i < index.keyframes.length; i++) {
      expect(index.keyframes[i].timestamp).toBeGreaterThan(index.keyframes[i - 1].timestamp);
    }

    // Last keyframe should be near the end
    const lastKf = index.keyframes[index.keyframes.length - 1];
    expect(lastKf.timestamp).toBeGreaterThan(5500);
  });

  it('segment plan is reasonable vs golden reference', async () => {
    const index = await getKeyframeIndex(demux.videoSink, demux.duration);
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: index.keyframes.map((k) => k.timestamp),
      durationSec: index.duration,
      targetSegmentDurationSec: 4,
    });

    if (!hasGolden) return;

    const goldenM3u8 = await readFile(join(GOLDEN_DIR, 'playlist.m3u8'), 'utf-8');
    goldenPlaylist = parsePlaylist(goldenM3u8);

    // Our plan should produce a similar number of segments
    // (not exact — our planner groups keyframes differently than ffmpeg)
    expect(plan.length).toBeGreaterThan(goldenPlaylist.entries.length * 0.5);
    expect(plan.length).toBeLessThan(goldenPlaylist.entries.length * 2);

    // Total duration should match closely
    const ourTotal = plan.reduce((s, p) => s + p.durationSec, 0);
    const goldenTotal = goldenPlaylist.entries.reduce((s, e) => s + e.durationSec, 0);
    expect(Math.abs(ourTotal - goldenTotal)).toBeLessThan(2);

    // No segment should be absurdly long
    for (const seg of plan) {
      expect(seg.durationSec).toBeLessThan(30);
    }
  });

  it('processes first 3 segments end-to-end', async () => {
    const index = await getKeyframeIndex(demux.videoSink, demux.duration);
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: index.keyframes.map((k) => k.timestamp),
      durationSec: index.duration,
      targetSegmentDurationSec: 4,
    });

    const tempDir = await makeTempDir();
    const outDir = join(tempDir, 'hls');
    await mkdir(outDir, { recursive: true });

    const segmentsToCheck = plan.slice(0, 3);
    let init: Uint8Array | null = null;

    for (const seg of segmentsToCheck) {
      const endSec = seg.startSec + seg.durationSec;

      const videoPackets = await collectPacketsInRange(demux.videoSink, seg.startSec, endSec, {
        startFromKeyframe: true,
      });
      let audioPackets = demux.audioSink
        ? await collectPacketsInRange(demux.audioSink, seg.startSec, endSec)
        : [];

      expect(videoPackets.length).toBeGreaterThan(0);
      expect(audioPackets.length).toBeGreaterThan(0);

      // Transcode AC3 → AAC
      const sampleRate = demux.audioDecoderConfig?.sampleRate ?? 48000;
      const ffmpeg = new NodeFfmpegRunner(tempDir);
      const transcoded = await transcodeAudioSegment({
        packets: audioPackets,
        sampleRate,
        audioStartSec: audioPackets[0].timestamp,
        ffmpeg,
      });
      audioPackets = transcoded.packets;

      // Mux to fMP4
      const muxResult = await muxToFmp4({
        videoPackets,
        audioPackets,
        videoCodec: demux.videoCodec,
        audioCodec: 'aac',
        videoDecoderConfig: demux.videoDecoderConfig,
        audioDecoderConfig: transcoded.decoderConfig,
      });

      if (!init) {
        init = muxResult.init;
        await writeFile(join(outDir, 'init.mp4'), init);
      }

      expect(muxResult.init.byteLength).toBeGreaterThan(0);
      expect(muxResult.media.length).toBeGreaterThan(0);

      // Concatenate media fragments
      const mediaSize = muxResult.media.reduce((s, m) => s + m.byteLength, 0);
      const mediaData = new Uint8Array(mediaSize);
      let offset = 0;
      for (const m of muxResult.media) {
        mediaData.set(m, offset);
        offset += m.byteLength;
      }

      // Write init+segment and verify decodable
      const combined = new Uint8Array(init!.byteLength + mediaData.byteLength);
      combined.set(init!, 0);
      combined.set(mediaData, init!.byteLength);
      const segPath = join(outDir, `verify-seg${seg.sequence}.mp4`);
      await writeFile(segPath, combined);

      const decodable = await ffprobe.verifyDecodable(segPath);
      expect(decodable.ok, `Segment ${seg.sequence} not decodable: ${decodable.stderr}`).toBe(true);

      const probe = await ffprobe.probe(segPath);
      expect(probe.streams.find((s) => s.codecType === 'video')?.codecName).toBe('h264');
      expect(probe.streams.find((s) => s.codecType === 'audio')?.codecName).toBe('aac');
    }
  });

  it('segment plan matches golden m3u8 exactly (hls_time=2)', async () => {
    if (!hasGolden) return;

    const index = await getKeyframeIndex(demux.videoSink, demux.duration);
    const kfTimestamps = index.keyframes.map((k) => k.timestamp);
    console.log(
      `Keyframe count: ${kfTimestamps.length}, first 15: ${kfTimestamps
        .slice(0, 15)
        .map((t) => t.toFixed(6))
        .join(', ')}`,
    );

    const plan = buildSegmentPlan({
      keyframeTimestampsSec: kfTimestamps,
      durationSec: index.duration,
      targetSegmentDurationSec: 2,
    });

    const goldenM3u8 = await readFile(join(GOLDEN_DIR, 'playlist.m3u8'), 'utf-8');
    const golden = parsePlaylist(goldenM3u8);

    // If counts differ, log divergence context
    if (plan.length !== golden.entries.length) {
      const minLen = Math.min(plan.length, golden.entries.length);
      let divergeAt = 0;
      for (let i = 0; i < minLen; i++) {
        if (plan[i].durationSec !== golden.entries[i].durationSec) {
          divergeAt = i;
          break;
        }
        if (i === minLen - 1) divergeAt = minLen;
      }

      const start = Math.max(0, divergeAt - 2);
      const end = Math.min(Math.max(plan.length, golden.entries.length), divergeAt + 3);
      console.log(
        `Segment count mismatch: ours=${plan.length}, golden=${golden.entries.length}. First divergence near index ${divergeAt}:`,
      );
      console.log('  idx | ourStart   | ourDur     | goldenDur  | delta');
      console.log('  ----|------------|------------|------------|------');
      for (let i = start; i < end; i++) {
        const ours = i < plan.length ? plan[i] : null;
        const gold = i < golden.entries.length ? golden.entries[i] : null;
        const ourStart = ours ? ours.startSec.toFixed(6) : '---';
        const ourDur = ours ? ours.durationSec.toFixed(6) : '---';
        const goldDur = gold ? gold.durationSec.toFixed(6) : '---';
        const delta = ours && gold ? (ours.durationSec - gold.durationSec).toFixed(6) : '---';
        console.log(
          `  ${String(i).padStart(3)} | ${ourStart.padStart(10)} | ${ourDur.padStart(10)} | ${goldDur.padStart(10)} | ${delta}`,
        );
      }
    }

    expect(plan.length, 'segment count must match golden').toBe(golden.entries.length);

    // Per-segment EXTINF comparison
    const deltas: number[] = [];
    const failures: string[] = [];
    for (let i = 0; i < plan.length; i++) {
      const delta = Math.abs(plan[i].durationSec - golden.entries[i].durationSec);
      deltas.push(delta);
      if (delta > 0) {
        failures.push(
          `seg ${i}: ours=${plan[i].durationSec.toFixed(6)}, golden=${golden.entries[i].durationSec.toFixed(6)}, diff=${delta.toFixed(6)}`,
        );
      }
    }

    // Log per-segment diffs
    for (let i = 0; i < deltas.length; i++) {
      if (deltas[i] > 0) {
        console.log(
          `seg ${i}: dur diff=${deltas[i].toFixed(6)} (ours=${plan[i].durationSec.toFixed(6)}, golden=${golden.entries[i].durationSec.toFixed(6)})`,
        );
      }
    }

    // Summary stats
    const maxDelta = Math.max(...deltas);
    const meanDelta = deltas.reduce((s, d) => s + d, 0) / deltas.length;
    const overThreshold = deltas.filter((d) => d > 0.001).length;
    console.log(
      `Duration delta stats: max=${maxDelta.toFixed(6)}, mean=${meanDelta.toFixed(6)}, segments with delta>0.001s: ${overThreshold}/${deltas.length}`,
    );

    // Total duration comparison
    const ourTotal = plan.reduce((s, p) => s + p.durationSec, 0);
    const goldenTotal = golden.entries.reduce((s, e) => s + e.durationSec, 0);
    console.log(
      `Total duration: ours=${ourTotal.toFixed(6)}, golden=${goldenTotal.toFixed(6)}, diff=${Math.abs(ourTotal - goldenTotal).toFixed(6)}`,
    );

    if (failures.length) {
      console.log(`${failures.length} segments have non-zero diff:\n${failures.join('\n')}`);
    }
    expect(failures, 'all segment durations must exactly match golden').toHaveLength(0);
  });

  it('golden reference segments are decodable (spot check)', async () => {
    if (!hasGolden) return;

    // Spot-check a few golden segments: first, middle, last
    const goldenM3u8 = await readFile(join(GOLDEN_DIR, 'playlist.m3u8'), 'utf-8');
    const golden = parsePlaylist(goldenM3u8);
    const initData = await readFile(join(GOLDEN_DIR, 'init.mp4'));
    const tempDir = await makeTempDir();

    const indices = [0, Math.floor(golden.entries.length / 2), golden.entries.length - 1];

    for (const idx of indices) {
      const entry = golden.entries[idx];
      const segData = await readFile(join(GOLDEN_DIR, entry.uri));

      // Combine init + segment for ffprobe verification
      const combined = new Uint8Array(initData.byteLength + segData.byteLength);
      combined.set(new Uint8Array(initData.buffer, initData.byteOffset, initData.byteLength), 0);
      combined.set(
        new Uint8Array(segData.buffer, segData.byteOffset, segData.byteLength),
        initData.byteLength,
      );

      const verifyPath = join(tempDir, `golden-verify-${idx}.mp4`);
      await writeFile(verifyPath, combined);

      const decodable = await ffprobe.verifyDecodable(verifyPath);
      expect(
        decodable.ok,
        `Golden seg ${idx} (${entry.uri}) not decodable: ${decodable.stderr}`,
      ).toBe(true);

      const probe = await ffprobe.probe(verifyPath);
      expect(probe.streams.find((s) => s.codecType === 'video')?.codecName).toBe('h264');
      expect(probe.streams.find((s) => s.codecType === 'audio')?.codecName).toBe('aac');
      expect(probe.duration).toBeGreaterThan(0);
    }
  });

  it('cleanup', () => {
    if (demux) demux.dispose();
  });
});
