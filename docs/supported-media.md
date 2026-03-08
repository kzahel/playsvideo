# Supported Media

## Video Codecs

| Codec | Short Name | MSE Codec String     | Playback |
|-------|------------|----------------------|----------|
| H.264 | `avc`     | `avc1.640028`        | Native (all browsers) |
| H.265 | `hevc`    | `hev1.1.6.L93.B0`   | Chrome, Edge, Safari (hardware-dependent). Not in Chromium or Firefox. |
| VP9   | `vp9`     | `vp09.00.10.08`      | Chrome, Chromium, Edge, Firefox. Not in Safari. |
| AV1   | `av1`     | `av01.0.01M.08`      | Chrome, Edge, Firefox. Not in Safari (older). |

## Audio Codecs

| Codec       | Short Name | MSE Codec String | Remux/HLS Playback     |
|-------------|------------|------------------|------------------------|
| AAC         | `aac`      | `mp4a.40.2`      | Native                 |
| MP3         | `mp3`      | `mp4a.69`        | Transcode to AAC (MP3-in-fMP4 not supported by Chrome MSE) |
| AC-3        | `ac3`      | `ac-3`           | Transcode to AAC       |
| E-AC-3      | `eac3`     | `ec-3`           | Transcode to AAC       |
| DTS         | `dts`      | `dtsc`           | Transcode to AAC       |
| FLAC        | `flac`     | `flac`           | Transcode to AAC       |
| Opus        | `opus`     | `opus`           | Transcode to AAC       |

## Transcode Details

Audio codecs that can't be played natively in MSE/fMP4 are transcoded on-the-fly using ffmpeg.wasm (audio-only build, ~1.8 MB):

- **Input formats**: ac3, eac3, dts, mp3, flac, opus (via ogg)
- **Output**: AAC stereo, 160 kbps, ADTS framing
- **Command**: `ffmpeg -f {sourceCodec} -i input -c:a aac -ac 2 -b:a 160k -f adts output.aac`

## Notes

- Browser playback uses `MediaSource.isTypeSupported()` for runtime detection — VP9, AV1, and HEVC support varies by browser/platform.
- Passthrough/native playback and remuxed HLS/MSE playback are separate checks. A codec may be acceptable for direct file playback but still be forced through AAC transcode in the remux pipeline.
- AC-3 and E-AC-3 are treated as pipeline-unsafe even when a browser reports MSE support. The source file itself may still play fine via native passthrough in Chrome and Safari on macOS; the issue we observed was specific to the remuxed HLS/fMP4 path, where Safari produced audible stalls around scene cuts while Chrome continued to play correctly. The pipeline therefore transcodes those codecs to AAC for HLS/MSE playback.
- Node/test environment uses a conservative whitelist: only AAC/MP3 audio and AVC/HEVC video are considered natively playable.
- Unknown codecs default to requiring transcode (safe fallback).
