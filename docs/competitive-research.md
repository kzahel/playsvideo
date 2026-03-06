# Competitive Research: Client-Side Browser Video Players

*Last updated: 2026-03-06*

## Summary

No existing project ships a standalone, minimal client-side video player that can play arbitrary video formats (including non-web-native codecs like AC3 audio, MKV containers) directly in the browser without a server. The key architectural insight — using mediabunny for streaming demux/mux, ffmpeg.wasm only for small audio transcode segments, and hls.js for playback — has not been implemented by anyone else.

## Why Nobody Has Done It

The typical path developers take:
1. Try ffmpeg.wasm for full-file remuxing
2. Discover WORKERFS is catastrophically slow for large files, MEMFS can't hold them
3. Conclude "the browser can't do this" and give up

The non-obvious architecture that makes this work:
- **mediabunny** for demux AND mux (streaming fMP4, no full-file copies)
- **ffmpeg.wasm** ONLY for small MEMFS operations (e.g. AC3→AAC audio transcode of short segments)
- **hls.js** for playback (avoids manual MSE management)

## Closest Competitors

### mediafox (wiedymi)
- **URL**: https://github.com/wiedymi/mediafox
- **What it is**: Framework-agnostic TypeScript media player library built on mediabunny
- **Approach**: Uses WebCodecs API for decode — renders frames directly rather than remuxing to fMP4
- **Strengths**: Clean API, supports File/Blob/URL/ArrayBuffer, subtitle support, framework-agnostic
- **Limitations**: Codec support limited to whatever WebCodecs supports natively in the browser. No audio transcode for unsupported codecs (AC3, DTS, etc.). It's a library/framework for building players, not a standalone drop-in app.
- **Key difference**: WebCodecs decode vs our remux-to-fMP4 + hls.js approach

### mkv-web (ilian)
- **URL**: https://github.com/ilian/mkv-web
- **What it is**: Plays MKV files in browser by remuxing with ffmpeg compiled to WebAssembly
- **Approach**: Uses ffmpeg.wasm for the entire remux, sends chunks via Web Worker to MSE
- **Strengths**: Simple concept, works for small files
- **Limitations**: Uses ffmpeg for the full remux — exactly the approach that's too slow for large files. Proof of concept quality.
- **Key difference**: Full ffmpeg.wasm remux vs our mediabunny streaming approach

### JSMKV (gyf304)
- **URL**: https://github.com/gyf304/jsmkv
- **What it is**: In-browser MKV player and Matroska toolkit in TypeScript
- **Approach**: Custom MKV parser, limited codec support
- **Strengths**: Pure TypeScript, no wasm dependency
- **Limitations**: Self-described as "not production ready" / proof of concept. H.264/H.265 + AAC only. No subtitles.
- **Key difference**: Very limited codec/container support

### mkv-player (pawitp)
- **URL**: https://github.com/pawitp/mkv-player
- **What it is**: Web-based MKV player with subtitle support
- **Strengths**: Has subtitle support
- **Limitations**: Small project, limited scope and codec support

### mediabunny demo player
- **URL**: https://mediabunny.dev/examples/media-player/
- **What it is**: Example player on the mediabunny docs site
- **Approach**: Uses mediabunny + WebCodecs for decode
- **Limitations**: Demo/example, not a shipped product. Same WebCodecs-only limitation as mediafox.

## Major Players That Don't Do This

| Project | Why it doesn't compete |
|---------|----------------------|
| **Video.js** | Expects server-side transcoding or natively-supported formats |
| **Plyr** | Wrapper around native `<video>`, no client-side remuxing |
| **hls.js** | Playback library only — expects pre-segmented HLS content |
| **Shaka Player** | DASH/HLS playback, no client-side format conversion |
| **JW Player** | Commercial, server-dependent |

## Ecosystem Signal: Remotion → mediabunny

Remotion (well-funded video tooling company) built their own `@remotion/media-parser` and `@remotion/webcodecs` packages for browser-side video processing. As of September 2025, they deprecated both in favor of mediabunny, sponsoring it at $1k/month. This validates mediabunny as the dominant toolkit for browser-side media operations — but Remotion's use case is programmatic video creation, not playback of arbitrary files.

- https://www.remotion.dev/blog/mediabunny
- https://www.remotion.dev/docs/mediabunny/

## Our Differentiation

1. **Plays any format** — not limited to web-native codecs thanks to ffmpeg.wasm audio transcode
2. **Handles large files** — streaming architecture avoids MEMFS/WORKERFS limitations
3. **Standalone** — single app, not a library requiring integration
4. **Minimal** — glues together proven components rather than reimplementing everything
5. **No server** — fully client-side, works offline once loaded
