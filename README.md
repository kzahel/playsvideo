# playsvideo

Play video files in the browser. No server, no pre-transcoding, no install.

Drop a file and it plays — remuxing containers and transcoding audio codecs that browsers can't handle natively. All processing happens client-side in a web worker.

### Supported formats

| | Supported | Notes |
|---|---|---|
| **Containers** | MKV, MP4, AVI, TS, WebM | Demuxed by mediabunny |
| **Video** | H.264, H.265, VP9, AV1 | Passed through untouched. H.264 works everywhere. H.265 requires Chrome/Edge/Safari (not Chromium/Firefox). VP9/AV1 vary. |
| **Audio (native)** | AAC, MP3 | Passed through |
| **Audio (transcoded)** | AC-3, E-AC-3, FLAC, Opus | Transcoded to AAC 160k stereo via ffmpeg.wasm |
| **Subtitles** | SRT, ASS/SSA (text-based) | Extracted to WebVTT |

## Why this exists

There's no library or app that does this. The browser can decode H.264, H.265, VP9, and AV1 natively, but it can't *open* most video files because it doesn't understand container formats like MKV or audio codecs like AC-3. The obvious solution — ffmpeg compiled to WebAssembly — doesn't work for large files because WORKERFS is catastrophically slow and MEMFS can't hold them.

The trick is to split the problem:

- **mediabunny** (pure TypeScript) handles demux and remux — streaming, no full-file copies, works on any size file
- **ffmpeg.wasm** only transcodes short audio segments (AC-3, E-AC-3, FLAC, Opus → AAC) via MEMFS — the one thing it's fast at
- **hls.js** handles playback via Media Source Extensions — battle-tested, avoids the manual MSE bug factory

Each piece existed separately. Nobody combined them.

## How it works

```
Video file (MKV, MP4, AVI, TS, WebM)
  → mediabunny demux (extract video + audio packets)
  → keyframe index → segment plan
  → per segment:
      video packets (H.264/H.265/VP9/AV1) copied as-is
      audio transcoded only if needed (AC-3/E-AC-3/FLAC/Opus → AAC)
      muxed to fMP4 via mediabunny
  → hls.js plays fMP4 segments on demand
  → subtitles extracted to WebVTT
```

The web worker keeps the demux handle open and processes segments on-demand as hls.js requests them. Video is never transcoded — packets are passed through untouched. Only unsupported audio codecs (AC-3, E-AC-3, FLAC, Opus) go through ffmpeg.wasm, and only a few seconds at a time.

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
