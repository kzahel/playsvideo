<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/wordmark-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="docs/wordmark-light.svg">
  <img alt="playsvideo" src="docs/wordmark-light.svg" width="340">
</picture>

**You may not need VLC.** Play any video file in the browser — no install, no upload.

[Try it at playsvideo.com](https://playsvideo.com) &nbsp;|&nbsp; Drop a file. It plays.

---

Most video files won't play in a browser — not because the browser can't *decode* the video, but because it can't open the container or handle the audio codec. playsvideo fixes that entirely client-side: it remuxes containers and transcodes audio on the fly, so your MKV with AC-3 audio just works.

### What it handles

| | Formats | Notes |
|---|---|---|
| **Containers** | MKV, MP4, AVI, TS, WebM | Demuxed and remuxed to fMP4 |
| **Video** | H.264, H.265, VP9, AV1 | Passthrough — plays ~99% of files (~90% on Firefox; HEVC transcode planned) |
| **Audio** | AAC, MP3, AC-3, E-AC-3, DTS, FLAC, Opus | Unsupported codecs transcoded to AAC on the fly |
| **Subtitles** | SRT, ASS/SSA | Extracted and displayed as WebVTT |

See [supported media](docs/supported-media.md) for the full codec matrix, browser compatibility, and transcode details.

### How it works

```
Video file (MKV, MP4, AVI, …)
  → mediabunny demux (streaming, any file size)
  → keyframe-aligned segment plan
  → per segment:
      video passed through or transcoded if needed
      audio transcoded only if needed (AC-3/DTS/FLAC → AAC)
      muxed to fMP4
  → hls.js plays segments on demand
  → subtitles extracted to WebVTT
```

Video transcode is almost never needed — browsers natively decode the vast majority of video codecs in the wild. When audio transcode is needed, a lightweight 1.5 MB ffmpeg.wasm build is lazy-loaded on demand — a few seconds at a time, entirely in-browser.

### Under the hood

The obvious approach — ffmpeg compiled to WebAssembly — can't handle large files (WORKERFS is catastrophically slow, MEMFS can't hold them). The trick is to split the problem:

- **[mediabunny](https://github.com/Vanilagy/mediabunny)** — streaming demux/remux in pure TypeScript, works on any size file
- **[ffmpeg.wasm](https://github.com/nicolo-ribaudo/ffmpeg.wasm)** — only transcodes short audio segments via MEMFS
- **[hls.js](https://github.com/video-dev/hls.js)** — battle-tested HLS playback via Media Source Extensions

Each piece existed separately. Nobody combined them.

### Use as a library

> Not yet published to npm. The API below is the current interface.

```ts
import { PlaysVideoEngine } from 'playsvideo';

const video = document.querySelector('video')!;
const engine = new PlaysVideoEngine(video);

engine.addEventListener('ready', (e) => {
  console.log(`${e.detail.totalSegments} segments, ${e.detail.durationSec}s`);
});

engine.loadFile(file); // from drag-and-drop or <input type="file">
engine.destroy();      // clean up
```

### Roadmap

- **npm publish** — `npm install playsvideo`
- **WebCodecs** — replace ffmpeg.wasm audio transcode with `AudioDecoder`/`AudioEncoder` (smaller bundle, lower latency)
- **Video transcode** — hardware-accelerated decode via `VideoDecoder` for edge-case codecs

<details>
<summary><strong>Development</strong></summary>

```bash
npm run setup              # install deps + download ffmpeg-core.wasm
npm run dev                # vite dev server
npm run typecheck          # tsc --noEmit
npm run test:unit          # fast unit tests
npm run lint               # biome lint
npm run format             # biome format
npm run test:integration   # requires test fixtures in tests/fixtures/
```

```
src/pipeline/       Core modules (demux, mux, segment plan, audio transcode,
                    codec probe, playlist, subtitle extraction)
src/adapters/       Platform adapters (ffmpeg.wasm for browser, node-ffmpeg for tests)
src/worker.ts       Web worker — demux + on-demand segment processing
src/engine.ts       PlaysVideoEngine class (worker, hls.js, subtitles)
src/pwa-player.ts   Browser entry — file picker, drag-and-drop
tests/              Unit, integration, and e2e (Playwright) tests
```

</details>
