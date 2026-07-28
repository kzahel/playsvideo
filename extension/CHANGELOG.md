# Extension Changelog

All notable changes to the Chrome extension are documented here.

## [Unreleased]

### Changed

- Temporarily disabled and hid Video.js controls in favor of native browser controls to prevent detached players from continuing playback after switching modes.

### Added
- Full catalog, shows, movies, activity, devices, and settings routes
- Offline capability declaration

### Changed
- Autoplay next episode is enabled by default

### Fixed
- MV3 module service worker registration
- Extension CSP violations caused by inline theme initialization
- Extension startup device initialization
- Release-resolution tags being parsed as multi-episode ranges
- Autoplay skipping an episode during route transitions

## [0.1.0] - 2026-03-08

### Added
- External subtitle loading (.srt/.vtt)
- Passthrough playback for natively supported formats (skips pipeline)
- Action tooltip ("Open video player")

### Fixed
- Respect video autoplay attribute instead of always auto-playing

## [0.0.1] - 2026-03-07

### Added
- Initial Chrome extension build (MV3)
- Popup window player (no address bar, native feel)
- File input and drag-and-drop support
- File handlers for Chrome OS (mp4, mkv, webm, mov, avi, ts)
- Dark theme UI
