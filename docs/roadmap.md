# Roadmap

Planned features, roughly in priority order.

## User-imported subtitles

Load external `.srt` or `.vtt` subtitle files alongside the video. The subtitle parsing pipeline (`parseSubtitleFile`) already exists — this just needs UI to select a file and wire it to the engine.

## WebCodecs audio transcode

Replace the ffmpeg.wasm audio transcode path with `AudioDecoder`/`AudioEncoder` for supported codecs. Smaller bundle, lower latency, no wasm download. ffmpeg.wasm remains the fallback for codecs WebCodecs doesn't support (AC3, DTS).

## WebCodecs video transcode

Hardware-accelerated video transcode for edge-case codecs (HEVC on Firefox, MPEG-2). Uses `VideoDecoder` + `VideoEncoder` to transcode to H.264 at hundreds of fps vs ~2-5 fps with software x264 in wasm.

See [codec-architecture.md](codec-architecture.md) for the full design.

## Seek preview thumbnails

Decode a single frame at the seek position via `VideoDecoder` to show a thumbnail preview on the seek bar. No ffmpeg needed, fast, low memory.
