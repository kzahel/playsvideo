import {
  type AudioCodec,
  EncodedAudioPacketSource,
  type EncodedPacket,
  EncodedVideoPacketSource,
  Mp4OutputFormat,
  NullTarget,
  Output,
  type VideoCodec,
} from 'mediabunny';

export interface MuxInput {
  videoPackets: EncodedPacket[];
  audioPackets: EncodedPacket[];
  videoCodec: string;
  audioCodec: string;
  videoDecoderConfig: VideoDecoderConfig;
  audioDecoderConfig: AudioDecoderConfig | null;
}

export interface MuxResult {
  init: Uint8Array;
  media: Uint8Array[];
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

export async function muxToFmp4(input: MuxInput): Promise<MuxResult> {
  const initParts: Uint8Array[] = [];
  const moofMdatPairs: Uint8Array[][] = [];
  let currentPair: Uint8Array[] = [];

  const output = new Output({
    format: new Mp4OutputFormat({
      fastStart: 'fragmented',
      minimumFragmentDuration: 0,
      onFtyp: (data: Uint8Array) => {
        initParts.push(new Uint8Array(data));
      },
      onMoov: (data: Uint8Array) => {
        initParts.push(new Uint8Array(data));
      },
      onMoof: (data: Uint8Array) => {
        currentPair = [new Uint8Array(data)];
        moofMdatPairs.push(currentPair);
      },
      onMdat: (data: Uint8Array) => {
        currentPair.push(new Uint8Array(data));
      },
    }),
    target: new NullTarget(),
  });

  const videoSource = new EncodedVideoPacketSource(input.videoCodec as VideoCodec);
  const audioSource = new EncodedAudioPacketSource(input.audioCodec as AudioCodec);

  output.addVideoTrack(videoSource);
  output.addAudioTrack(audioSource);
  await output.start();

  // Feed video packets — pass decoder config on first packet
  const videoMeta: EncodedVideoChunkMetadata = {
    decoderConfig: input.videoDecoderConfig,
  };
  for (let i = 0; i < input.videoPackets.length; i++) {
    await videoSource.add(input.videoPackets[i], i === 0 ? videoMeta : undefined);
  }

  // Feed audio packets — pass decoder config on first packet
  const audioMeta: EncodedAudioChunkMetadata | undefined = input.audioDecoderConfig
    ? { decoderConfig: input.audioDecoderConfig }
    : undefined;
  for (let i = 0; i < input.audioPackets.length; i++) {
    await audioSource.add(input.audioPackets[i], i === 0 ? audioMeta : undefined);
  }

  await output.finalize();

  const init = concatBuffers(initParts);
  const media = moofMdatPairs.map((pair) => concatBuffers(pair));

  return { init, media };
}
