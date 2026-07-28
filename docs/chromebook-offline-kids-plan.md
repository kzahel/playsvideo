# Chromebook Offline Kids Media Plan

Last reviewed: 2026-07-28

## Purpose

Make the PlaysVideo Chrome extension a reliable, child-friendly offline media
library for a Chromebook. The immediate test library is Bluey, but the product
work should remain generic.

This document is the engineering plan and implementation-status record. The
machine-specific deployment runbook, current media inventory, Pi source paths,
and ChromeOS testbed commands live in:

```text
~/code/dotfiles/projects/playsvideo-chromebook-offline-media.md
```

## Verified baseline

| Area | Current state |
|---|---|
| Offline architecture | Chrome extension reading a user-selected local folder |
| Test library | 141 Bluey episodes copied to the developer Chromebook and verified against the Pi |
| Folder access | Retained across extension close/reopen and reload after choosing **Allow on every visit** |
| Offline launch | Extension UI and local playback verified after a real offline reload |
| Playback | Native Chrome controls, resume, next-episode autoplay, and season-boundary autoplay verified |
| Video.js | Disabled globally and hidden because switching control implementations can leave a detached video playing |
| Reboot automation | Root SSH returns automatically; the profile still requires login |
| Profile login | `bin/chromeos login` successfully unlocked the current test device and `doctor` confirmed an active user session |
| Distribution | A Chrome Web Store listing exists at version 0.1.0; the source manifest is 0.4.7 |

The highest-value remaining device check is a cold offline boot, profile unlock,
extension launch, and playback test on the actual family/travel Chromebook.

## Pending threads

| Priority | Thread | Status | Next outcome |
|---|---|---|---|
| P0 | Episode thumbnails | Stage A implemented and hardware validated | Finish edge-case checks, then evaluate show-level intro detection |
| P1 | TMDB in the extension | Diagnosed, not fixed | Bundle a working public application credential and verify Bluey metadata on ChromeOS |
| P1 | Kid-sized catalog UI | Partially present | A true large-card mode with large touch targets and readable episode labels |
| P1 | Sidebar behavior | Not implemented | Keep navigation visible when the window has room; use a drawer only on small screens |
| P1 | Signed-out navigation | Not implemented | Local Activity works without an account; hide or explain account-only destinations |
| P1 | TMDB retention | Not implemented | Refresh normally and hard-expire TMDB-derived content before six months |
| P1 | Travel Chromebook deployment | Not started | Install media and extension, retain folder permission, pass cold offline test |
| P2 | Extension update | Not released | Version, package, upload, and validate a Web Store update |
| P2 | Versioned fallback build | Not implemented | Keep a known-good zip/directory for manual unpacked installation |
| P2 | ChromeOS login CLI | Implemented and manually verified, but currently uncommitted in a dirty `chromeos-testbed` tree | Isolate, test, and commit the login/testbed changes |
| Deferred | Video.js lifecycle repair | Disabled | Revisit only after the native-controls travel build is stable |

## 1. Thumbnail workstream

This is the next implementation focus. It must not depend on TMDB being fixed
and must never delay folder scanning or video playback.

### Desired behavior

- Every local episode eventually has a useful 16:9 thumbnail.
- Thumbnail work runs in the background with one decode job at a time.
- The catalog becomes usable immediately; thumbnails fill in progressively.
- Generation pauses while a video is playing and resumes later.
- Closing the extension can interrupt the work safely. Missing work is derived
  again on the next launch.
- Generated thumbnails survive close/reopen, extension reload, reboot, and
  offline use.
- A bad or unsupported file records a bounded failure and does not create a
  retry loop.

### Source priority

The final resolver should use:

1. A downloaded, unexpired TMDB episode still when one is available.
2. A locally generated frame from the episode.
3. Series artwork.
4. The existing initials/text fallback.

The first implementation slice should build the local generation path. That
keeps the feature independent of network access and fixes the offline case
immediately. TMDB episode stills can then be added as a preferred source without
changing the UI contract.

Merely storing a TMDB image URL is not sufficient for offline use. If TMDB art
is used, its bytes need an explicit local cache record and expiration timestamp.

### Proposed data model

Add a dedicated Dexie table rather than putting image blobs directly on catalog
rows:

```text
thumbnailCache
  key                 stable file/version identity
  catalogId
  source              "local-video" | "tmdb"
  blob                WebP or JPEG
  width
  height
  selectedTimestampSec
  createdAt
  expiresAt?          required for TMDB, absent for local-video
  generatorVersion
  status              "ready" | "failed"
  retryAfter?
  debugReason?
```

