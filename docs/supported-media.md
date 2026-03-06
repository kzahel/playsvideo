# Supported Media

## Video Codecs

| Codec | Short Name | MSE Codec String     | Playback |
|-------|------------|----------------------|----------|
| H.264 | `avc`     | `avc1.640028`        | Native (all browsers) |
| H.265 | `hevc`    | `hev1.1.6.L93.B0`   | Chrome, Edge, Safari (hardware-dependent). Not in Chromium or Firefox. |
| VP9   | `vp9`     | `vp09.00.10.08`      | Chrome, Chromium, Edge, Firefox. Not in Safari. |
| AV1   | `av1`     | `av01.0.01M.08`      | Chrome, Edge, Firefox. Not in Safari (older). |

## Audio Codecs

| Codec       | Short Name | MSE Codec String | Playback              |
|-------------|------------|------------------|-----------------------|
| AAC         | `aac`      | `mp4a.40.2`      | Native                |
| MP3         | `mp3`      | `mp4a.69`        | Native                |
| AC-3        | `ac3`      | `ac-3`           | Transcode to AAC      |
| E-AC-3      | `eac3`     | `ec-3`           | Transcode to AAC      |
| DTS         | `dts`      | `dtsc`           | Transcode to AAC      |
| FLAC        | `flac`     | `flac`           | Transcode to AAC      |
| Opus        | `opus`     | `opus`           | Transcode to AAC      |

## Transcode Details

Audio codecs that can't be played natively in MSE/fMP4 are transcoded on-the-fly using ffmpeg.wasm (audio-only build, ~1.5 MB):

- **Input formats**: ac3, eac3, dts, mp3, flac, opus (via ogg)
- **Output**: AAC stereo, 160 kbps, ADTS framing
- **Command**: `ffmpeg -f {sourceCodec} -i input -c:a aac -ac 2 -b:a 160k -f adts output.aac`

## Notes

- Browser playback uses `MediaSource.isTypeSupported()` for runtime detection — VP9, AV1, and HEVC support varies by browser/platform.
- Node/test environment uses a conservative whitelist: only AAC/MP3 audio and AVC/HEVC video are considered natively playable.
- Unknown codecs default to requiring transcode (safe fallback).
