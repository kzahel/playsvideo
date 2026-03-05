import { WasmFfmpegRunner } from './adapters/wasm-ffmpeg.js';
import { needsTranscode, transcodeAudioSegment } from './pipeline/audio-transcode.js';
import { collectPacketsInRange, demuxBlob, getKeyframeIndex } from './pipeline/demux.js';
import type { DemuxResult } from './pipeline/demux.js';
import { muxToFmp4 } from './pipeline/mux.js';
import { generateVodPlaylist } from './pipeline/playlist.js';
import { buildSegmentPlan } from './pipeline/segment-plan.js';
import type { PlannedSegment } from './pipeline/types.js';

const ffmpeg = new WasmFfmpegRunner();

let demux: DemuxResult | null = null;
let plan: PlannedSegment[] = [];
let doTranscode = false;
let audioDecoderConfig: AudioDecoderConfig | null = null;
let initSegment: Uint8Array | null = null;

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;

  try {
    if (msg.type === 'open') {
      await handleOpen(msg.file, msg.targetSegmentDuration ?? 4);
    } else if (msg.type === 'segment') {
      await handleSegment(msg.index);
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err) });
  }
};

async function handleOpen(file: File, targetSegmentDuration: number) {
  if (demux) {
    demux.dispose();
  }

  demux = await demuxBlob(file);
  const index = await getKeyframeIndex(demux.videoSink, demux.duration);

  plan = buildSegmentPlan({
    keyframeTimestampsSec: index.keyframes.map((k) => k.timestamp),
    durationSec: index.duration,
    targetSegmentDurationSec: targetSegmentDuration,
  });

  doTranscode = demux.audioCodec !== null && needsTranscode(demux.audioCodec);
  audioDecoderConfig = demux.audioDecoderConfig;
  initSegment = null;

  const playlist = generateVodPlaylist({
    targetDuration: Math.ceil(Math.max(...plan.map((s) => s.durationSec))),
    mediaSequence: 0,
    mapUri: 'init.mp4',
    entries: plan.map((s) => ({ uri: `seg-${s.sequence}.m4s`, durationSec: s.durationSec })),
    endList: true,
  });

  // Process first segment to get init segment
  initSegment = await processSegment(0);

  self.postMessage({
    type: 'ready',
    playlist,
    initData: initSegment.buffer,
    totalSegments: plan.length,
    durationSec: demux.duration,
  }, { transfer: [] }); // don't transfer initData — we need to keep it
}

async function handleSegment(index: number) {
  if (!demux || index >= plan.length) {
    self.postMessage({ type: 'error', message: `Invalid segment index: ${index}` });
    return;
  }

  // If we already processed segment 0 during open and still have initSegment,
  // we could cache it, but for simplicity just re-process
  const mediaData = await processSegment(index);
  const buffer = mediaData.buffer.slice(
    mediaData.byteOffset,
    mediaData.byteOffset + mediaData.byteLength,
  );

  self.postMessage(
    { type: 'segment', index, data: buffer },
    { transfer: [buffer] },
  );
}

async function processSegment(index: number): Promise<Uint8Array> {
  if (!demux) throw new Error('No file open');

  const seg = plan[index];
  const endSec = seg.startSec + seg.durationSec;

  const videoPackets = await collectPacketsInRange(demux.videoSink, seg.startSec, endSec, {
    startFromKeyframe: true,
  });

  let audioPackets = demux.audioSink
    ? await collectPacketsInRange(demux.audioSink, seg.startSec, endSec)
    : [];

  if (doTranscode && audioPackets.length > 0) {
    const sampleRate = demux.audioDecoderConfig?.sampleRate ?? 48000;
    const transcoded = await transcodeAudioSegment({
      packets: audioPackets,
      sampleRate,
      segmentStartSec: seg.startSec,
      ffmpeg,
    });
    audioPackets = transcoded.packets;
    if (!audioDecoderConfig || audioDecoderConfig.codec !== 'mp4a.40.2') {
      audioDecoderConfig = transcoded.decoderConfig;
    }
  }

  const muxResult = await muxToFmp4({
    videoPackets,
    audioPackets,
    videoCodec: demux.videoCodec,
    audioCodec: doTranscode ? 'aac' : (demux.audioCodec ?? 'aac'),
    videoDecoderConfig: demux.videoDecoderConfig,
    audioDecoderConfig,
  });

  if (!initSegment) {
    initSegment = muxResult.init;
  }

  // Concatenate media fragments
  const totalLen = muxResult.media.reduce((s, c) => s + c.byteLength, 0);
  const mediaData = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of muxResult.media) {
    mediaData.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return mediaData;
}
