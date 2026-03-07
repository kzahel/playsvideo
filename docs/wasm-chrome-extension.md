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

3. **Bypass the Worker — load Emscripten directly on the main thread.** Instead of using `@ffmpeg/ffmpeg` (which wraps ffmpeg-core in a Worker), import the `createFFmpegCore` Emscripten module directly and call `exec()`, `FS.writeFile()`, `FS.readFile()` on the main thread. No Worker = no CSP propagation issue.

## Current approach

playsvideo uses option 3. `WasmFfmpegRunner` in `src/adapters/wasm-ffmpeg.ts` loads the vendored Emscripten `createFFmpegCore` module directly, bypassing the `@ffmpeg/ffmpeg` npm package entirely. The `@ffmpeg/ffmpeg` dependency has been removed.

### What changed

`@ffmpeg/ffmpeg`'s `FFmpeg` class is a thin wrapper that spawns a Web Worker and proxies every call (`exec`, `writeFile`, `readFile`, `deleteFile`) through `postMessage`. This Worker is redundant in both playsvideo code paths:

- **`worker.ts`** — already a Web Worker; `@ffmpeg/ffmpeg` created a Worker-inside-a-Worker
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

### Limitation

`exec()` is synchronous (blocks the calling thread). This is fine inside `worker.ts` but means the `loadSource()` main-thread path blocks briefly during transcode. For future parallel segment transcoding, a Worker pool with separate `createFFmpegCore` instances per Worker would be needed — but those Workers would face the same CSP limitation in Chrome extensions.
