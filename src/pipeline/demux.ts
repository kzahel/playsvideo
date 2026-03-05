import {
  ALL_FORMATS,
  BlobSource,
  type EncodedPacket,
  EncodedPacketSink,
  FilePathSource,
  Input,
  type InputAudioTrack,
  type InputVideoTrack,
} from 'mediabunny';
import type { KeyframeEntry, KeyframeIndex } from './types.js';

export interface DemuxResult {
  input: Input;
  duration: number;
  videoTrack: InputVideoTrack;
  audioTrack: InputAudioTrack | null;
  videoCodec: string;
  audioCodec: string | null;
  videoDecoderConfig: VideoDecoderConfig;
  audioDecoderConfig: AudioDecoderConfig | null;
  videoSink: EncodedPacketSink;
  audioSink: EncodedPacketSink | null;
  dispose: () => void;
}

export async function demuxFile(filePath: string): Promise<DemuxResult> {
  return demuxInput(
    new Input({ formats: ALL_FORMATS, source: new FilePathSource(filePath) }),
  );
}

export async function demuxBlob(blob: Blob): Promise<DemuxResult> {
  return demuxInput(
    new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) }),
  );
}

async function demuxInput(input: Input): Promise<DemuxResult> {
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    throw new Error('No video track found');
  }

  let audioTrack: InputAudioTrack | null = null;
  try {
    audioTrack = await input.getPrimaryAudioTrack();
  } catch {
    // No audio track — that's fine
  }

  const videoCodec = videoTrack.codec;
  if (!videoCodec) {
    throw new Error('Could not determine video codec');
  }

  const videoSink = new EncodedPacketSink(videoTrack);
  const audioSink = audioTrack ? new EncodedPacketSink(audioTrack) : null;

  const duration = Number(await videoTrack.computeDuration());

  const videoDecoderConfig = await videoTrack.getDecoderConfig();
  if (!videoDecoderConfig) {
    throw new Error('Could not get video decoder config');
  }

  let audioDecoderConfig: AudioDecoderConfig | null = null;
  if (audioTrack) {
    audioDecoderConfig = await audioTrack.getDecoderConfig();
  }

  return {
    input,
    duration,
    videoTrack,
    audioTrack,
    videoCodec,
    audioCodec: audioTrack?.codec ?? null,
    videoDecoderConfig,
    audioDecoderConfig,
    videoSink,
    audioSink,
    dispose: () => input.dispose(),
  };
}

export async function getKeyframeIndex(
  videoSink: EncodedPacketSink,
  duration: number,
): Promise<KeyframeIndex> {
  const keyframes: KeyframeEntry[] = [];
  let packet = await videoSink.getKeyPacket(0, { metadataOnly: true });

  while (packet) {
    const ts = packet.timestamp;
    if (Number.isFinite(ts) && ts >= 0) {
      keyframes.push({ timestamp: ts, sequenceNumber: packet.sequenceNumber });
    }
    const next = await videoSink.getNextKeyPacket(packet, {
      metadataOnly: true,
    });
    if (!next || next.sequenceNumber === packet.sequenceNumber) break;
    packet = next;
  }

  return { duration, keyframes };
}

export async function collectPacketsInRange(
  sink: EncodedPacketSink,
  startSec: number,
  endSec: number,
  opts?: { startFromKeyframe?: boolean },
): Promise<EncodedPacket[]> {
  const packets: EncodedPacket[] = [];

  let packet: EncodedPacket | null = null;
  if (opts?.startFromKeyframe) {
    packet = await sink.getKeyPacket(startSec);
  } else {
    packet = await sink.getPacket(startSec);
  }
  if (!packet) {
    packet = await sink.getFirstPacket();
  }
  if (!packet) return packets;

  // Collect packets until we reach endSec
  while (packet) {
    if (packet.timestamp >= endSec) break;
    if (!packet.isMetadataOnly) {
      packets.push(packet);
    }
    const next = await sink.getNextPacket(packet);
    if (!next || next.sequenceNumber === packet.sequenceNumber) break;
    packet = next;
  }

  return packets;
}
