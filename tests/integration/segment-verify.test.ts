/**
 * Extracts segments from our pipeline, writes them to disk, and compares
 * frame counts + timestamps against golden reference segments using ffprobe.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  EncodedAudioPacketSource,
  EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  NullTarget,
  Output,
} from 'mediabunny';
import { describe, expect, it } from 'vitest';
import { makeTempDir, NodeFfmpegRunner } from '../../src/adapters/node-ffmpeg.js';
import { transcodeAudioSegment } from '../../src/pipeline/audio-transcode.js';
import { audioNeedsTranscode, createNodeProber } from '../../src/pipeline/codec-probe.js';
import { collectPacketsInRange, demuxFile, getKeyframeIndex } from '../../src/pipeline/demux.js';
import { muxToFmp4 } from '../../src/pipeline/mux.js';
import { buildSegmentPlan } from '../../src/pipeline/segment-plan.js';

const execFileAsync = promisify(execFile);

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
const GOLDEN_DIR = join(import.meta.dirname, '..', 'golden', 'output');
const BIGVIDEO = join(FIXTURES_DIR, 'bigvideo.mp4');
const OUT_DIR = join(import.meta.dirname, '..', 'tmp', 'segment-verify');

const hasBigVideo = existsSync(BIGVIDEO);
const hasGolden = existsSync(join(GOLDEN_DIR, 'playlist.m3u8'));
const describeIf = hasBigVideo && hasGolden ? describe : describe.skip;

interface FrameInfo {
  pts_time: number;
  duration_time: number;
  flags: string; // 'K' for keyframe
}

async function getVideoFrames(mp4Path: string): Promise<FrameInfo[]> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_packets',
    '-show_entries',
    'packet=pts_time,duration_time,flags',
    '-of',
    'json',
    mp4Path,
  ]);
  const data = JSON.parse(stdout);
  return (data.packets || []).map((p: any) => ({
    pts_time: parseFloat(p.pts_time),
    duration_time: parseFloat(p.duration_time),
    flags: p.flags,
  }));
}

const SEGMENTS_TO_CHECK = [0, 1, 2, 3, 4, 5, 6, 7, 8];

describeIf('segment verification vs golden', () => {
  let demux: Awaited<ReturnType<typeof demuxFile>>;
  let plan: ReturnType<typeof buildSegmentPlan>;
  let initSegment: Uint8Array;
  let ffmpeg: NodeFfmpegRunner;

  it('setup: demux and build plan', async () => {
    await mkdir(OUT_DIR, { recursive: true });
    const tmpDir = await makeTempDir('segment-verify-');
    ffmpeg = new NodeFfmpegRunner(tmpDir);

    demux = await demuxFile(BIGVIDEO);
    const index = await getKeyframeIndex(demux.videoSink, demux.duration);

    plan = buildSegmentPlan({
      keyframeTimestampsSec: index.keyframes.map((k) => k.timestamp),
      durationSec: index.duration,
      targetSegmentDurationSec: 2,
    });

    console.log(`Plan: ${plan.length} segments, duration=${index.duration.toFixed(1)}s`);
    expect(plan.length).toBeGreaterThan(0);
  }, 30_000);

  it('dump first 20 raw packet timestamps from mediabunny', async () => {
    // Check what mediabunny returns for PTS — are they monotonic (wrong) or reordered (correct B-frame PTS)?
    let pkt = await demux.videoSink.getKeyPacket(0);
    console.log('First 20 packets from getNextPacket (decode order):');
    console.log('  idx | seqNo | timestamp    | duration     | type  | size');
    console.log('  ----|-------|-------------|-------------|-------|------');
    for (let i = 0; i < 20 && pkt; i++) {
      console.log(
        `  ${String(i).padStart(3)} | ${String(pkt.sequenceNumber).padStart(5)} | ${pkt.timestamp.toFixed(6).padStart(11)} | ${pkt.duration.toFixed(6).padStart(11)} | ${pkt.type.padStart(5)} | ${pkt.data.byteLength}`,
      );
      const next = await demux.videoSink.getNextPacket(pkt);
      if (!next || next.sequenceNumber === pkt.sequenceNumber) break;
      pkt = next;
    }

    // Source file reference (from ffprobe):
    // Sample 0: PTS=0.000000, DTS=-0.083417, size=1197, K
    // Sample 1: PTS=0.166833, DTS=-0.041708, size=81
    // Sample 2: PTS=0.083417, DTS=0.000000, size=79
    // Sample 3: PTS=0.041708, DTS=0.041708, size=79
    // If mediabunny returns monotonic timestamps, it's giving DTS not PTS
    // If non-monotonic, it's giving correct PTS (needed for CTS in fMP4)
  });

  it('check collectPacketsInRange PTS monotonicity for segment 0', async () => {
    const seg = plan[0];
    const endSec = seg.startSec + seg.durationSec;
    const videoPackets = await collectPacketsInRange(demux.videoSink, seg.startSec, endSec, {
      startFromKeyframe: true,
    });

    console.log(
      `\nSegment 0: [${seg.startSec.toFixed(3)}, ${endSec.toFixed(3)}), ${videoPackets.length} video packets`,
    );
    console.log('First 20 packet timestamps from collectPacketsInRange:');

    let isMonotonic = true;
    let prevTs = -Infinity;
    for (let i = 0; i < Math.min(20, videoPackets.length); i++) {
      const pkt = videoPackets[i];
      const mono = pkt.timestamp >= prevTs ? '' : ' (NON-MONOTONIC)';
      if (pkt.timestamp < prevTs) isMonotonic = false;
      console.log(
        `  [${i}] seq=${pkt.sequenceNumber} ts=${pkt.timestamp.toFixed(6)} dur=${pkt.duration.toFixed(6)} type=${pkt.type}${mono}`,
      );
      prevTs = pkt.timestamp;
    }

    // Check ALL packets for monotonicity
    prevTs = -Infinity;
    for (const pkt of videoPackets) {
      if (pkt.timestamp < prevTs) {
        isMonotonic = false;
        break;
      }
      prevTs = pkt.timestamp;
    }

    console.log(
      `\nPackets are ${isMonotonic ? 'MONOTONIC (BUG: B-frame PTS should be non-monotonic!)' : 'NON-MONOTONIC (correct for B-frames)'}`,
    );

    // For B-frame content, PTS MUST be non-monotonic in decode order
    expect(isMonotonic, 'B-frame PTS should be non-monotonic in decode order').toBe(false);
  }, 30_000);

  it('extract and compare segments', async () => {
    const doTranscode =
      demux.audioCodec !== null && audioNeedsTranscode(createNodeProber(), demux.audioCodec);
    let audioDecoderConfig = demux.audioDecoderConfig;

    for (const idx of SEGMENTS_TO_CHECK) {
      const seg = plan[idx];
      const endSec = seg.startSec + seg.durationSec;

      console.log(`\n=== Segment ${idx}: [${seg.startSec.toFixed(3)}, ${endSec.toFixed(3)}) ===`);

      // Collect packets
      const videoPackets = await collectPacketsInRange(demux.videoSink, seg.startSec, endSec, {
        startFromKeyframe: true,
      });

      let audioPackets = demux.audioSink
        ? await collectPacketsInRange(demux.audioSink, seg.startSec, endSec)
        : [];

      console.log(
        `  Collected: ${videoPackets.length} video, ${audioPackets.length} audio packets`,
      );

      // Log first/last video packet details
      if (videoPackets.length > 0) {
        const first = videoPackets[0];
        const last = videoPackets[videoPackets.length - 1];
        console.log(
          `  Video first: ts=${first.timestamp.toFixed(6)} dur=${first.duration.toFixed(6)} key=${first.isKeyFrame} seq=${first.sequenceNumber} size=${first.data.byteLength}`,
        );
        console.log(
          `  Video last:  ts=${last.timestamp.toFixed(6)} dur=${last.duration.toFixed(6)} key=${last.isKeyFrame} seq=${last.sequenceNumber} size=${last.data.byteLength}`,
        );
      }

      // Transcode audio if needed
      if (doTranscode && audioPackets.length > 0) {
        const sampleRate = demux.audioDecoderConfig?.sampleRate ?? 48000;
        const transcoded = await transcodeAudioSegment({
          packets: audioPackets,
          sampleRate,
          audioStartSec: audioPackets[0].timestamp,
          ffmpeg,
        });
        audioPackets = transcoded.packets;
        if (!audioDecoderConfig || audioDecoderConfig.codec !== 'mp4a.40.2') {
          audioDecoderConfig = transcoded.decoderConfig;
        }
      }

      // Mux to fMP4
      const muxResult = await muxToFmp4({
        videoPackets,
        audioPackets,
        videoCodec: demux.videoCodec,
        audioCodec: doTranscode ? 'aac' : (demux.audioCodec ?? 'aac'),
        videoDecoderConfig: demux.videoDecoderConfig,
        audioDecoderConfig,
      });

      // Save init segment (once)
      if (idx === SEGMENTS_TO_CHECK[0]) {
        initSegment = muxResult.init;
        await writeFile(join(OUT_DIR, 'init.mp4'), initSegment);
        console.log(`  Init segment: ${initSegment.byteLength} bytes`);
      }

      // Save media segment
      const totalLen = muxResult.media.reduce((s, c) => s + c.byteLength, 0);
      const mediaData = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of muxResult.media) {
        mediaData.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const segFile = join(OUT_DIR, `seg-${String(idx).padStart(3, '0')}.m4s`);
      await writeFile(segFile, mediaData);

      // Create combined file for ffprobe (init + segment)
      const combined = new Uint8Array(initSegment!.byteLength + mediaData.byteLength);
      combined.set(initSegment!);
      combined.set(mediaData, initSegment!.byteLength);
      const ourCombined = join(OUT_DIR, `combined-${idx}.mp4`);
      await writeFile(ourCombined, combined);

      // Create golden combined file
      const goldenInit = await readFile(join(GOLDEN_DIR, 'init.mp4'));
      const goldenSeg = await readFile(join(GOLDEN_DIR, `seg-${String(idx).padStart(3, '0')}.m4s`));
      const goldenCombined = join(OUT_DIR, `golden-${idx}.mp4`);
      const goldenBuf = Buffer.concat([goldenInit, goldenSeg]);
      await writeFile(goldenCombined, goldenBuf);

      // ffprobe both
      const [ourFrames, goldenFrames] = await Promise.all([
        getVideoFrames(ourCombined),
        getVideoFrames(goldenCombined),
      ]);

      console.log(`  Our frames:    ${ourFrames.length}`);
      console.log(`  Golden frames: ${goldenFrames.length}`);

      if (ourFrames.length !== goldenFrames.length) {
        console.log(
          `  ** FRAME COUNT MISMATCH: ours=${ourFrames.length} golden=${goldenFrames.length} diff=${ourFrames.length - goldenFrames.length}`,
        );
      }

      // Compare first few frames' timestamps
      const compareCount = Math.min(5, ourFrames.length, goldenFrames.length);
      console.log(`  First ${compareCount} frames comparison (pts_time / duration_time / flags):`);
      for (let i = 0; i < compareCount; i++) {
        const o = ourFrames[i];
        const g = goldenFrames[i];
        const ptsDiff = Math.abs(o.pts_time - g.pts_time);
        const durDiff = Math.abs(o.duration_time - g.duration_time);
        const match = ptsDiff < 0.001 && durDiff < 0.001 ? 'OK' : '** MISMATCH **';
        console.log(
          `    [${i}] ours: pts=${o.pts_time.toFixed(6)} dur=${o.duration_time.toFixed(6)} ${o.flags}  |  golden: pts=${g.pts_time.toFixed(6)} dur=${g.duration_time.toFixed(6)} ${g.flags}  ${match}`,
        );
      }

      // Check last frame too
      if (ourFrames.length > 5 && goldenFrames.length > 5) {
        const oi = ourFrames.length - 1;
        const gi = goldenFrames.length - 1;
        const o = ourFrames[oi];
        const g = goldenFrames[gi];
        console.log(
          `    [last] ours[${oi}]: pts=${o.pts_time.toFixed(6)} dur=${o.duration_time.toFixed(6)} ${o.flags}  |  golden[${gi}]: pts=${g.pts_time.toFixed(6)} dur=${g.duration_time.toFixed(6)} ${g.flags}`,
        );
      }

      // Check our frame durations for consistency
      if (ourFrames.length > 1) {
        const durs = new Set(ourFrames.map((f) => f.duration_time.toFixed(6)));
        console.log(`  Our unique frame durations: ${[...durs].join(', ')}`);
      }

      // Assert frame count matches
      expect(ourFrames.length, `seg ${idx} frame count`).toBe(goldenFrames.length);
    }
  }, 120_000);
});

/**
 * Mux real demuxed video packets (video-only, no audio) and check CTS in output.
 * This isolates whether the CTS bug is in the muxer or the audio interleaving.
 */
