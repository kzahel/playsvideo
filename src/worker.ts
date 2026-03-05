import { WasmFfmpegRunner } from './adapters/wasm-ffmpeg.js';
import { needsTranscode, transcodeAudioSegment } from './pipeline/audio-transcode.js';
import type { DemuxResult } from './pipeline/demux.js';
import { collectPacketsInRange, demuxBlob, getKeyframeIndex } from './pipeline/demux.js';
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
const segmentCache = new Map<number, Uint8Array>();

// Serialize segment processing — concurrent ffmpeg.wasm calls corrupt shared MEMFS files
let processingChain: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent) => {
  const msg = event.data;

  if (msg.type === 'open') {
    processingChain = handleOpen(msg.file, msg.targetSegmentDuration ?? 4).catch((err) =>
      self.postMessage({ type: 'error', message: String(err) }),
    );
  } else if (msg.type === 'segment') {
    processingChain = processingChain.then(() => handleSegment(msg.index)).catch((err) =>
      self.postMessage({ type: 'error', message: String(err) }),
    );
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

  // Process first segment to extract init segment (ftyp+moov) as a side effect, cache media data
  segmentCache.set(0, await processSegment(0));

  self.postMessage(
    {
      type: 'ready',
      playlist,
      initData: initSegment!.buffer,
      totalSegments: plan.length,
      durationSec: demux.duration,
    },
    { transfer: [] },
  ); // don't transfer initData — we need to keep it
}

async function handleSegment(index: number) {
  if (!demux || index >= plan.length) {
    self.postMessage({ type: 'error', message: `Invalid segment index: ${index}` });
    return;
  }

  // Return cached segment if available (segment 0 is pre-processed during open)
  const cached = segmentCache.get(index);
  if (cached) {
    segmentCache.delete(index);
    const buffer = cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength);
    self.postMessage({ type: 'segment', index, data: buffer }, { transfer: [buffer] });
    return;
  }

  const mediaData = await processSegment(index);
  const buffer = mediaData.buffer.slice(
    mediaData.byteOffset,
    mediaData.byteOffset + mediaData.byteLength,
  );

  self.postMessage({ type: 'segment', index, data: buffer }, { transfer: [buffer] });
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
      audioStartSec: audioPackets[0].timestamp,
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
