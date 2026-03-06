# playsvideo

Client-side video player — play any video file in the browser without a server.

## Green Gates

Before considering work done, all of these must pass:

```bash
npm run typecheck    # tsc --noEmit
npm run test:unit    # vitest run tests/unit (fast, no fixtures needed)
npm run lint         # biome lint .
npm run format       # biome format --write . (then verify no unstaged changes)
```

Integration tests (`npm run test:integration`) require test fixtures in `tests/fixtures/`.

## Project Structure

- `src/pipeline/` — core pipeline modules (demux, mux, segment plan, audio transcode, codec probe)
- `src/adapters/` — platform adapters (node-ffmpeg, node-ffprobe, wasm-ffmpeg)
- `src/engine.ts` — PlaysVideoEngine class (worker, hls.js, subtitles — no UI)
- `src/worker.ts` — browser web worker (demux + segment processing)
- `src/main.ts` — browser entry point (thin UI wiring to engine)
- `tests/unit/` — fast unit tests (no external dependencies)
- `tests/integration/` — tests requiring ffmpeg/ffprobe and test fixtures
- `tests/e2e/` — playwright browser tests

## Deploy

Site is hosted on Cloudflare R2 + Workers at playsvideo.com.

```bash
npm run deploy:site    # vite build + upload dist/ to R2
npm run deploy:worker  # deploy Cloudflare Worker (serves files from R2)
npm run deploy         # both
```

- `scripts/deploy.sh` — uploads built files to R2 bucket with correct content types
- `worker/index.js` — Cloudflare Worker that serves files from R2, sets COOP/COEP headers (required for SharedArrayBuffer/ffmpeg.wasm), and handles caching (no-cache for HTML/SW/manifest, immutable for hashed assets)

## Key Conventions

- TypeScript with ES modules (`.js` extensions in imports)
- Biome for formatting and linting (not ESLint/Prettier)
- vitest for testing
- No ffmpeg for full-file operations — only small MEMFS segment operations
- mediabunny for demux and mux (fMP4)
