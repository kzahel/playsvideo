# playsvideo

Play video files in the browser. No server, no pre-transcoding, no install. Try it at [playsvideo.com](https://playsvideo.com).

Drop a file and it plays — remuxing containers and transcoding audio codecs that browsers can't handle natively. All processing happens client-side in a web worker.

### Supported formats

| | Supported | Notes |
|---|---|---|
| **Containers** | MKV, MP4, AVI, TS, WebM | Demuxed by mediabunny |
| **Video** | H.264, H.265 (HEVC), VP9, AV1 | Passed through untouched. H.264 works everywhere. HEVC needs Chrome/Edge/Safari (not Chromium/Firefox). VP9/AV1 work in Chrome/Edge/Firefox (not Safari). |
| **Audio (native)** | AAC, MP3 | Passed through |
| **Audio (transcoded)** | AC-3, E-AC-3, DTS, FLAC, Opus | Transcoded to AAC 160k stereo via ffmpeg.wasm |
| **Subtitles** | SRT, ASS/SSA (text-based) | Extracted to WebVTT |

## Usage

> **Not yet published to npm.** The API below is the current interface — it will stabilize before the first release.

```ts
import { PlaysVideoEngine } from 'playsvideo';

const video = document.querySelector('video')!;
const engine = new PlaysVideoEngine(video);

engine.addEventListener('ready', (e) => {
  console.log(`${e.detail.totalSegments} segments, ${e.detail.durationSec}s`);
  console.log('subtitles:', e.detail.subtitleTracks);
});

engine.addEventListener('error', (e) => {
  console.error(e.detail.message);
});

// Load from a File (e.g. drag-and-drop or <input type="file">)
engine.loadFile(file);

// Clean up
engine.destroy();
```

The engine handles everything: spawns a web worker for demux, transcodes unsupported audio, wires up hls.js with custom loaders, and attaches subtitle tracks to the `<video>` element.

## Why this exists

There's no library or app that does this. The browser can decode H.264, H.265 (HEVC), VP9, and AV1 natively, but it can't *open* most video files because it doesn't understand container formats like MKV or audio codecs like AC-3. The obvious solution — ffmpeg compiled to WebAssembly — doesn't work for large files because WORKERFS is catastrophically slow and MEMFS can't hold them.

The trick is to split the problem:

- **mediabunny** (pure TypeScript) handles demux and remux — streaming, no full-file copies, works on any size file
- **ffmpeg.wasm** only transcodes short audio segments (AC-3, E-AC-3, DTS, FLAC, Opus → AAC) via MEMFS — the one thing it's fast at
- **hls.js** handles playback via Media Source Extensions — battle-tested, avoids the manual MSE bug factory

Each piece existed separately. Nobody combined them.

## How it works

```
Video file (MKV, MP4, AVI, TS, WebM)
  → mediabunny demux (extract video + audio packets)
  → keyframe index → segment plan
  → per segment:
      video packets (H.264/HEVC/VP9/AV1) copied as-is
      audio transcoded only if needed (AC-3/E-AC-3/FLAC/Opus → AAC)
      muxed to fMP4 via mediabunny
  → hls.js plays fMP4 segments on demand
  → subtitles extracted to WebVTT
```

The web worker keeps the demux handle open and processes segments on-demand as hls.js requests them. Video is never transcoded — packets are passed through untouched. Only unsupported audio codecs (AC-3, E-AC-3, DTS, FLAC, Opus) go through ffmpeg.wasm, and only a few seconds at a time.

## Project structure

```
src/pipeline/       Core modules (demux, mux, segment plan, audio transcode,
                    codec probe, playlist, subtitle extraction)
src/adapters/       Platform adapters (ffmpeg.wasm for browser, node-ffmpeg for tests)
src/worker.ts       Web worker — demux + on-demand segment processing
src/pwa-player.ts   Browser entry — file picker, hls.js integration, subtitle tracks
tests/unit/         Fast tests, no external dependencies
tests/integration/  Tests requiring ffmpeg/ffprobe and fixture files
tests/e2e/          Playwright browser tests
```

## Status

Third iteration (after stupidplayer and easyplay). The pipeline works end-to-end: demux, keyframe indexing, segment planning, audio transcode, fMP4 muxing, HLS playback, and subtitle extraction. Using a [fork](https://github.com/kzahel/mediabunny/tree/integration) with subtitle support.

## Roadmap

- **npm publish** — package as an installable library (`npm install playsvideo`)
- **WebCodecs** — replace ffmpeg.wasm audio transcode with `AudioDecoder`/`AudioEncoder` for lower latency and smaller bundle (no 1.5 MB wasm download)
- **Video transcode** — hardware-accelerated decode via `VideoDecoder` for codecs the browser can decode but MSE can't mux (edge cases)

## Dependencies

Three runtime dependencies:

- **[mediabunny](https://github.com/Vanilagy/mediabunny)** — pure TypeScript media toolkit for demux/mux (MP4, MKV, WebM, AVI, TS). Using a [fork](https://github.com/kzahel/mediabunny/tree/integration) with subtitle support.
- **[hls.js](https://github.com/video-dev/hls.js)** — HLS playback via MSE
- **[@ffmpeg/ffmpeg](https://github.com/nicolo-ribaudo/ffmpeg.wasm)** — ffmpeg compiled to WebAssembly, used only for small audio transcode operations

## Development

```bash
npm run setup              # install deps + download ffmpeg-core.wasm
npm run dev                # vite dev server
npm run typecheck          # tsc --noEmit
npm run test:unit          # fast unit tests
npm run lint               # biome lint
npm run format             # biome format
npm run test:integration   # requires test fixtures in tests/fixtures/
```