The local cache key should change when the file changes. Use directory identity,
path, size, and `lastModified`, or a content hash when one already exists.
`generatorVersion` permits regenerating thumbnails after the selection
algorithm improves.

Object URLs created from stored blobs must be revoked when components unmount or
replace the image.

### Worker design

Use a dedicated thumbnail Web Worker owned by the extension/app UI:

- The UI obtains the `File` through the existing folder provider after folder
  permission has already been granted.
- The worker receives one file and a small set of candidate timestamps.
- Mediabunny's `CanvasSink` uses WebCodecs and yields `OffscreenCanvas` frames in
  a worker. Request a small output such as 320×180 with `fit: "cover"`.
- Encode the selected frame with `OffscreenCanvas.convertToBlob()`.
- Return the blob and selection diagnostics to the UI for IndexedDB storage.
- Run only one worker job concurrently and give playback priority over
  thumbnail work.

Bluey's H.264 video is compatible with this path on the test Chromebook. If
WebCodecs cannot decode a different file, record the failure and retain the
series/text fallback. A hidden player or remux-based fallback can be considered
later; it should not complicate the first version.

### Frame selection

Build this in two stages.

#### Stage A: deterministic useful frame

Ship the end-to-end worker, cache, and UI path using several inexpensive
candidate timestamps:

- Stay away from time zero and the closing credits.
- Sample a few early candidates based on both duration and bounded absolute
  times.
- Reject nearly black frames, fades, and very low-detail frames.
- Prefer a stable frame immediately after a strong visual change.

This is intentionally simpler than automatic intro detection. It establishes
that decoding, persistence, invalidation, and UI rendering are reliable on
ChromeOS.

Stage A was implemented and validated on the physical test Chromebook on
2026-07-28:

- all 141 Bluey episodes produced ready local-video thumbnails with zero
  failures;
- the 141 cached WebP blobs occupied 1,804,674 bytes in IndexedDB;
- navigating to playback held the cache count steady, and returning to the
  catalog resumed the queue to completion;
- a full unpacked-extension unload/reload preserved the exact record count,
  creation timestamps, and byte total without regeneration;
- a visual sample spanning all three seasons avoided black frames, opening title
  cards, and closing credits.

The remaining Stage A device checks are reboot and Wi-Fi-off persistence, actual
single-file mutation invalidation, and a corrupt/unsupported-file bounded
failure. Cache-key invalidation and black/low-detail frame rejection have unit
coverage.

#### Stage B: show-level intro detection

Improve selection for episodic TV by detecting a shared opening across several
episodes in the same show:

1. Sample low-resolution frames from the opening portion of three to five
   episodes.
2. Compute perceptual hashes or compact color signatures.
3. Find the opening sequence shared by a majority of those episodes, allowing
   small encoding differences.
4. Cache the estimated intro end against the show key and detector version.
5. In each episode, find the first strong cut after that point and choose a
   stable frame shortly after the cut.
6. Fall back to Stage A when the show has too few episodes or no repeatable
   opening.

Validate the detector against Bluey before making it the default. Record the
chosen timestamp and reason so incorrect thumbnails are debuggable.

### UI integration

The thumbnail resolver should be shared by:

- catalog entries;
- TV episode rows;
- local Activity entries;
- future large kid-mode cards.

Current “card view” is not a large card grid. It is a compact row with a 48×32
image. Thumbnail plumbing should work there first, but the later kid UI should
render substantially larger versions from the same cached blob.

### Cache lifecycle

- Local-video thumbnails are derived from the user's files and may remain until
  the file is removed or changes.
- TMDB metadata and downloaded TMDB image bytes should refresh normally at the
  existing short TTLs and be purged before six months. A 150-day hard retention
  limit gives comfortable margin.
- Filename parsing and local-video thumbnails are not TMDB content and do not
  use the TMDB retention limit.
- Orphaned thumbnail records should be removed after the corresponding catalog
  entry is permanently removed.

### Thumbnail acceptance checks

1. A fresh scan displays the catalog before thumbnail generation completes.
2. All 141 Bluey files eventually receive a thumbnail or a recorded bounded
   failure.
3. Thumbnail jobs never run more than one decode concurrently.
4. Starting playback pauses or deprioritizes generation and playback remains
   smooth.
5. Close/reopen resumes missing work without regenerating completed records.
6. Reload and reboot preserve generated images.
7. Wi-Fi-off launch renders local thumbnails.
8. Changing a file invalidates only that file's local thumbnail.
9. A corrupt/unsupported file does not spin or block the remaining queue.
10. A visual sample from every Bluey season avoids black frames, opening title
    cards, and closing credits.

## 2. TMDB diagnosis and follow-up

The current primary token is valid. A direct authenticated request for TMDB's
Bluey record succeeded on 2026-07-28, so token revocation is not the extension
failure.

