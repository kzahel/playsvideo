# Subtitle Extraction and Progressive Streaming Notes

This document records current findings about embedded subtitle extraction, especially for progressive or torrent-backed playback. It is intentionally a notes document, not a committed design.

## Current behavior

Embedded subtitle extraction is eager today.

- Worker-backed file/URL playback requests all embedded subtitle tracks once playback is ready.
- Source-backed playback also extracts all embedded subtitle tracks once the source pipeline is ready.
- Extraction walks the full subtitle track cue-by-cue and converts the result to WebVTT before attaching it as a `<track>`.

Relevant code paths:

- [`src/engine.ts`](../src/engine.ts): requests embedded subtitle extraction after ready
- [`src/pipeline/subtitle.ts`](../src/pipeline/subtitle.ts): `extractSubtitleData()` iterates `for await (const cue of track.getCues())`
- [`src/worker.ts`](../src/worker.ts): worker subtitle extraction path

## Important distinction: `loadFile` vs `loadSource`

There are two materially different input paths.

### `loadFile(file)`

The normal app/library flow gets a browser `File` from the File System Access API and passes it to `loadFile(file)`.

- This ends up using `BlobSource`.
- `BlobSource` assumes the browser file is readable as a normal blob.
- There is no explicit concept of "this byte range is not downloaded yet but may arrive later".

Implication: if a file in `~/Downloads/JSTorrent` is still incomplete in a torrent sense, the current `loadFile` path is not obviously progressive-aware. It operates on whatever bytes and size the browser exposes via `File`.

### `loadSource(source)`

There is a separate source-based path intended for future external sources such as a torrent-aware source.

- The source contract explicitly allows `_read()` to return a `Promise` while data arrives.
- The contract also allows `null` during progressive parsing so the demuxer can back off.

Implication: progressive/torrent-aware behavior is possible in the source path, but that does not automatically make eager subtitle extraction a good idea.

## Why subtitle extraction is currently slow

The current implementation does too much small-step work.

- Subtitle extraction iterates one cue at a time.
- For MP4 `tx3g` subtitles, `mediabunny` walks sample-by-sample.
- Each sample read goes through async slice lookup instead of a bulk subtitle-track read.
- Playsvideo then allocates intermediate arrays multiple times before generating final WebVTT text.

This likely means wall-clock time is dominated by repeated async sample retrieval plus object/string churn, not by any explicit `setTimeout()` pacing.

## Observed local-file layout

Inspection of local MP4 files in `~/Downloads/JSTorrent` showed that subtitle packets can be distributed across essentially the entire file.

Observed with `ffprobe`:

- Subtitle codec: `mov_text` / `tx3g`
- Example: one movie file
  - file size: `1,239,184,690`
  - subtitle packets: `1490`
  - first subtitle packet position: `2173`
  - last subtitle packet position: `1,235,564,258`
  - packet positions span `99.71%` of the file

Pack-level summary for the inspected files:

- several inspected files had the last subtitle packet at roughly `99.6%` to `99.8%` of file size
- across that sample, subtitle packet positions consistently spanned nearly the full file

Important nuance:

- This does not prove that every MP4 subtitle track is always interleaved across the whole file.
- It does show that some local files are laid out that way in practice.
- For these files, extracting the entire embedded subtitle track up front means touching ranges across nearly the whole file.

## Risks for progressive or torrent-backed playback

### Risk 1: eager full-track extraction is hostile to torrent piece locality

If the underlying source is piece-aware, full embedded subtitle extraction may still trigger reads across most of the file just to prepare subtitles.

That is bad for:

- startup latency
- piece prioritization
- mobile power use
- avoiding waste when the user never turns subtitles on

### Risk 2: `loadFile(File)` may not reflect torrent incompleteness correctly

If playback uses the normal `File` path instead of a custom progressive `Source`, subtitle extraction may simply assume the file is fully available.

Possible failure modes:

- long stalls
- reads against incomplete data
- misleading progress that is actually waiting on underlying filesystem/browser behavior
- subtle failures that do not look like explicit "range missing" errors

This needs direct validation if JSTorrent is expected to expose partially downloaded files through the normal browser `File` path.

### Risk 3: source-backed playback still eagerly extracts subtitles

Even the source pipeline currently calls embedded subtitle extraction once ready.

That means a future `TorrentSource` would still inherit the wrong behavior unless subtitle strategy changes.

### Risk 4: Chromecast is probably orthogonal here

The Chromecast `206` / range behavior is a separate issue from embedded subtitle extraction.

- Embedded subtitle extraction is currently done by playsvideo, not by Chromecast.
- So Chromecast should not be the direct cause of subtitle extraction stalls.
- However, a cast-specific playback path could still surface different failures if it changes which source path is used.

## Open questions

- When a partially downloaded JSTorrent file is opened via the browser `File` path, what exact semantics does `File.slice()` expose?
- Does the browser report final torrent size early, or only downloaded size?
- Are missing ranges zero-filled, unavailable, blocking, or treated as EOF?
- When subtitle extraction is slow on these files, how much is async read overhead vs allocation churn vs main-thread/worker contention?
- Would `mediabunny` be a better place to add bulk subtitle sample reads for `tx3g`?

## Candidate mitigations

### Lowest-risk product fix

Do not eagerly extract embedded subtitles on ready.

Instead:

- expose embedded subtitle track metadata immediately
- extract only when the user enables a subtitle track

This avoids wasting work for users who never turn subtitles on.

### Better streaming fix

Make subtitle extraction time-local rather than full-track upfront.

Ideas:

- request only subtitle data around current playback time
- extend the window as playback advances
- treat subtitles more like segment-driven data than static preload data

### Better parser fix

Avoid one-sample-at-a-time reads for MP4 `tx3g`.

Ideas:

- read subtitle sample table metadata once
- coalesce nearby subtitle sample ranges into larger reads
- decode many cues from one larger buffer

### Performance cleanup even without streaming changes

- reduce intermediate cue-array allocations
- avoid rebuilding equivalent cue structures multiple times
- reuse `TextDecoder` instances in hot paths

## Recommended revisit order

1. Validate actual JSTorrent `File` semantics for incomplete downloads.
2. Stop eager embedded subtitle extraction.
3. Re-measure local-file subtitle extraction latency.
4. Design progressive subtitle loading for source-backed playback.
5. Consider `mediabunny` changes if bulk subtitle reading is needed.
