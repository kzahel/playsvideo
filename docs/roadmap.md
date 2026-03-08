# Roadmap

Planned features, roughly in priority order.

## Media player app (`/app`)

Full-featured media player built with React, living in `app/` as a separate pnpm workspace. Current: folder picker (File System Access API), library grid, watch state tracking (unwatched/in-progress/watched), playback position resume. Planned:

- **Playlists** — create, reorder, and manage playlists stored in IndexedDB
- **Library thumbnails** — generate thumbnails via `VideoDecoder` single-frame capture, store in IDB
- **Search/filter/sort** — filter library by name, sort by date/size/watch state
- **Responsive sidebar** — permanent on desktop, hamburger on mobile

## External subtitle follow-up

External `.srt` and `.vtt` subtitle loading is now wired into the engine and player surfaces. Remaining work here is broader format support, especially external `.ass/.ssa` rendering.

## WebCodecs audio transcode

Replace the ffmpeg.wasm audio transcode path with `AudioDecoder`/`AudioEncoder` for supported codecs. Smaller bundle, lower latency, no wasm download. ffmpeg.wasm remains the fallback for codecs WebCodecs doesn't support (AC3, DTS).

## WebCodecs video transcode

Hardware-accelerated video transcode for edge-case codecs (HEVC on Firefox, MPEG-2). Uses `VideoDecoder` + `VideoEncoder` to transcode to H.264 at hundreds of fps vs ~2-5 fps with software x264 in wasm.

See [codec-architecture.md](codec-architecture.md) for the full design.

## Seek preview thumbnails

Decode a single frame at the seek position via `VideoDecoder` to show a thumbnail preview on the seek bar. No ffmpeg needed, fast, low memory.
