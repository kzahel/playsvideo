# Roadmap

See [mediaplayer-comparison.md](mediaplayer-comparison.md) for a detailed feature comparison with the dominant Chrome extension competitor (MediaPlayer, ~100K users) and prioritized gaps to close.

## Discoverability & Growth

We have a working product — Chrome extension, PWA, npm library — but almost no users find it. These items are about being where users search and making a strong first impression.

- **Chrome Web Store listing polish** — better screenshots (showing MKV/AC3 playback, subtitle rendering, library view), feature bullet points, and a short promo video. The listing is the storefront; right now it's bare.
- **SEO landing pages** — targeted pages on playsvideo.com for the queries people actually search: "play MKV in browser", "MKV no audio Chrome", "AC3 audio Chrome OS", "play video files offline". Each page explains the problem and links to the extension/PWA.
- **PWA file handling** — register as a file handler via the web app manifest (`file_handlers`) so the PWA shows up in "Open with" on Chrome OS and desktop Chrome, same as the extension already does.
- **Chrome Web Store categories & SEO** — add relevant categories, localized descriptions, and keyword-rich copy. Consider listing in "ChromeOS Recommended" if eligible.

## Player Polish

Small features that make the player feel complete. These are the "why would I switch from VLC" moments.

- **Screenshot button** — capture current frame as PNG via `canvas.drawImage(video)`. One button, instant download.
- **Audio boost / volume amplifier** — Web Audio API gain node (up to 3-4x). Solves the common "video is too quiet" complaint without touching the file.
- **Playback speed 3x/4x** — expand speed options beyond 2x. Useful for lectures, tutorials, surveillance footage.
- **Picture-in-Picture** — one-click PiP button (browser API, trivial to add). Lets users watch while doing other things.
- **Keyboard shortcuts overlay** — show available shortcuts on `?` press. Users don't know what's available.
- **Drag-and-drop URL** — drop a video URL onto the player to play remote media via range requests (engine already supports `loadUrl`).

## Library & Media Management

The app has a library with folder scanning and watch state. These features make it a real media manager.

- **Library thumbnails** — generate thumbnails via `VideoDecoder` single-frame capture, store in IndexedDB. The grid is text-only right now.
- **Search / filter / sort** — filter by name, sort by date/size/watch state. Essential once libraries get large.
- **Playlists** — create, reorder, and manage playlists in IndexedDB. Play next automatically.
- **Responsive sidebar** — permanent on desktop, hamburger drawer on mobile.
- **Recently played** — quick access to the last N files without navigating the full library.
- **Series grouping** — auto-detect episode numbering and group files into series. "Continue watching" for the next episode.

## Subtitle & Audio

- **ASS/SSA subtitle rendering** — external `.ass/.ssa` files with styled rendering (libass.js or similar). Currently only SRT/VTT.
- **Multi-audio track selection** — surface all audio tracks and let users switch (engine already demuxes multiple tracks).
- **Audio visualizer** — waveform or spectrum display for audio-only files. Nice visual polish, differentiates from competitors.

## Engine / Technical

These are invisible to users but unlock future features or improve performance.

- **WebCodecs audio transcode** — replace ffmpeg.wasm with `AudioDecoder`/`AudioEncoder` for supported codecs. Smaller bundle, lower latency, no wasm download. ffmpeg.wasm remains fallback for AC3/DTS.
- **WebCodecs video transcode** — hardware-accelerated transcode for edge-case codecs (HEVC on Firefox, MPEG-2). Hundreds of fps vs ~2-5 fps with software x264 in wasm.
- **Seek preview thumbnails** — decode a single frame at the seek position via `VideoDecoder` for thumbnail preview on the seek bar.
