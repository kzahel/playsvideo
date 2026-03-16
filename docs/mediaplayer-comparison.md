# Competitive Analysis: playsvideo vs MediaPlayer

MediaPlayer ([Chrome Web Store](https://chromewebstore.google.com/detail/mediaplayer-video-and-aud/mgmhnaapafpejpkhdhijgkljhpcpecpj)) is the dominant browser-based media player extension with ~100K+ users. This document compares features and identifies gaps.

## Feature Comparison

### Playback Fundamentals

| Feature | playsvideo | MediaPlayer | Notes |
|---------|:----------:|:-----------:|-------|
| MP4/WebM playback | Yes | Yes | Both use native browser codecs |
| MKV playback | Yes (demux pipeline) | Partial | MP relies on browser; no demux fallback — fails silently on unsupported codecs |
| AVI playback | Yes | Limited | MP depends on browser support |
| AC3/EAC3 audio | Yes (transcode to AAC) | No | MP's #1 complaint: "MKV no audio". We solve this |
| DTS audio | Yes (transcode to AAC) | No | Same — our key differentiator |
| FLAC/Opus audio | Yes (transcode to AAC) | Browser-dependent | We always handle it |
| HEVC/H.265 | Browser-dependent | Browser-dependent | Neither transcodes video yet (on our roadmap) |
| Passthrough (zero-cost) | Yes (auto-detected) | Yes | Both avoid unnecessary processing when codecs are native |
| HLS streaming | Yes (internal) | No | Our pipeline produces HLS segments on-the-fly |

### Subtitle Support

| Feature | playsvideo | MediaPlayer | Notes |
|---------|:----------:|:-----------:|-------|
| External SRT | Yes | Yes | |
| External VTT | Yes | Yes | |
| External ASS/SSA | No (roadmap) | No | Neither supports styled ASS rendering |
| Embedded subtitle extraction | Yes | No | We extract subs from MKV/MP4 containers |
| Multiple subtitle tracks | Yes | No | We show all embedded tracks with switching |
| Auto-detect sibling subs | Yes | No | We find `video.en.srt` files in the same folder |
| Subtitle status/progress | Yes | No | Shows extraction phase, cue count, elapsed time |

### Player Controls & Polish

| Feature | playsvideo | MediaPlayer | Notes |
|---------|:----------:|:-----------:|-------|
| Play/Pause | Yes | Yes | |
| Seek bar | Yes | Yes | |
| Volume slider | Yes | Yes | |
| Mute toggle | Yes | Yes | |
| Fullscreen | Yes | Yes | |
| Picture-in-Picture | Yes (incl. Document PiP) | Yes | We support the newer Document PiP API |
| Playback speed | 0.25x–2x | 0.25x–4x | **Gap**: we cap at 2x, they go higher |
| Audio boost / amplifier | No | Yes (up to 6x) | **Gap**: Web Audio gain node, users love this |
| Screenshot capture | No | Yes | **Gap**: trivial to add, `canvas.drawImage()` |
| Loop / repeat | No | Yes | **Gap**: loop current file or playlist |
| A-B loop (segment repeat) | No | Yes | **Gap**: loop between two time points |
| Keyboard shortcuts | Basic (native) | Comprehensive | **Gap**: we rely on browser defaults, no overlay |
| Keyboard shortcut overlay | No | Yes (`?` key) | **Gap**: discoverability of shortcuts |
| Custom controls | Yes (overlay) | Yes | Both have custom overlay controls |
| Stock controls toggle | Yes | No | We can switch to native controls |
| Cursor auto-hide | Yes | Yes | Both hide cursor in fullscreen after idle |
| Seek preview thumbnails | No (roadmap) | No | Neither has this yet |

### Library & File Management

| Feature | playsvideo | MediaPlayer | Notes |
|---------|:----------:|:-----------:|-------|
| Folder scanning (File System Access) | Yes | No | **Advantage**: we scan and index entire folders |
| Multi-folder support | Yes | No | We manage multiple library folders |
| Watch state tracking | Yes (unwatched/in-progress/watched) | No | **Advantage**: progress badges on library cards |
| Resume playback | Yes (auto-save every 5s) | No | **Advantage**: picks up where you left off |
| Library grid with metadata | Yes | No | They have no library concept |
| TMDB metadata integration | Yes | No | **Advantage**: poster art, show info, episode data |
| Series/episode grouping | Yes | No | **Advantage**: auto-groups episodes, next-episode nav |
| TV show / movie detail pages | Yes | No | Full metadata pages with seasons and episodes |
| Search / filter / sort | No (roadmap) | No | |
| Playlists | No (roadmap) | Yes | **Gap**: they have queue/playlist, we don't yet |
| Recently played | No (roadmap) | Yes | **Gap**: quick access to recent files |
| Thumbnails in library | No (roadmap) | N/A | No library to compare against |

### File Input & Integration

| Feature | playsvideo | MediaPlayer | Notes |
|---------|:----------:|:-----------:|-------|
| Drag-and-drop files | Yes | Yes | |
| File picker | Yes | Yes | |
| ChromeOS file handler | Yes | Yes | Both register for video file types |
| Drop URL to play | No | Yes | **Gap**: we have `loadUrl()` in the engine but no UI |
| Context menu "Open with" | No | Yes | **Gap**: right-click integration |
| Share target (Android) | Yes | ? | We accept shares via PWA manifest |

### Audio-Only Features

| Feature | playsvideo | MediaPlayer | Notes |
|---------|:----------:|:-----------:|-------|
| Audio file playback | Yes | Yes | |
| Waveform / visualizer | No | Yes | **Gap**: they show audio waveform, nice visual |
| Equalizer | No | Yes | **Gap**: they have basic EQ presets |

### Cloud & Account

| Feature | playsvideo | MediaPlayer | Notes |
|---------|:----------:|:-----------:|-------|
| Cloud sync (watch progress) | Yes (Firebase) | No | **Advantage**: multi-device watch state |
| Google sign-in | Yes | No | |
| Settings sync | Via cloud | No | |

### Diagnostics & Developer

| Feature | playsvideo | MediaPlayer | Notes |
|---------|:----------:|:-----------:|-------|
| Copy diagnostics | Yes | No | **Advantage**: full playback state dump to clipboard |
| Segment state viewer | Yes | No | Shows per-segment processing status |
| Worker state viewer | Yes | No | Transcode worker pool monitoring |
| Codec path info | Yes | No | Source → output codec decision trace |

### Distribution & Discoverability

| Feature | playsvideo | MediaPlayer | Notes |
|---------|:----------:|:-----------:|-------|
| Chrome Web Store listing | Yes | Yes | Theirs has screenshots, description, 500K+ users |
| Store listing polish | Minimal | Well-optimized | **Gap**: we need screenshots, feature bullets, promo video |
| SEO landing pages | No | No | **Opportunity**: neither targets search queries |
| PWA file handling | Partial | No | Can register as OS-level file handler |
| npm library | Yes | No | **Advantage**: developers can embed our engine |

## Summary: Our Strengths

1. **Audio transcode pipeline** — AC3, DTS, EAC3 → AAC. This is the #1 pain point in MediaPlayer's reviews and we solve it.
2. **Embedded subtitle extraction** — we pull subs out of containers. They can't.
3. **Library management** — folder scanning, watch state, resume, TMDB metadata, series grouping. They're a single-file player.
4. **Cloud sync** — watch progress across devices.
5. **npm library** — embeddable engine for third-party apps.
6. **Diagnostics** — professional-grade debugging tools.

## Summary: Their Strengths (Our Gaps)

1. **Distribution** — 500K+ users. Polished store listing with screenshots and promo.
2. **Small polish features** — screenshot, audio boost, 4x speed, loop, A-B loop, keyboard overlay. Each is small to implement but collectively they make the player feel complete.
3. **Playlist / queue** — basic playlist support we don't have yet.
4. **Audio visualizer** — waveform display for audio files.
5. **Context menu integration** — right-click "Open with MediaPlayer".

## Priority Gaps to Close

These are high-impact, low-effort items that would close the perception gap:

| Gap | Effort | Impact | Notes |
|-----|--------|--------|-------|
| Screenshot button | ~1 hour | High | `canvas.drawImage(video)` → download PNG |
| Audio boost (gain node) | ~2 hours | High | Web Audio API, slider in overflow menu |
| Playback speed 3x/4x | ~15 min | Medium | Just add options to the speed submenu |
| Loop / repeat toggle | ~1 hour | Medium | Loop current file, button in controls |
| Keyboard shortcuts + overlay | ~3 hours | Medium | Define shortcuts, show on `?` press |
| Store listing screenshots | ~2 hours | Very High | Screenshots of MKV playback, subs, library |
| Drop URL to play | ~1 hour | Low | Wire existing `loadUrl()` to drag-and-drop |
| Context menu "Open with" | ~1 hour | Medium | Chrome extension `contextMenus` API |
