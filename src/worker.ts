import { WasmFfmpegRunner } from './adapters/wasm-ffmpeg.js';
import { transcodeAudioSegment } from './pipeline/audio-transcode.js';
import { audioNeedsTranscode, createBrowserProber } from './pipeline/codec-probe.js';
import type { DemuxResult } from './pipeline/demux.js';
import { collectPacketsInRange, demuxBlob, demuxUrl, getKeyframeIndex } from './pipeline/demux.js';
import { muxToFmp4 } from './pipeline/mux.js';
import { generateVodPlaylist } from './pipeline/playlist.js';
import { buildSegmentPlan } from './pipeline/segment-plan.js';
import { extractSubtitleData, subtitleDataToWebVTT } from './pipeline/subtitle.js';
import type { PlannedSegment } from './pipeline/types.js';

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

// Serialize segment processing — concurrent ffmpeg.wasm calls corrupt shared MEMFS files
let processingChain: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent) => {
  const msg = event.data;

  if (msg.type === 'open') {
    wlog('recv open');
    processingChain = handleOpen(() => demuxBlob(msg.file), msg.targetSegmentDuration ?? 4).catch(
      (err) => self.postMessage({ type: 'error', message: String(err) }),
    );
  } else if (msg.type === 'open-url') {
    wlog('recv open-url');
    processingChain = handleOpen(() => demuxUrl(msg.url), msg.targetSegmentDuration ?? 4).catch(
      (err) => self.postMessage({ type: 'error', message: String(err) }),
    );
  } else if (msg.type === 'segment') {
    wlog(`recv segment idx=${msg.index}`);
    processingChain = processingChain
      .then(() => handleSegment(msg.index))
      .catch((err) => self.postMessage({ type: 'error', message: String(err) }));
  } else if (msg.type === 'subtitle') {
    wlog(`recv subtitle trackIndex=${msg.trackIndex}`);
    handleSubtitle(msg.trackIndex).catch((err) =>
      self.postMessage({ type: 'error', message: String(err) }),
    );
  }
};

async function handleOpen(demuxFn: () => Promise<DemuxResult>, targetSegmentDuration: number) {
  const t0 = performance.now();

  if (demux) {
    demux.dispose();
  }

  const tDemux = performance.now();
  demux = await demuxFn();
  wlog(
    `demux done ${elapsed(tDemux)} codec=${demux.videoCodec}/${demux.audioCodec} dur=${demux.duration.toFixed(1)}s`,
  );

  const tIndex = performance.now();
  const index = await getKeyframeIndex(demux.videoSink, demux.duration);
  wlog(`keyframe-index done ${elapsed(tIndex)} keyframes=${index.keyframes.length}`);

  const tPlan = performance.now();
  plan = buildSegmentPlan({
    keyframeTimestampsSec: index.keyframes.map((k) => k.timestamp),
    durationSec: index.duration,
    targetSegmentDurationSec: targetSegmentDuration,
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
  segmentCache.set(0, await processSegment(0));
  wlog(`seg0 preprocess done ${elapsed(tSeg0)}`);

  wlog(`open complete ${elapsed(t0)} total`);

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

  const t0 = performance.now();
  const mediaData = await processSegment(index);
  wlog(`seg ${index} done ${elapsed(t0)} size=${mediaData.byteLength}`);

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
  wlog(`seg ${index} start range=[${seg.startSec.toFixed(2)},${endSec.toFixed(2)})`);

  const tVid = performance.now();
  const videoPackets = await collectPacketsInRange(demux.videoSink, seg.startSec, endSec, {
    startFromKeyframe: true,
  });
  wlog(`seg ${index} video-collect ${elapsed(tVid)} pkts=${videoPackets.length}`);

  const tAud = performance.now();
  let audioPackets = demux.audioSink
    ? await collectPacketsInRange(demux.audioSink, seg.startSec, endSec)
    : [];
  wlog(`seg ${index} audio-collect ${elapsed(tAud)} pkts=${audioPackets.length}`);

  if (doTranscode && audioPackets.length > 0) {
    const sampleRate = demux.audioDecoderConfig?.sampleRate ?? 48000;
    const transcoded = await transcodeAudioSegment({
      packets: audioPackets,
      sampleRate,
      audioStartSec: audioPackets[0].timestamp,
      ffmpeg,
      sourceCodec: demux.audioCodec ?? undefined,
    });
    const m = transcoded.metrics;
    const speed = m.ffmpegSpeed !== null ? ` speed=${m.ffmpegSpeed}x` : '';
    wlog(
      `seg ${index} transcode ${m.totalMs.toFixed(1)}ms audio=${m.audioDurationSec.toFixed(2)}s ratio=${m.realtimeRatio.toFixed(4)}x ffmpeg=${m.ffmpegMs.toFixed(1)}ms${speed} | concat=${m.concatMs.toFixed(1)} write=${m.writeMs.toFixed(1)} read=${m.readMs.toFixed(1)} parse=${m.parseMs.toFixed(1)} cleanup=${m.cleanupMs.toFixed(1)} in=${m.inputPackets}/${m.inputBytes}B out=${m.outputPackets}/${m.outputBytes}B`,
    );
    audioPackets = transcoded.packets;
    if (!audioDecoderConfig || audioDecoderConfig.codec !== 'mp4a.40.2') {
      audioDecoderConfig = transcoded.decoderConfig;
    }
  }

  const tMux = performance.now();
  const muxResult = await muxToFmp4({
    videoPackets,
    audioPackets,
    videoCodec: demux.videoCodec,
    audioCodec: doTranscode ? 'aac' : (demux.audioCodec ?? 'aac'),
    videoDecoderConfig: demux.videoDecoderConfig,
    audioDecoderConfig,
  });
  wlog(`seg ${index} mux ${elapsed(tMux)}`);

  if (!initSegment) {
    initSegment = muxResult.init;
    wlog(`init-segment captured size=${initSegment.byteLength}`);
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
