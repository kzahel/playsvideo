# No SharedArrayBuffer Required

Decision: playsvideo does not require SharedArrayBuffer or cross-origin isolation
(COOP/COEP headers). This is a deliberate architectural choice, not a limitation.

## Background

SharedArrayBuffer requires the page to be cross-origin isolated via:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

These headers prevent embedding the player on third-party sites, loading
cross-origin resources without CORS, and generally make "just works" CDN
distribution impossible.

## Why we don't need it

### ffmpeg.wasm is single-threaded

Our audio-only ffmpeg.wasm build uses `--disable-pthreads` (single-threaded).
Emscripten implements pthreads via Web Workers sharing a SharedArrayBuffer heap —
no pthreads means no SharedArrayBuffer needed.

Audio transcode (AC3/DTS → AAC) of 2-6 second segments is fast enough
single-threaded. There's no need for intra-segment parallelism on small chunks.

### Video is never transcoded by ffmpeg

Video packets pass through untouched (remux only). The browser's native MSE
decoder handles playback — hardware-accelerated, no wasm involved.

### Future video transcode uses WebCodecs, not ffmpeg.wasm

For exotic codecs (MPEG-2, HEVC on Firefox), the planned path is:
- ffmpeg.wasm **decode** (single-threaded) → raw frames
- WebCodecs **encode** (hardware-accelerated) → H.264

WebCodecs is a native browser API — no SharedArrayBuffer needed. ffmpeg.wasm
software encoding (2-5 fps) is unusable for video; hardware encode via WebCodecs
runs at hundreds of fps.

### Parallelism comes from multiple workers, not threads

For throughput, we can run multiple independent ffmpeg.wasm instances in separate
workers, each processing a different segment. This is inter-segment parallelism
and requires no shared memory — each worker owns its own MEMFS heap and receives
data via Transferable postMessage.

### Blob.slice() eliminates the large file problem

The source file is never loaded into memory. mediabunny reads via BlobSource
(Blob.slice()), which is lazy, zero-copy, and has no size limit.
SharedArrayBuffer would be a regression: 2GB wasm32 limit, upfront copy, doubled
memory.

## What about intra-segment threading?

Multi-threaded ffmpeg.wasm could parallelize decode within a single segment
(slice/tile parallelism in the codec, frame-level parallelism). This would
require SharedArrayBuffer.

However:
- Target content is low-bitrate legacy material (MPEG-2 at 480p/576i)
- Single-threaded decode of a 2-6 second segment at that resolution is
  sub-second on modern hardware
- If single-threaded decode can't keep real-time for one segment, playback
  buffers briefly on cold start but catches up via parallel workers
- The COOP/COEP cost (no third-party embedding, no cross-origin resources
  without CORS) outweighs the marginal decode speedup

## Implications

- **COOP/COEP headers removed** from Cloudflare Worker and Vite dev server
- **CDN/unpkg distribution** is viable — the player can be embedded on any
  origin without special server configuration
- **Opt-in threading**: if a future use case demands it, check
  `crossOriginIsolated` at runtime and load the MT ffmpeg build when available,
  falling back to ST otherwise
