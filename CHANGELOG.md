# playsvideo

All notable changes to playsvideo are documented here.

## [Unreleased]

## [0.3.0] - 2026-03-08

### Added
- External subtitle loading API (`loadExternalSubtitle`, `clearExternalSubtitles`)
- Segment state tracking (`segmentstatechange` event, `segmentStates` getter)
- Worker state tracking (`workerstatechange` event, `transcodeWorkerStates` getter)
- `bindExternalSubtitlePicker` UI helper for file-based subtitle loading

### Fixed
- HLS error events now include underlying error detail

## [0.2.1] - 2026-03-07

### Fixed
- Fix app player restarting video every 5 seconds
- Fix worker files missing from production builds
- Separate site and lib build outputs so they don't clobber each other

## [0.2.0] - 2026-03-07

### Changed
- Drop `@ffmpeg/ffmpeg` dependency — load Emscripten `createFFmpegCore` directly for smaller bundle and simpler integration
- Relax worker serialization for segment processing (concurrent non-transcode segments)
- Add internal transcode worker pool for parallel audio transcode operations

### Fixed
- Fix playback for videos with non-zero initial video timestamp

## [0.1.0] - 2026-03-07

### Added
- `WasmFfmpegRunner` and `FfmpegRunner` type exported from package
- `loadSource()` auto-creates `WasmFfmpegRunner` when no ffmpeg instance provided — audio transcoding works out of the box for npm consumers
- Audio-only ffmpeg.wasm bundle (1.7 MB) included in npm package

### Changed
- Replaced Vite-specific `?url` imports with universal `new URL(..., import.meta.url)` pattern for bundler compatibility
- Disabled full ffmpeg tier (32 MB) — only audio transcode is currently supported

## [0.0.10] - 2026-03-07

### Fixed
- Prevent bundlers from statically resolving worker URL (allows `loadSource()` consumers to avoid bundling worker.js)

## [0.0.9] - 2026-03-07

### Added
- Export `Source` type from mediabunny

### Fixed
- Fix Worker URL extension (`.ts` → `.js`) for built library output

## [0.0.8] - 2026-03-07

### Fixed
- Fix npm publish CI: add `attestations: write` permission, upgrade npm for OIDC, add `repository` to package.json

## [0.0.7] - 2026-03-07

### Fixed
- Fix npm publish CI by adding `--provenance` flag for OIDC trusted publishing

## [0.0.6] - 2026-03-07

### Added
- `engine.video` is now a public readonly property (was private)
- Export `SubtitleTrackInfo` type from package

### Changed
- Engine API docs rewritten to clarify relationship with native `<video>` element

## [0.0.5] - 2026-03-06

### Added
- `loadUrl(url)` method — play video from an HTTP URL using range requests (no full download)
- Engine API documentation (`docs/engine-api.md`)

### Changed
- README library example simplified to show both `loadFile` and `loadUrl`

## [0.0.4] - 2026-03-06

### Fixed
- Move ffmpeg-dependent ADTS parse test from unit to integration tests (fixes CI failure)

## [0.0.3] - 2026-03-06

### Fixed
- README wordmark images now use absolute URLs (fixes broken images on npmjs.com)

## [0.0.2] - 2026-03-06

### Added
- npm package setup (`import { PlaysVideoEngine } from 'playsvideo'`)
- GitHub Actions CI with OIDC trusted publishing
- Changelog-driven release process (`scripts/release.sh`)
- MIT license

### Changed
- README rewritten as marketing page with light/dark wordmark

## [0.0.1] - 2026-03-06

### Added
- Initial pipeline: demux, keyframe indexing, segment planning, fMP4 muxing, HLS playback
- Audio transcode (AC-3, E-AC-3, DTS, FLAC, Opus → AAC) via ffmpeg.wasm
- Subtitle extraction (SRT, ASS/SSA → WebVTT)
- Codec probe for browser-specific passthrough vs transcode decisions
- PWA player with drag-and-drop file loading
- Cloudflare R2 + Workers deployment

<!--
## Template

### Added
- New features

### Changed
- Changes to existing features

### Fixed
- Bug fixes
-->
