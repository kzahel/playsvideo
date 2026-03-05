import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTempDir } from '../../src/adapters/node-ffmpeg.js';
import { NodeFfprobeRunner } from '../../src/adapters/node-ffprobe.js';
import { collectPacketsInRange, demuxFile } from '../../src/pipeline/demux.js';
import { muxToFmp4 } from '../../src/pipeline/mux.js';

const FIXTURES_DIR = join(import.meta.dirname, '..', 'fixtures');
const ffprobe = new NodeFfprobeRunner();

describe('mux', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    dispose = undefined;
  });

  it('muxes video+aac packets into decodable fMP4', async () => {
    const demux = await demuxFile(join(FIXTURES_DIR, 'test-h264-aac.mp4'));
    dispose = demux.dispose;

    const videoPackets = await collectPacketsInRange(demux.videoSink, 0, 3);
    const audioPackets = await collectPacketsInRange(demux.audioSink!, 0, 3);

    expect(videoPackets.length).toBeGreaterThan(0);
    expect(audioPackets.length).toBeGreaterThan(0);

    const result = await muxToFmp4({
      videoPackets,
      audioPackets,
      videoCodec: demux.videoCodec,
      audioCodec: demux.audioCodec!,
      videoDecoderConfig: demux.videoDecoderConfig,
      audioDecoderConfig: demux.audioDecoderConfig,
    });

    expect(result.init.byteLength).toBeGreaterThan(0);
    expect(result.media.length).toBeGreaterThan(0);

    // Write init + all media to a file and verify decodable
    const tempDir = await makeTempDir();
    const totalMediaSize = result.media.reduce((s, m) => s + m.byteLength, 0);
    const combined = new Uint8Array(result.init.byteLength + totalMediaSize);
    combined.set(result.init, 0);
    let offset = result.init.byteLength;
    for (const media of result.media) {
      combined.set(media, offset);
      offset += media.byteLength;
    }

    const outPath = join(tempDir, 'test-output.mp4');
    await writeFile(outPath, combined);

    const decodable = await ffprobe.verifyDecodable(outPath);
    expect(decodable.ok, `Not decodable: ${decodable.stderr}`).toBe(true);

    const probe = await ffprobe.probe(outPath);
    const videoStream = probe.streams.find((s) => s.codecType === 'video');
    const audioStream = probe.streams.find((s) => s.codecType === 'audio');
    expect(videoStream?.codecName).toBe('h264');
    expect(audioStream?.codecName).toBe('aac');
  });
});
