# WebAssembly in Chrome Extensions (Manifest V3)

Chrome MV3 extensions block `WebAssembly.instantiate()` by default. The CSP directive `'wasm-unsafe-eval'` permits it:

```json
"content_security_policy": {
  "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
}
```

## The Worker problem

`@ffmpeg/ffmpeg` always spawns an internal Web Worker (`type: "module"`) to run the WASM. Chrome does not propagate the extension's `wasm-unsafe-eval` CSP to Workers created by extension pages. The WASM instantiation inside the Worker is blocked even though the manifest CSP is correct.

References:
- [ffmpeg.wasm MV3 discussion](https://github.com/ffmpegwasm/ffmpeg.wasm/discussions/260)
- [Chromium bug #1173354](https://bugs.chromium.org/p/chromium/issues/detail?id=1173354)

## Workaround options

1. **`chrome.offscreen` API** — create an offscreen document with its own CSP that allows WASM. The ffmpeg Worker runs inside this document. Adds complexity (message passing to/from offscreen doc).

2. **Sandbox page** — use a sandboxed extension page with a more permissive CSP:
   ```json
   "sandbox": {
     "pages": ["sandbox.html"]
   },
   "content_security_policy": {
     "sandbox": "sandbox allow-scripts; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval';"
   }
   ```
   Requires iframe communication between main page and sandbox.

3. **Bypass the internal ffmpeg Worker — load Emscripten directly in the current JS context.** Instead of using `@ffmpeg/ffmpeg` (which wraps ffmpeg-core in a Worker), import the `createFFmpegCore` Emscripten module directly and call `exec()`, `FS.writeFile()`, `FS.readFile()` in whatever context already exists (main thread or our own top-level Worker). This avoids the nested Worker that MV3 blocks.

## Current approach

playsvideo uses option 3. `WasmFfmpegRunner` in `src/adapters/wasm-ffmpeg.ts` loads the vendored Emscripten `createFFmpegCore` module directly, bypassing the `@ffmpeg/ffmpeg` npm package entirely. The `@ffmpeg/ffmpeg` dependency has been removed.

### What changed

`@ffmpeg/ffmpeg`'s `FFmpeg` class is a thin wrapper that spawns a Web Worker and proxies every call (`exec`, `writeFile`, `readFile`, `deleteFile`) through `postMessage`. This Worker is redundant in both playsvideo code paths:

- **`worker.ts`** — already a top-level Web Worker created by the engine; `@ffmpeg/ffmpeg` created a nested Worker-inside-a-Worker
- **`loadSource()` (main thread)** — segment audio transcodes complete in milliseconds, so the brief synchronous block is acceptable

The rewrite calls the Emscripten module API directly:

| `@ffmpeg/ffmpeg` (removed) | Direct Emscripten (current) |
|---|---|
| `ff.writeFile(name, data)` | `core.FS.writeFile(name, data)` |
| `ff.readFile(name)` | `core.FS.readFile(name)` |
| `ff.deleteFile(name)` | `core.FS.unlink(name)` |
| `ff.exec(args)` (async, via Worker) | `core.exec(...args)` (sync) |
| `ff.on('log', handler)` | `core.setLogger(fn)` |
| `ff.terminate()` | Not needed (no Worker to kill) |

`core.reset()` is called after each `exec()` to clear the return code and timeout — this is all it does (it does NOT clear MEMFS; files are cleaned up explicitly).

### What this does and does not block

`exec()` is synchronous (blocks the calling thread). This is fine inside `worker.ts` but means the `loadSource()` main-thread path blocks briefly during transcode.

Important distinction:

- **Blocked by MV3 CSP:** letting ffmpeg spawn its own internal Worker from inside our page/Worker context
- **Not inherently blocked:** loading Emscripten directly inside a top-level Worker that we create ourselves

`worker.ts` already proves that the second pattern works in playsvideo: the top-level pipeline Worker can load and run the vendored ffmpeg core directly. The current bottleneck is therefore not "extensions cannot run wasm in Workers at all"; it is that playsvideo currently routes all segment work through **one** coordinator Worker with **one** shared ffmpeg instance.

## Current parallelism bottlenecks

These are the reasons segment processing is still effectively serialized today:

1. `src/worker.ts` chains every `segment` request behind one global `processingChain`.
2. `src/worker.ts` keeps one shared `WasmFfmpegRunner` instance for all segments.
3. `src/pipeline/audio-transcode.ts` uses fixed MEMFS names (`transcode-input.*`, `transcode-output.aac`), so overlapping jobs on one ffmpeg instance would collide.
4. `src/worker.ts` mutates shared `audioDecoderConfig` state after each segment, which makes out-of-order completion harder than it needs to be.
5. `WasmFfmpegRunner.run()` calls synchronous `core.exec(...)`, so one ffmpeg job blocks the entire Worker thread while it runs.

The main-thread HLS loader is already closer to what we want: `src/engine.ts` tracks pending segment requests by index and can handle multiple in-flight segment requests. The worker is the component forcing sequential execution.

## Recommended direction

For extension-safe parallelism, the clean design is:

1. Keep `src/worker.ts` as the **coordinator**:
   - demux once
   - build the segment plan once
   - collect packets for requested ranges
   - mux final fMP4 segments
   - own segment cache and cancellation bookkeeping
2. Add a small pool of **top-level transcode Workers**, each with its own `WasmFfmpegRunner` / ffmpeg core instance.
3. Create those pool Workers from the **main thread**, not from `worker.ts`.
   - This avoids the nested-Worker pattern that caused the original MV3 issue.
4. Connect the coordinator Worker to the transcode Workers with `MessageChannel` ports passed in during startup.
5. Send only audio transcode jobs across that boundary:
   - codec
   - sample rate
   - segment start time
   - concatenated encoded audio bytes
6. Return either:
   - raw AAC/ADTS bytes and let the coordinator parse frames, or
   - fully reconstructed AAC packets plus decoder config

This keeps demux/index state single-owned while allowing multiple ffmpeg executions to run on separate Worker threads.

## Lower-risk interim improvement

Before a full pool, there is a smaller step worth taking:

1. Remove the coarse `processingChain` lock for normal segment requests.
2. Freeze the post-transcode audio decoder config at pipeline setup time (`mp4a.40.2`) instead of mutating shared state per segment.
3. Narrow serialization to an explicit ffmpeg critical section only.
4. Give each transcode job unique MEMFS filenames.

That will not make ffmpeg itself parallel inside one Worker, but it does let packet collection, cache lookup, cancellation, and mux work overlap better and removes architecture assumptions that currently block a proper pool.

## Practical implementation notes

- A pool size of `2` is the safest starting point. Audio transcode is usually faster than realtime already, and extra Workers multiply wasm memory usage.
- The same pattern can later be reused for the `loadSource()` path, but that path currently assumes a single abortable in-flight segment and would need separate cleanup.
- If direct top-level transcode Workers still hit a Chrome-extension-specific edge case, the fallback is to host the pool in an offscreen or sandbox page and keep the coordinator API the same.