describe('CTS offset diagnosis', () => {
  it('mux segment 0 video-only and check PTS/DTS/CTS', async () => {
    if (!hasBigVideo) return;

    const OUT = join(import.meta.dirname, '..', 'tmp', 'cts-repro');
    await mkdir(OUT, { recursive: true });

    const d = await demuxFile(BIGVIDEO);
    const index = await getKeyframeIndex(d.videoSink, d.duration);
    const p = buildSegmentPlan({
      keyframeTimestampsSec: index.keyframes.map((k) => k.timestamp),
      durationSec: index.duration,
      targetSegmentDurationSec: 2,
    });

    const seg = p[0];
    const endSec = seg.startSec + seg.durationSec;
    const videoPackets = await collectPacketsInRange(d.videoSink, seg.startSec, endSec, {
      startFromKeyframe: true,
    });

    console.log(
      `Segment 0: ${videoPackets.length} video packets, [${seg.startSec.toFixed(3)}, ${endSec.toFixed(3)})`,
    );

    // 1. Mux with audio (as normal pipeline does)
    const audioPackets = d.audioSink
      ? await collectPacketsInRange(d.audioSink, seg.startSec, endSec)
      : [];

    const doTranscode =
      d.audioCodec !== null && audioNeedsTranscode(createNodeProber(), d.audioCodec);
    let transcodedAudio = audioPackets;
    let audioDecoderConfig = d.audioDecoderConfig;

    if (doTranscode && audioPackets.length > 0) {
      const tmpDir = await makeTempDir('cts-diag-');
      const ffmpeg = new NodeFfmpegRunner(tmpDir);
      const result = await transcodeAudioSegment({
        packets: audioPackets,
        sampleRate: d.audioDecoderConfig?.sampleRate ?? 48000,
        audioStartSec: audioPackets[0].timestamp,
        ffmpeg,
      });
      transcodedAudio = result.packets;
      audioDecoderConfig = result.decoderConfig;
    }

    console.log('=== WITH-AUDIO MUX START ===');
    const withAudio = await muxToFmp4({
      videoPackets,
      audioPackets: transcodedAudio,
      videoCodec: d.videoCodec,
      audioCodec: doTranscode ? 'aac' : (d.audioCodec ?? 'aac'),
      videoDecoderConfig: d.videoDecoderConfig,
      audioDecoderConfig,
    });

    console.log('=== WITH-AUDIO MUX DONE ===');

    // 2. Also mux video-only (no audio track at all)
    console.log('=== VIDEO-ONLY MUX START ===');
    const initPartsVO: Uint8Array[] = [];
    const moofMdatVO: Uint8Array[][] = [];
    let curPairVO: Uint8Array[] = [];

    const outputVO = new Output({
      format: new Mp4OutputFormat({
        fastStart: 'fragmented',
        minimumFragmentDuration: 0,
        onFtyp: (d: Uint8Array) => initPartsVO.push(new Uint8Array(d)),
        onMoov: (d: Uint8Array) => initPartsVO.push(new Uint8Array(d)),
        onMoof: (d: Uint8Array) => {
          curPairVO = [new Uint8Array(d)];
          moofMdatVO.push(curPairVO);
        },
        onMdat: (d: Uint8Array) => curPairVO.push(new Uint8Array(d)),
      }),
      target: new NullTarget(),
    });

    const videoSourceVO = new EncodedVideoPacketSource(d.videoCodec as 'avc');
    outputVO.addVideoTrack(videoSourceVO);
    await outputVO.start();

    const videoMetaVO: EncodedVideoChunkMetadata = { decoderConfig: d.videoDecoderConfig };
    for (let i = 0; i < videoPackets.length; i++) {
      await videoSourceVO.add(videoPackets[i], i === 0 ? videoMetaVO : undefined);
    }
    await outputVO.finalize();

    // Write both and ffprobe
    for (const [label, init, media] of [
      ['with-audio', withAudio.init, withAudio.media],
      ['video-only', concatAll(initPartsVO), moofMdatVO.map((p) => concatAll(p))],
    ] as [string, Uint8Array, Uint8Array[]][]) {
      const allMedia = concatAll(media);
      const combined = concatAll([init, allMedia]);
      const outFile = join(OUT, `${label}.mp4`);
      await writeFile(outFile, combined);

      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_packets',
        '-show_entries',
        'packet=pts_time,dts_time,duration_time,flags',
        '-of',
        'json',
        outFile,
      ]);
      const pkts = (JSON.parse(stdout).packets || []).slice(0, 10);

      console.log(`\n${label} — first 10 video frames from ffprobe:`);
      let allCtsZero = true;
      for (const p of pkts) {
        const pts = parseFloat(p.pts_time);
        const dts = parseFloat(p.dts_time);
        const cts = pts - dts;
        console.log(
          `  PTS=${pts.toFixed(6)} DTS=${dts.toFixed(6)} CTS=${cts.toFixed(6)} ${p.flags}`,
        );
        if (Math.abs(cts) > 0.0001) allCtsZero = false;
      }
      console.log(`  All CTS zero: ${allCtsZero}`);
    }

    d.dispose();
  }, 60_000);
});

function concatAll(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.byteLength, 0);
  const result = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    result.set(a, off);
    off += a.byteLength;
  }
  return result;
}
