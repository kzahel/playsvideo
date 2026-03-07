import { WasmFfmpegRunner } from './adapters/wasm-ffmpeg.js';
import { audioNeedsTranscode, createBrowserProber } from './pipeline/codec-probe.js';
import type { DemuxResult } from './pipeline/demux.js';
import { demuxBlob, demuxUrl, getKeyframeIndex } from './pipeline/demux.js';
import { generateVodPlaylist } from './pipeline/playlist.js';
import { buildSegmentPlan } from './pipeline/segment-plan.js';
import { processSegmentWithAbort } from './pipeline/segment-processor.js';
import { extractSubtitleData, subtitleDataToWebVTT } from './pipeline/subtitle.js';
import type { KeyframeIndex, PlannedSegment } from './pipeline/types.js';

function wlog(msg: string) {
  console.log(`[worker] ${msg}`);
}

function elapsed(start: number): string {
  return `${(performance.now() - start).toFixed(1)}ms`;
}

const ffmpeg = new WasmFfmpegRunner();
const codecProber = createBrowserProber();

let demux: DemuxResult | null = null;
let plan: PlannedSegment[] = [];
let doTranscode = false;
let audioDecoderConfig: AudioDecoderConfig | null = null;
let initSegment: Uint8Array | null = null;
const segmentCache = new Map<number, Uint8Array>();
let targetSegDuration = 4;

// Serialize segment processing — concurrent ffmpeg.wasm calls corrupt shared MEMFS files
let processingChain: Promise<void> = Promise.resolve();

// Per-segment abort controllers for cancellation
const segmentAbortControllers = new Map<number, AbortController>();

self.onmessage = (event: MessageEvent) => {
  const msg = event.data;

  if (msg.type === 'open') {
    wlog('recv open');
    targetSegDuration = msg.targetSegmentDuration ?? 4;
    processingChain = handleProbe(() => demuxBlob(msg.file)).catch((err) =>
      self.postMessage({ type: 'error', message: String(err) }),
    );
  } else if (msg.type === 'open-url') {
    wlog('recv open-url');
    targetSegDuration = msg.targetSegmentDuration ?? 4;
    processingChain = handleProbe(() => demuxUrl(msg.url)).catch((err) =>
      self.postMessage({ type: 'error', message: String(err) }),
    );
  } else if (msg.type === 'remux-pipeline') {
    wlog('recv remux-pipeline');
    processingChain = processingChain
      .then(() => handleRemuxPipeline(msg.keyframeIndex))
      .catch((err) => self.postMessage({ type: 'error', message: String(err) }));
  } else if (msg.type === 'passthrough-pipeline') {
    wlog('recv passthrough-pipeline — subtitle-only mode');
  } else if (msg.type === 'segment') {
    wlog(`recv segment idx=${msg.index}`);
    processingChain = processingChain
      .then(() => handleSegment(msg.index))
      .catch((err) => self.postMessage({ type: 'error', message: String(err) }));
  } else if (msg.type === 'cancel') {
    const controller = segmentAbortControllers.get(msg.index);
    if (controller) {
      wlog(`cancel segment idx=${msg.index}`);
      controller.abort();
      segmentAbortControllers.delete(msg.index);
    }
  } else if (msg.type === 'subtitle') {
    wlog(`recv subtitle trackIndex=${msg.trackIndex}`);
    handleSubtitle(msg.trackIndex).catch((err) =>
      self.postMessage({ type: 'error', message: String(err) }),
    );
  }
};

/** Phase 1: demux and send codec info to engine for passthrough decision. */
async function handleProbe(demuxFn: () => Promise<DemuxResult>) {
  if (demux) {
    demux.dispose();
  }

  const tDemux = performance.now();
  demux = await demuxFn();
  wlog(
    `demux done ${elapsed(tDemux)} codec=${demux.videoCodec}/${demux.audioCodec} dur=${demux.duration.toFixed(1)}s`,
  );

  // Send codec info so engine can check canPlayType on the main thread
  self.postMessage({
    type: 'probed',
    videoCodec: demux.videoDecoderConfig.codec,
    audioCodec: demux.audioDecoderConfig?.codec ?? null,
    durationSec: demux.duration,
    subtitleTracks: demux.subtitleTracks,
  });
}

