# Extension Changelog

All notable changes to the Chrome extension are documented here.

## [Unreleased]

## [0.5.0] - 2026-07-28

### Added

- A full offline media catalog with persistent folders, grouped shows and
  movies, activity, devices, and settings.
- Persistent episode-specific thumbnails generated locally with WebCodecs and
  stored in IndexedDB for offline use.
- A child-friendly large-card catalog with 16:9 thumbnails, plain-language
  episode labels, playback progress, and preserved compact-row and sortable-list
  layouts.
- Resume, previous/next episode navigation, and next-episode autoplay.
- Embedded and sibling subtitle discovery with improved language labels and
  extraction progress.
- Optional sign-in and per-device playback-history synchronization.
- Offline capability declaration.

### Changed

- Enabled next-episode autoplay by default.
- Use native browser video controls while the Video.js lifecycle path remains
  disabled, preventing detached players from continuing after navigation or a
  control-mode change.
- Reworked scanning and playback state around durable catalog rows and retained
  folder access.

### Fixed

- MV3 module service worker registration and extension CSP violations.
- Offline startup, device initialization, and route handling.
- Resume-position, next-episode, and player teardown races.
- Release-resolution tags being parsed as multi-episode ranges.
- Sparse MKV cue handling and playback gaps around segment boundaries.

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
