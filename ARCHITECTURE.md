# playsvideo

Play any video file in the browser. No server, no pre-transcoding.

## Lessons learned

- **ffmpeg.wasm WORKERFS is unusable** — Blob.slice() per read call costs ~ms each on Chrome. Copy-mode remux of 12.7s segment took 19s. Audio transcode adds only 1-2s on top — the I/O is the bottleneck, not the codec. (stupidplayer)
- **Manual MSE management is a bug factory** — timestampOffset, appendWindow, demand gating = 200+ lines of the buggiest code. Let hls.js handle it. (easyplay v1)
- **Timestamp continuity is the hard problem** — not demuxing, not muxing, not playback. Use integer sample counts in track timescale, never float seconds. (easyplay v2)
- **Test at the pipeline layer** — Node + ffprobe, not browser oracle tests. 74 tests in 4s vs 20min browser suite. (easyplay v2)

## Architecture

```
File (MKV/MP4/AVI/TS/WebM)
  │
  ▼
mediabunny demux (BlobSource / Node FileSource)
  ├─ Video packets ──────────────────────────┐
  └─ Audio packets                           │
      ├─ HLS-safe (AAC/MP3) ────────────────┐│
      └─ Needs transcode (AC3/DTS/FLAC)     ││
          │                                  ││
          ▼                                  ││
      ffmpeg.wasm (audio-only, ~1MB)         ││
      MEMFS in, MEMFS out (no WORKERFS)      ││
          │                                  ││
          ▼                                  ││
      AAC packets ──────────────────────────┐││
                                            │││
mediabunny fMP4 mux (onMoof/onMdat) ◄───────┘│
  │                                           │
  ▼                                           │
fMP4 segments + m3u8 playlist                 │
  │                                           │
  ▼                                           │
service worker segment cache ◄── fetch ── hls.js
                                            │
                                            ▼
                                        <video>
```

## Key components

### 1. Pipeline (Node-testable, no browser deps)
- `demux.ts` — mediabunny wrapper: file → packets with timestamps
- `mux.ts` — mediabunny fMP4 output: packets → init segment + media segments
- `playlist.ts` — m3u8 generation from segment metadata
- `audio-transcode.ts` — ffmpeg.wasm wrapper for AC3/DTS → AAC (MEMFS only)
- `segment-plan.ts` — keyframe index → segment boundaries

### 2. Browser glue
- `sw.js` — service worker: intercepts segment fetches, serves from cache
- `player.ts` — hls.js setup, event logging, error recovery
- `main.ts` — file picker → pipeline → playback

### 3. Tests (Node, fast)
- Segment validity: ffprobe each output segment
- Timeline continuity: tfdt values are monotonic, no gaps > 1 audio frame
- Audio transcode round-trip: AC3 in → AAC out, correct duration
- m3u8 correctness: parseable, durations match segments

## Design rules
- Integer sample counts in track timescale for all timestamp math
- Audio frames are never sliced — include whole frames, let MSE appendWindow trim
- mediabunny handles tfdt/trun — don't recompute
- ffmpeg.wasm only touches raw audio via MEMFS — never WORKERFS
- hls.js for playback — provides segment-level observability for debugging
- Pipeline functions are pure — testable without browser
