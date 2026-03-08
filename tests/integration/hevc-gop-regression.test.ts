import { join } from 'node:path';
import type { EncodedPacket } from 'mediabunny';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPacketsInRange, demuxFile } from '../../src/pipeline/demux.js';
import { muxToFmp4 } from '../../src/pipeline/mux.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
const HEVC_FIXTURE = join(FIXTURES_DIR, 'codec-hevc.mp4');

interface ReorderedGop {
  keyframeTimestamp: number;
  nextKeyframeTimestamp: number | null;
  packets: EncodedPacket[];
}

async function findReorderedGop(
  demux: Awaited<ReturnType<typeof demuxFile>>,
): Promise<ReorderedGop | null> {
  let keyPacket = await demux.videoSink.getKeyPacket(0);
  if (!keyPacket) {
    const firstPacket = await demux.videoSink.getFirstPacket();
    if (firstPacket?.type === 'key') {
      keyPacket = firstPacket;
    }
  }
  if (!keyPacket) return null;

  while (keyPacket) {
    let packet = keyPacket;
    let nextKeyPacket: EncodedPacket | null = null;
    let hasEarlierPtsInSameGop = false;

    while (true) {
      const nextPacket = await demux.videoSink.getNextPacket(packet);
      if (!nextPacket || nextPacket.sequenceNumber === packet.sequenceNumber) {
        break;
      }
      if (nextPacket.type === 'key') {
        nextKeyPacket = nextPacket;
        break;
      }
      if (!nextPacket.isMetadataOnly && nextPacket.timestamp < keyPacket.timestamp) {
        hasEarlierPtsInSameGop = true;
      }
      packet = nextPacket;
    }

    if (hasEarlierPtsInSameGop) {
      const endSec = nextKeyPacket?.timestamp ?? demux.duration;
      return {
        keyframeTimestamp: keyPacket.timestamp,
        nextKeyframeTimestamp: nextKeyPacket?.timestamp ?? null,
        packets: await collectPacketsInRange(demux.videoSink, keyPacket.timestamp, endSec, {
          startFromKeyframe: true,
        }),
      };
    }

    if (!nextKeyPacket) break;
    keyPacket = nextKeyPacket;
  }

  return null;
}

describe('HEVC GOP timestamp regression', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it('muxes a reordered HEVC GOP without tripping the previous-GOP timestamp guard', async () => {
    const demux = await demuxFile(HEVC_FIXTURE);
    dispose = demux.dispose;

    const gop = await findReorderedGop(demux);
    expect(gop, 'expected fixture to contain a GOP with reordered PTS').toBeTruthy();

    expect(gop!.packets.length).toBeGreaterThan(1);
    expect(gop!.packets[0].type).toBe('key');
    expect(
      gop!.packets.some((packet, index) => index > 0 && packet.timestamp < gop!.packets[0].timestamp),
    ).toBe(true);

    const endSec = gop!.nextKeyframeTimestamp ?? demux.duration;
    const audioPackets = demux.audioSink
      ? await collectPacketsInRange(demux.audioSink, gop!.keyframeTimestamp, endSec)
      : [];

    await expect(
      muxToFmp4({
        videoPackets: gop!.packets,
        audioPackets,
        videoCodec: demux.videoCodec,
        audioCodec: demux.audioCodec ?? 'aac',
        videoDecoderConfig: demux.videoDecoderConfig,
        audioDecoderConfig: demux.audioDecoderConfig,
      }),
    ).resolves.toMatchObject({
      init: expect.any(Uint8Array),
      media: expect.any(Array),
    });
  });
});
