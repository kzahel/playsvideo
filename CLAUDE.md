# playsvideo

Client-side video player — play any video file in the browser without a server.

Do NOT use auto-memory (`~/.claude/projects/.../memory/`). All project context lives in this file.

## Package Manager

Uses **pnpm workspaces**. The root package is the core library (`playsvideo`). The `app/` directory is a separate workspace for the React media player.

```bash
pnpm install           # install all workspace deps
pnpm -w run <script>   # run a root workspace script
pnpm --filter app dev  # run the media player dev server
```

## Green Gates

Before considering work done, all of these must pass:

```bash
pnpm -w run typecheck    # tsc --noEmit
pnpm -w run test:unit    # vitest run tests/unit (fast, no fixtures needed)
pnpm -w run lint         # biome lint .
pnpm -w run format       # biome format --write . (then verify no unstaged changes)
```

Integration tests (`pnpm -w run test:integration`) require test fixtures in `tests/fixtures/`.

## Project Structure

- `src/pipeline/` — core pipeline modules (demux, mux, segment plan, audio transcode, codec probe)
- `src/adapters/` — platform adapters (node-ffmpeg, node-ffprobe, wasm-ffmpeg)
- `src/engine.ts` — PlaysVideoEngine class (worker, hls.js, subtitles — no UI)
- `src/worker.ts` — browser web worker (demux + segment processing)
- `src/pwa-player.ts` — browser entry point (thin UI wiring to engine)
- `tests/unit/` — fast unit tests (no external dependencies)
- `tests/integration/` — tests requiring ffmpeg/ffprobe and test fixtures
- `tests/e2e/` — playwright browser tests
- `app/` — React media player (separate workspace, see below)

### Media Player App (`app/`)

React app with library management at `/app`. Separate workspace with its own `package.json`, `vite.config.ts`, `tsconfig.json`.

- `app/src/db.ts` — Dexie IndexedDB schema (library, directories, playlists, settings)
- `app/src/scan.ts` — File System Access API directory walker + IDB sync
- `app/src/hooks/useEngine.ts` — React hook wrapping PlaysVideoEngine lifecycle
- `app/src/pages/Library.tsx` — video library grid with folder picker
- `app/src/pages/Player.tsx` — video player page
- Uses `import { PlaysVideoEngine } from 'playsvideo'` via workspace link

## Key Conventions

- TypeScript with ES modules (`.js` extensions in imports)
- Biome for formatting and linting (not ESLint/Prettier)
- vitest for testing
- mediabunny for demux and mux (fMP4)
- hls.js for playback (custom `fLoader` for on-demand segments — no service worker)

## Architecture

### ffmpeg.wasm
- ONLY for small MEMFS segment operations. NEVER for full-file operations (WORKERFS is catastrophically slow, MEMFS can't hold large files). Do not use ffmpeg for subtitle extraction or any task requiring full file access.
- Two bundles: `src/vendor/ffmpeg-core-audio/` (1.5MB, audio-only) and `src/vendor/ffmpeg-core/` (31MB, full)
- Audio transcode works now; video transcode planned (hardware decode scenarios)
- Lazy-load only when transcode is actually needed

### Audio Transcode
- Source packets → concatenate raw bitstream → ffmpeg → parse ADTS output → EncodedPackets
- `ffmpeg -f {sourceCodec} -i input -c:a aac -ac 2 -b:a 160k -f adts output.aac`
- `sourceCodec` from `TranscodeOptions.sourceCodec`: ac3, eac3, dts, mp3, flac, opus
- Codec probe (`audioNeedsTranscode`) decides passthrough vs transcode per platform

### Browser Worker
- Worker keeps demux handle open, processes segments on-demand when hls.js requests them
- `FfmpegRunner` interface abstracts node:fs vs MEMFS
- Concurrent ffmpeg.wasm calls are serialized (shared MEMFS corruption)

### mediabunny
- `kzahel/mediabunny#integration` fork — merges upstream CTS fix (PR #317) with subtitle support (PR #166)
- Source at `~/code/references/mediabunny`
- Key: `collectPacketsInRange` needs `{ startFromKeyframe: true }` for video
- API: `EncodedVideoPacketSource.add(packet, { decoderConfig })`, `Mp4OutputFormat({ fastStart: 'fragmented', onMoov, onMoof, onMdat })`, `NullTarget` with callbacks for streaming

### Segment Plan
- Our plan may differ from ffmpeg's segment count by 1–2 segments (ffmpeg's fMP4 init extraction absorbs keyframe cuts). This is cosmetic and does not affect playback.

## Release Process

Changelog-driven releases. The changelog entry must exist before the release script will run.

### Steps

1. Add entry to `CHANGELOG.md` under `## [x.y.z]` (move items from `[Unreleased]`)
2. Commit the changelog update
3. Run: `bash scripts/release.sh x.y.z`
   - Validates version format and clean working tree
   - Requires matching `## [x.y.z]` in CHANGELOG.md
   - Runs green gates + lib build
   - Updates package.json version, commits, creates `vx.y.z` tag
4. Push: `git push && git push origin vx.y.z`
5. CI picks up the tag → runs gates → publishes to npm → creates GitHub Release with changelog notes

### Files

| File | Purpose |
|------|---------|
| `CHANGELOG.md` | Keep a Changelog format, required before release |
| `scripts/release.sh` | Version bump, validation, commit, tag |
| `.github/workflows/publish.yml` | CI: tag push → npm publish + GitHub Release |

### npm package

- Entry: `import { PlaysVideoEngine } from 'playsvideo'`
- Lib build: `pnpm -w run build:lib` (tsc via `tsconfig.lib.json`, excludes Vite-specific files and `src/app/`)
- Trusted publishing via OIDC (`id-token: write`) — no npm token needed, configure on npmjs.com package settings

## Deploy

Site is hosted on Cloudflare R2 + Workers at playsvideo.com.

```bash
pnpm -w run deploy:site    # vite build + upload dist/ to R2
pnpm -w run deploy:worker  # deploy Cloudflare Worker (serves files from R2)
pnpm -w run deploy         # both
```

- `scripts/deploy.sh` — uploads built files to R2 bucket with correct content types
- `worker/index.js` — Cloudflare Worker that serves files from R2 and handles caching (no-cache for HTML/SW/manifest, immutable for hashed assets). No COOP/COEP headers needed (see `docs/no-shared-array-buffer.md`)

## Rebuilding ffmpeg.wasm (audio-only)

The audio-only bundle is built via Docker on the desktop machine. To rebuild after changing `ffmpegbuild/Dockerfile.ffmpeg-audio`:

```bash
# 1. Commit and push changes (Dockerfile changes must be on remote)
git push

# 2. Build on desktop (has Docker) — pulls, builds, copies to vendor dir
ssh desktop "cd ~/code/playsvideo && git pull && bash ffmpegbuild/build.sh"

# 3. Copy built files back
scp desktop:~/code/playsvideo/ffmpegbuild/out/ffmpeg-core.js \
    desktop:~/code/playsvideo/ffmpegbuild/out/ffmpeg-core.wasm \
    src/vendor/ffmpeg-core-audio/
```

Build config: `ffmpegbuild/Dockerfile.ffmpeg-audio` (decoders, encoders, filters, etc.)

## Reference Code

- ffmpeg source: `~/code/references/ffmpeg` (key file: `libavformat/hlsenc.c`)
- mediafox (wiedymi's player): `~/code/references/mediafox`
