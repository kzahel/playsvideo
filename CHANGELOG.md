# playsvideo

All notable changes to playsvideo are documented here.

## [Unreleased]

### Added
- npm package setup (`import { PlaysVideoEngine } from 'playsvideo'`)
- GitHub Actions CI for npm publish on release
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