The credential is also not checked into the repository:

- only `app/.env.example` is tracked;
- `app/.env.local` is intentionally ignored;
- the current token literal does not occur in current tracked files or any
  reachable Git history.

The website build runs from `app/`, so Vite reads `app/.env.local`. The extension
build uses the root `vite.config.extension.ts`, does not set `envDir`, and
therefore does not read that file. The extension release workflow also supplies
neither TMDB environment variable. A freshly built extension consequently has
no bundled primary or standby credential.

The credential model has another confusing behavior: for each slot, the bundled
runtime token currently wins and the UI-entered token is only a fallback, even
though the UI calls it an override.

Follow-up:

1. Set the extension build's environment directory explicitly.
2. Supply the public primary credential to release builds and optionally a
   public standby credential.
3. Make UI-entered credentials genuine overrides, or rename/remove those
   controls.
4. Test the background metadata bridge on the Chromebook with Bluey.
5. Add the 150-day hard purge for TMDB records and cached image bytes.
6. Put the required TMDB logo and notice in an About/Credits surface.

This should follow the first local-thumbnail slice rather than block it.

## 3. Kid-oriented UI

An existing persistent toggle switches between compact card rows and a denser
table/list. Neither mode is designed for a six-year-old in a moving car.

Add a third, truly large card mode:

- default to it in the extension when a local media library is present;
- use a responsive two- or three-column grid on the Chromebook tablet;
- use large 16:9 episode thumbnails and at least 44×44 CSS-pixel targets;
- make the episode number and useful title readable without exposing filenames;
- keep progress and watched state visually obvious;
- avoid small icon-only controls for primary actions.

The sidebar currently starts closed at every width. On a sufficiently wide
window it should be pinned open and reserve layout space. On small widths it can
remain a hamburger-controlled overlay.

Signed-out navigation should degrade cleanly:

- Activity should load local IndexedDB history first and optionally merge
  cross-device history after sign-in.
- Activity currently contains local-merge code, but exits before using it when
  no user is signed in.
- Activity grouping also currently discards entries without a TMDB identity; it
  needs a filename/catalog-derived local grouping fallback.
- Devices is genuinely cross-device and can be hidden or clearly marked as
  account-only while signed out.
- Shows and Movies already derive groups from local filename parsing, so they
  should remain useful without TMDB or sign-in.

## 4. Packaging, publication, and deployment

A packaging/release path exists:

```bash
pnpm -w run build:extension
bash scripts/release-extension.sh <version>
```

The release script runs the green gates, builds, updates the manifest, commits,
and tags. The tag workflow creates a versioned GitHub release zip. It does not
upload to the Chrome Web Store automatically.

As of this review:

- the public Web Store listing is still 0.1.0;
- the repository manifest is 0.4.7;
- only `extension-v0.1.0` exists as a release tag;
- the native-controls and offline-reliability commits are local and have not
  yet been pushed to `origin/main`;
- the extension changelog still groups the newer work under `Unreleased`.

Before publishing:

1. Complete the thumbnail slice and minimum kid UI fixes.
2. Fix and validate bundled TMDB credentials.
3. Update privacy disclosure if TMDB title lookups or Firebase behavior changes
   what the Web Store listing currently claims.
4. Create a dated changelog section and choose the release version.
5. Run the green gates and Chromebook offline checklist.
6. Push the code and release tag.
7. Upload the resulting package to the existing Web Store listing.
8. Keep the same package as the known-good unpacked fallback.

The family Chromebook is not in ChromeOS Developer Mode, but the
`chrome://extensions` Developer mode toggle can still load an unpacked build
unless device policy prohibits it. Prefer the Web Store build; retain the
unpacked procedure as the deadline fallback.

## 5. Deferred Video.js work

Keep `VIDEOJS_CONTROLS_ENABLED` false for the travel release. The native control
path has been tested and avoids the phantom background-player failure.

If custom controls return later, require a lifecycle-focused test that switches
control implementations repeatedly, navigates away during playback, and proves
that exactly one video element exists and no detached media continues playing.

## Recommended execution order

1. Add thumbnail storage, worker generation, and current-row rendering.
2. Validate generation and persistence using the 141-file Bluey corpus.
3. Add intro-aware frame selection and regenerate test thumbnails.
4. Repair the extension TMDB build path and add TMDB-still resolution.
5. Implement the large kid card mode and responsive pinned sidebar.
6. Make Activity local-first and clean up signed-out navigation.
7. Add TMDB hard expiry and attribution UI.
8. Release and validate the Web Store update.
9. Deploy to the family Chromebook and pass the cold offline checklist.
