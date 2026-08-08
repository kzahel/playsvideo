import { transcodeAudioSegment } from './audio-transcode.js';
import { audioNeedsTranscode, type CodecProber, createNodeProber } from './codec-probe.js';
import { collectPacketsInRange, demuxFile, getKeyframeIndex } from './demux.js';
import { muxToFmp4 } from './mux.js';
import { generateVodPlaylist } from './playlist.js';
import { buildSegmentPlan } from './segment-plan.js';
import { getSegmentAudioStartSec } from './segment-processor.js';
import type { FfmpegRunner } from './types.js';

const MAX_SEGMENT_KEYFRAME_REWIND_SEC = 0.5;

export interface PipelineOptions {
  filePath: string;
  ffmpeg: FfmpegRunner;
  targetSegmentDuration?: number;
  codecProber?: CodecProber;
}

export interface PipelineSegment {
  index: number;
  data: Uint8Array;
  durationSec: number;
  startSec: number;
}

export interface PipelineResult {
  init: Uint8Array;
  segments: PipelineSegment[];
  playlist: string;
  totalDurationSec: number;
}

export async function runPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const targetDuration = opts.targetSegmentDuration ?? 4;
  const prober = opts.codecProber ?? createNodeProber();

  // 1. Demux
  const demux = await demuxFile(opts.filePath);
  try {
    // 2. Keyframe index
    const index = await getKeyframeIndex(demux.videoSink, demux.duration);

    // 3. Segment plan
    const plan = buildSegmentPlan({
      keyframeTimestampsSec: index.keyframes.map((k) => k.timestamp),
      durationSec: index.duration,
      targetSegmentDurationSec: targetDuration,
    });

    const doTranscode =
      demux.audioCodec !== null &&
      audioNeedsTranscode(prober, demux.audioCodec, demux.audioDecoderConfig?.codec);
    const outputAudioCodec = doTranscode ? 'aac' : (demux.audioCodec ?? 'aac');

    // For transcoded audio, we'll build a new AudioDecoderConfig from the AAC output.
    // For passthrough, use the original config.
    let audioDecoderConfig = demux.audioDecoderConfig;

    // Detect HE-AAC (SBR) from AudioSpecificConfig bytes to fix MSE A/V sync issues.
    // Standard AAC-LC config is 2 bytes. If it's longer (or explicit type 5), it often contains SBR.
    if (!doTranscode && audioDecoderConfig && audioDecoderConfig.codec === 'mp4a.40.2' && audioDecoderConfig.description) {
      const desc = new Uint8Array(audioDecoderConfig.description as ArrayBuffer);
      const objectType = desc.length > 0 ? desc[0] >>> 3 : 0;
      if (objectType === 5 || (objectType === 2 && desc.length >= 4)) {
        audioDecoderConfig = {
          ...audioDecoderConfig,
          codec: 'mp4a.40.5', // Promote to HE-AAC to fix Chrome timestamp handling
        };
      }
    }

    let init: Uint8Array | null = null;
    const segments: PipelineSegment[] = [];

    // 4. Process each segment
    for (const seg of plan) {
      const endSec = seg.startSec + seg.durationSec;

      // Extract packets for this segment
      const videoPackets = await collectPacketsInRange(demux.videoSink, seg.startSec, endSec, {
        startFromKeyframe: true,
        maxKeyframeRewindSec: MAX_SEGMENT_KEYFRAME_REWIND_SEC,
      });

      const audioStartSec = getSegmentAudioStartSec(seg.startSec, videoPackets);
      let audioPackets = demux.audioSink
        ? await collectPacketsInRange(demux.audioSink, audioStartSec, endSec)
        : [];

      // Transcode audio if needed
      if (doTranscode && audioPackets.length > 0) {
        const sampleRate = demux.audioDecoderConfig?.sampleRate ?? 48000;
        const transcoded = await transcodeAudioSegment({
          packets: audioPackets,
          sampleRate,
          audioStartSec: audioPackets[0].timestamp,
          ffmpeg: opts.ffmpeg,
          sourceCodec: demux.audioCodec ?? undefined,
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
        audioCodec: outputAudioCodec,
        videoDecoderConfig: demux.videoDecoderConfig,
        audioDecoderConfig,
      });

      // Keep the first init segment
      if (!init) {
        init = muxResult.init;
      }

      // Concatenate all media fragments for this segment
      const mediaData = concatBuffers(muxResult.media);

      segments.push({
        index: seg.sequence,
        data: mediaData,
        durationSec: seg.durationSec,
        startSec: seg.startSec,
      });
    }

    if (!init) {
      throw new Error('No segments produced');
    }

    // 5. Generate playlist
    const maxDuration = Math.ceil(Math.max(...plan.map((s) => s.durationSec)));

    const playlist = generateVodPlaylist({
      targetDuration: maxDuration,
      mediaSequence: 0,
      mapUri: 'init.mp4',
      entries: segments.map((s) => ({
        uri: `seg-${s.index}.m4s`,
        durationSec: s.durationSec,
      })),
      endList: true,
    });

    return {
      init,
      segments,
      playlist,
      totalDurationSec: demux.duration,
    };
  } finally {
    demux.dispose();
  }
}

function concatBuffers(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.byteLength;
  }
  return result;
}
