# Source Contract

The `Source` is the integration point for external consumers. It provides byte-level reads from any backing store — local file, torrent pieces, HTTP ranges, etc. Playsvideo doesn't know or care where bytes come from.

## Interface

mediabunny defines the base `Source` class. Consumers subclass it and implement `_read`:

```typescript
_read(start: number, end: number, signal?: AbortSignal): ReadResult | Promise<ReadResult> | null
```

### Return values

- **`ReadResult`** — data available synchronously (e.g., local file, cached range)
- **`Promise<ReadResult>`** — data coming asynchronously (e.g., torrent pieces being downloaded, HTTP fetch in progress)
- **`null`** — data not available and won't become available (used during progressive parsing — mediabunny backs off gracefully)

### AbortSignal

When hls.js aborts an in-flight segment request (e.g., user seeks), playsvideo creates a new `AbortController` and passes the signal through to `_read()`. The Source should:

1. Listen on `signal.addEventListener('abort', ...)`
2. Reject the pending Promise with `new DOMException('Aborted', 'AbortError')`
3. Clean up any resources associated with the read (e.g., deprioritize network requests)

Playsvideo's responsibility: pass the signal to `_read()`, catch `AbortError` rejections, discard any in-flight results.

The Source's responsibility: react to the signal. What "react" means is Source-specific — playsvideo doesn't dictate cleanup behavior.

### Pipeline abort behavior

- **Waiting on Source**: signal fires → Promise rejects → playsvideo discards
- **Demuxing**: fast, let it finish, discard result if aborted
- **Transcoding (ffmpeg.wasm)**: can't cancel mid-operation, let it finish, discard result

## Built-in Sources

- **`BlobSource`** — browser `File`/`Blob`. Always returns data synchronously or as a fast Promise. Signal is largely irrelevant.
- **`FilePathSource`** — Node.js file path. Same — local I/O, always fast.

## External Sources (not implemented yet)

### JSTorrent TorrentSource

First planned external consumer. See [jstorrent/docs/plans/on-demand-streaming.md](https://github.com/nicl/jstorrent) for full design.

- `_read` maps byte ranges to torrent pieces
- Returns data immediately if pieces are downloaded
- Returns a Promise that resolves when pieces arrive (torrent engine prioritizes and downloads them)
- On abort: deprioritizes those pieces and rejects the Promise
- Null return used during progressive container parsing (moov/Cues discovery) when pieces haven't arrived yet

```typescript
_read(start, end, signal) {
  const pieces = this.piecesForRange(start, end)
  this.prioritize(pieces)

  signal?.addEventListener('abort', () => {
    this.deprioritize(pieces)
  })

  return new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'))
    })
    this.onPiecesReady(pieces, () => {
      resolve(this.readBytes(start, end))
    })
  })
}
```

## What playsvideo must guarantee

1. Always pass `AbortSignal` through to `_read()` when processing segments
2. Handle `Promise<ReadResult>` — don't assume reads are synchronous
3. Catch `AbortError` rejections without treating them as fatal errors
4. Handle `null` returns gracefully (back off, don't retry in a tight loop)
