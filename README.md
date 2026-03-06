# playsvideo

Play any video file in the browser. No server, no pre-transcoding, no install.

Drop an MKV, MP4, AVI, TS, or WebM file and it just plays — including formats browsers can't handle natively (AC3 audio, MKV containers, etc.). All processing happens client-side in a web worker.

## Why this exists

There's no library or app that does this. The browser can decode most video codecs natively (H.264, H.265, VP9, AV1), but it can't *open* most video files because it doesn't understand the container formats or non-web audio codecs. The obvious solution — ffmpeg compiled to WebAssembly — doesn't work for large files because WORKERFS is catastrophically slow and MEMFS can't hold them.

The trick is to split the problem:

- **mediabunny** (pure TypeScript) handles demux and remux — streaming, no full-file copies, works on any size file
- **ffmpeg.wasm** only transcodes short audio segments (AC3/DTS → AAC) via MEMFS — the one thing it's fast at
- **hls.js** handles playback via Media Source Extensions — battle-tested, avoids the manual MSE bug factory

Each piece existed separately. Nobody combined them.

## How it works

```
Video file (any format)
  → mediabunny demux (extract video + audio packets)
  → keyframe index → segment plan
  → per segment:
      video packets copied as-is
      audio transcoded only if needed (AC3/DTS → AAC)
      muxed to fMP4 via mediabunny
  → hls.js plays fMP4 segments on demand
  → subtitles extracted to WebVTT
```

The web worker keeps the demux handle open and processes segments on-demand as hls.js requests them. Video is never transcoded — packets are passed through untouched. Only unsupported audio codecs go through ffmpeg.wasm, and only a few seconds of audio at a time.

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

Third iteration (after stupidplayer and easyplay). The pipeline works end-to-end: demux, keyframe indexing, segment planning, audio transcode, fMP4 muxing, HLS playback, and subtitle extraction. Using a [fork](https://github.com/kzahel/mediabunny/tree/integration) that includes a B-frame CTS fix (upstream PR [#317](https://github.com/Vanilagy/mediabunny/pull/317)) and subtitle support.

## Dependencies

Three runtime dependencies:

- **[mediabunny](https://github.com/Vanilagy/mediabunny)** — pure TypeScript media toolkit for demux/mux (MP4, MKV, WebM, AVI, TS). Using a [fork](https://github.com/kzahel/mediabunny/tree/integration) with subtitle support + CTS fix.
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
