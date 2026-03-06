# Codec Architecture & Licensing

## Current Architecture

playsvideo is a client-side video player that remuxes video files into fMP4/HLS
for browser playback — no server required.

### Pipeline

```
Input file → mediabunny (demux) → segment packets → mediabunny (mux fMP4) → hls.js (playback)
                                        │
                                   audio transcode
                                   (AC3/DTS → AAC)
                                   via ffmpeg.wasm
```

**Video is never decoded or re-encoded** in the normal path. Packets are copied
as-is from the source container into fMP4 segments. The browser's built-in MSE
decoder (behind hls.js) handles actual video decoding for playback.

**Audio transcode** is only needed when the source audio codec isn't
browser-playable (AC3, DTS, FLAC, etc.). ffmpeg.wasm handles this: decode the
source codec to PCM, encode to AAC. This runs on small per-segment chunks, not
the full file.

### Dependencies & Licenses

| Dependency | Role | License | Copyleft scope |
|---|---|---|---|
| mediabunny | Demux + mux (fMP4) | MPL-2.0 | File-level only |
| @ffmpeg/ffmpeg | JS wrapper for ffmpeg.wasm | MIT | None |
| ffmpeg-core.wasm | Audio transcode (loaded at runtime) | LGPL-2.1 | Library-level |
| hls.js | HLS playback via MSE | Apache-2.0 | None |

### Licensing implications

**Our source code can be any license** (including proprietary). The constraints:

- **mediabunny (MPL-2.0)**: If we modify mediabunny's own source files, those
  modifications must remain MPL-2.0 and be published. Our fork is already public
  on GitHub, so we're compliant. Files that *import* mediabunny are unaffected —
  MPL operates at the file level, not the linking level.

- **ffmpeg-core.wasm (LGPL-2.1)**: LGPL requires users be able to substitute
  the library with a modified version. Since the .wasm file is loaded at runtime
  (fetched separately, not compiled into our JS bundle), users can swap it out.
  This satisfies LGPL's relinkability requirement naturally.

  **Important**: The default `@ffmpeg/core` build uses LGPL-safe codecs only. If
  we ever switch to a `-gpl` build (one compiled with x264, x265, or libfdk-aac),
  the entire app would need to be GPL. We don't need any GPL codecs — our audio
  transcode path only needs the built-in AAC encoder.

- **hls.js (Apache-2.0)** and **@ffmpeg/ffmpeg (MIT)**: No copyleft. Include
  license notices in distribution.

**For desktop apps (Electron) or Chrome extensions**: same rules apply. The key
factor is that ffmpeg.wasm stays dynamically loaded (already the case) and we
ship a THIRD_PARTY_LICENSES file with all notices.

## Roadmap: Video Transcoding via WebCodecs

### When is transcoding needed?

Only when the source video codec isn't natively playable by the browser:

| Source codec | Chrome | Safari | Firefox | Transcode needed? |
|---|---|---|---|---|
| H.264 | Yes | Yes | Yes | No — remux only |
| HEVC/H.265 | HW-dependent | Yes | No | Firefox only |
| AV1 | Yes | Safari 17+ | Yes | Rare edge cases |
| VP9 | Yes | Safari 16+ | Yes | Rare |
| MPEG-2 | No | No | No | Yes, if we want to support it |

For the cases where transcode *is* needed, the output target is always **H.264**
— it's universally supported and hardware encoding is available on essentially
every device with a browser (macOS VideoToolbox, Windows Media Foundation,
ChromeOS/Android MediaCodec, Intel/AMD/NVIDIA on Linux).

### WebCodecs vs ffmpeg.wasm for transcoding

**ffmpeg.wasm does software encoding in wasm**. For x264 encoding that means
~2-5 fps on a fast machine. Unusable for anything beyond short clips.

**WebCodecs provides hardware-accelerated encode/decode** through the browser's
`VideoDecoder` and `VideoEncoder` APIs. Hardware H.264 encoding runs at hundreds
of fps — it's the same silicon that encodes video calls and screen recordings.

WebCodecs is supported in Chrome 94+, Edge 94+, Safari 16.4+, and Firefox
(behind a flag, expected to ship). For a browser-based app this is effectively
universal.

### Proposed transcode pipeline

```
Can the browser play this codec natively?
  │
  ├─ YES → remux only (current fast path, no changes)
  │
  └─ NO → transcode via WebCodecs
            │
            ├─ WebCodecs can decode source? (check via isConfigSupported)
            │    YES → WebCodecs VideoDecoder → VideoFrame → WebCodecs VideoEncoder (H.264)
            │    NO  → ffmpeg.wasm decode → raw frames → WebCodecs VideoEncoder (H.264)
            │
            └─ mux encoded packets into fMP4 via mediabunny
```

The **hybrid path** (ffmpeg decode + WebCodecs encode) covers oddball source
codecs that WebCodecs doesn't have a decoder for, while still getting
hardware-accelerated H.264 output.

### Detection logic

```js
// Check if the browser can play the source codec natively (remux path)
const canPlay = MediaSource.isTypeSupported(`video/mp4; codecs="${codec}"`);

// Check if WebCodecs can decode it (transcode decode path)
const canDecode = await VideoDecoder.isConfigSupported({ codec, ... });

// Check if WebCodecs can encode H.264 (transcode encode path — almost always true)
const canEncode = await VideoEncoder.isConfigSupported({
  codec: 'avc1.640028', // H.264 High Profile Level 4.0
  width, height,
  hardwareAcceleration: 'prefer-hardware'
});
```

### Audio: keep ffmpeg.wasm

WebCodecs `AudioDecoder` doesn't support AC3, EAC3, DTS, or most non-PCM/AAC
codecs. ffmpeg.wasm remains the right tool for audio transcode. The current
segment-based approach (decode small chunks, encode to AAC) is fast enough and
avoids any need for hardware acceleration.

### Other WebCodecs opportunities

- **Seek preview thumbnails**: Decode a single frame at a seek position via
  `VideoDecoder` to show a preview image. No ffmpeg needed, fast, low memory.

- **Codec detection/validation**: Use `isConfigSupported()` to determine the
  best playback strategy before starting the pipeline.

### Licensing benefit

WebCodecs uses the browser's built-in codec implementations (including
patent-licensed ones like H.264 and HEVC). There is zero licensing impact on our
code — the browser vendor handles codec patents and licensing. Using WebCodecs
for video transcode would actually *reduce* our ffmpeg.wasm dependency surface
area.
