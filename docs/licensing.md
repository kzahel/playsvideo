# Licensing

playsvideo is MIT-licensed. Our source code contains no copyleft code.

## Dependencies

| Dependency | License | Copyleft? | Notes |
|---|---|---|---|
| mediabunny | MPL-2.0 | File-level only | Our fork is public. Files that *import* mediabunny are unaffected. |
| hls.js | Apache-2.0 | No | |
| @ffmpeg/ffmpeg | MIT | No | JS wrapper only |
| ffmpeg-core.wasm | LGPL-2.1 | Library-level | Two builds (audio-only ~1.5 MB, full ~32 MB) loaded adaptively at runtime as separate .wasm files. Users can substitute them, satisfying LGPL relinkability. |

## Why not GPL?

Both ffmpeg.wasm builds use **only native ffmpeg codecs** (all LGPL):

- **Audio-only build** (~1.5 MB): ac3, eac3, dca decoders + aac encoder. Custom build via `ffmpegbuild/Dockerfile.ffmpeg-audio`.
- **Full build** (~32 MB): stock `@ffmpeg/core@0.12.10` with all native codecs. Loaded adaptively when the audio build can't handle a codec.

No GPL-licensed external libraries (x264, x265, libfdk-aac) are compiled into either build. Video is never re-encoded (remux only), and the native AAC encoder handles audio transcode.

If the build ever switches to include GPL codecs, the entire project would need to be relicensed to GPL.

## Compliance

- Modified mediabunny files stay MPL-2.0 (fork is public on GitHub)
- ffmpeg-core.wasm is dynamically loaded, not bundled into JS — LGPL relinkability satisfied
- See [THIRD_PARTY_LICENSES](../THIRD_PARTY_LICENSES) for full license texts