/** Phase 2: full pipeline — engine told us native playback isn't possible. */
async function handleRemuxPipeline(prebuiltKeyframeIndex?: KeyframeIndex) {
  if (!demux) throw new Error('No demux — handleProbe must run first');
  const t0 = performance.now();

  let index: KeyframeIndex;
  if (prebuiltKeyframeIndex) {
    index = prebuiltKeyframeIndex;
    wlog(`keyframe-index pre-built keyframes=${index.keyframes.length}`);
  } else {
    const tIndex = performance.now();
    index = await getKeyframeIndex(demux.videoSink, demux.duration);
    wlog(`keyframe-index done ${elapsed(tIndex)} keyframes=${index.keyframes.length}`);
  }

  const tPlan = performance.now();
  plan = buildSegmentPlan({
    keyframeTimestampsSec: index.keyframes.map((k) => k.timestamp),
    durationSec: index.duration,
    targetSegmentDurationSec: targetSegDuration,
  });
  wlog(`segment-plan done ${elapsed(tPlan)} segments=${plan.length}`);

  doTranscode =
    demux.audioCodec !== null &&
    audioNeedsTranscode(codecProber, demux.audioCodec, demux.audioDecoderConfig?.codec);
  if (doTranscode && demux.audioCodec) {
    await ffmpeg.loadForCodec(demux.audioCodec);
  }
  audioDecoderConfig = demux.audioDecoderConfig;
  initSegment = null;

  const playlist = generateVodPlaylist({
    targetDuration: Math.ceil(Math.max(...plan.map((s) => s.durationSec))),
    mediaSequence: 0,
    mapUri: 'init.mp4',
    entries: plan.map((s) => ({ uri: `seg-${s.sequence}.m4s`, durationSec: s.durationSec })),
    endList: true,
  });

  const tSeg0 = performance.now();
  const seg0Result = await processSegmentWithAbort(
    {
      videoSink: demux.videoSink,
      audioSink: demux.audioSink,
      videoCodec: demux.videoCodec,
      audioCodec: demux.audioCodec,
      videoDecoderConfig: demux.videoDecoderConfig,
      audioDecoderConfig,
      plan,
      doTranscode,
      ffmpeg,
      sourceCodec: demux.audioCodec ?? undefined,
      log: wlog,
    },
    0,
  );
  segmentCache.set(0, seg0Result.mediaData);
  if (seg0Result.initSegment) {
    initSegment = seg0Result.initSegment;
    wlog(`init-segment captured size=${initSegment.byteLength}`);
  }
  if (seg0Result.audioDecoderConfig) {
    audioDecoderConfig = seg0Result.audioDecoderConfig;
  }
  wlog(`seg0 preprocess done ${elapsed(tSeg0)}`);

  wlog(`pipeline complete ${elapsed(t0)} total`);

  self.postMessage(
    {
      type: 'ready',
      playlist,
      initData: initSegment!.buffer,
      totalSegments: plan.length,
      durationSec: demux.duration,
      subtitleTracks: demux.subtitleTracks,
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
    wlog(`seg ${index} cache-hit size=${cached.byteLength}`);
    const buffer = cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength);
    self.postMessage({ type: 'segment', index, data: buffer }, { transfer: [buffer] });
    return;
  }

  const controller = new AbortController();
  segmentAbortControllers.set(index, controller);

  try {
    const t0 = performance.now();
    const result = await processSegmentWithAbort(
      {
        videoSink: demux.videoSink,
        audioSink: demux.audioSink,
        videoCodec: demux.videoCodec,
        audioCodec: demux.audioCodec,
        videoDecoderConfig: demux.videoDecoderConfig,
        audioDecoderConfig,
        plan,
        doTranscode,
        ffmpeg,
        sourceCodec: demux.audioCodec ?? undefined,
        log: wlog,
      },
      index,
      controller.signal,
    );
    segmentAbortControllers.delete(index);

    // Update shared mutable state from result
    if (!initSegment && result.initSegment) {
      initSegment = result.initSegment;
      wlog(`init-segment captured size=${initSegment.byteLength}`);
    }
    if (result.audioDecoderConfig) {
      audioDecoderConfig = result.audioDecoderConfig;
    }

    const mediaData = result.mediaData;
    wlog(`seg ${index} done ${elapsed(t0)} size=${mediaData.byteLength}`);

    const buffer = mediaData.buffer.slice(
      mediaData.byteOffset,
      mediaData.byteOffset + mediaData.byteLength,
    );
    self.postMessage({ type: 'segment', index, data: buffer }, { transfer: [buffer] });
  } catch (err) {
    segmentAbortControllers.delete(index);
    if (err instanceof DOMException && err.name === 'AbortError') {
      wlog(`seg ${index} aborted`);
      return;
    }
    throw err;
  }
}

async function handleSubtitle(trackIndex: number) {
  if (!demux) {
    self.postMessage({ type: 'error', message: 'No file open' });
    return;
  }

  const t0 = performance.now();
  const data = await extractSubtitleData(demux.input, trackIndex);
  const webvtt = subtitleDataToWebVTT(data);
  wlog(`subtitle track=${trackIndex} cues=${data.cues.length} codec=${data.codec} ${elapsed(t0)}`);

  self.postMessage({ type: 'subtitle', trackIndex, webvtt, codec: data.codec });
}
