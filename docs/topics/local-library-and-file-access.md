# Local Library and File Access

Topic: `local-library-and-file-access`

Status: durable catalog, Chromium handle persistence, cross-browser folder
fallback, offline extension playback, and local thumbnail generation are
implemented. Permission and cold-offline behavior still require platform-level
validation as browsers evolve.

## Scope

This topic owns local folder selection, permission recovery, directory walking,
scan reconciliation, file reacquisition for playback/subtitles, offline
availability, and the distinction between durable catalog data and ephemeral
file access.

Detailed scan modes, scope, concurrency, and mutation authority now live in
[filesystem scanning and reconciliation](filesystem-scanning-and-reconciliation.md).

It does not own codec compatibility or cross-device playback matching.

## Provider Boundary

All app code outside `app/src/folder-provider.ts` depends on `FolderProvider`
rather than calling browser-specific folder APIs directly. The contract covers:

- picking a folder;
- reporting whether a rescan can run now or needs a user gesture;
- rescanning one stored directory;
- bounded discovery inside a stored directory without prompting for access;
- reacquiring the `File` for a catalog entry;
- listing sibling subtitle files.

The Chromium provider uses `showDirectoryPicker()` and stores the resulting
`FileSystemDirectoryHandle` in Dexie. The handle can survive page reloads, but
permission is a separate browser decision. Permission requests are made only
when a caller explicitly opts into a user-gesture path; background checks do
not cause permission prompts.

The fallback provider uses `<input webkitdirectory>`. It persists catalog and
directory descriptions but retains actual `File` objects only in memory. A new
page session therefore requires the user to select the folder again.

The extension can retain multiple chosen directories. The normal website and
the fallback provider replace the current directory selection when a new folder
is chosen.

## Permission and Availability States

The provider reports:

- `ready` when all stored handles are immediately readable;
- `needs-user-gesture` when handles or a fallback directory exist but access
  must be reacquired;
- `unavailable` when no usable stored directory exists.

For Chromium, a persisted handle does not imply persisted permission. Validated
behavior currently includes:

- the ChromeOS MV3 extension retaining access after the user chooses
  **Allow on every visit**;
- installed desktop Chrome PWA offering persistent access;
- ordinary website/mobile flows potentially requiring a new grant each
  session;
- non-File-System-Access browsers requiring a folder repick.

Treat these as measured product behavior, not an everlasting browser guarantee.
Update the platform matrix in
[`file-system-access-persistence.md`](../file-system-access-persistence.md) when
new validation changes it.

No filesystem path or handle is synced to another device.

## Scan and Catalog Contracts

A scan walks video files recursively and also reads matching hidden JSTorrent
manifest files. It parses filename metadata, then reconciles scanned records
against the durable `catalog` table.

Normal scan rules are:

- a matched file keeps its stable `catalog.id` and updates file facts in place
  only when material catalog fields changed;
- a new file creates a new catalog row;
- an unseen prior row becomes `availability = missing` instead of being
  deleted;
- removing a configured folder marks its catalog rows missing before deleting
  the directory record;
- metadata, playback history, aliases, thumbnails, hashes, and torrent identity
  are not erased merely because a file is absent;
- manifest-only torrent entries may exist as present catalog records with
  `hasLocalFile = false` until their file becomes available.

Local scan matching is distinct from cross-device playback identity. Current
matching evidence includes torrent identity, content hash, exact directory/path,
and file facts such as name, size, and modification time. The scan chooses and
persists a current canonical playback key but then backfills all known aliases.

After the catalog transaction, a scan refreshes optional metadata, backfills
aliases, and reconciles pending handoffs when the catalog changes. A successful
no-op full scan updates only the configured directory's `lastScannedAt`.

## Playback and Subtitle Reacquisition

The catalog stores descriptions, not live `File` objects. Before playback, the
provider resolves the stored directory and path back to a fresh `File`. This
also lets the engine recover from a stale Blob by refreshing the file without
discarding the segment plan.

Sibling `.srt` and `.vtt` candidates are enumerated through the same provider
boundary. Lack of current permission results in no automatic sibling
attachment; the app must regain access through a user-visible flow.

The player is never allowed to treat a missing or manifest-only catalog row as
locally playable simply because the catalog record still exists.

## Offline and Derived Assets

The MV3 extension is the strongest offline surface: its UI, audio ffmpeg.wasm,
catalog, playback state, persisted handles, and locally generated thumbnails
can all operate without a server after permissions are retained.

Local thumbnail generation runs through a dedicated worker, one decode job at
a time, and stores WebP blobs in `thumbnailCache`. Cache identity changes when
the source file facts or generator version change. Work pauses for playback,
survives interruption, and records bounded failures rather than retrying in a
loop.

On 2026-07-28, all 141 files in the Chromebook validation library generated
thumbnails with zero failures; reload preserved the exact cache contents and
playback paused/resumed generation correctly. Extension close/reopen, reload,
retained permission, and offline playback were also verified.

## Known Gaps and Next Work

1. Run the cold offline boot, profile unlock, extension launch, and playback
   test on the actual travel/family Chromebook.
2. Validate thumbnail persistence after reboot and Wi-Fi-off launch, plus
   single-file mutation invalidation and corrupt/unsupported-file failure.
3. Keep the permission matrix current across ChromeOS, desktop PWA/site,
   mobile Chrome, Firefox, and Safari.
4. Add integration coverage around directory removal, permission loss, folder
   repick, renamed files, and manifest-only to local-file transitions.
5. Decide explicit product semantics for permanently deleting a catalog item;
   ordinary missing scans must not become implicit deletion.
6. Keep any native-wrapper filesystem work behind `FolderProvider` rather than
   leaking platform APIs into scan and player code.

## Code and Documentation Map

- `app/src/folder-provider.ts` — browser capability boundary and file access.
- `app/src/scan.ts` — catalog reconciliation and post-scan work.
- `app/src/catalog-match.ts` — pure local matching.
- `app/src/db.ts` — directory, catalog, thumbnail, alias, and handoff storage.
- `app/src/hooks/useFilesystemRescan.ts` — user-visible rescan lifecycle.
- `app/src/thumbnails/` and `app/src/thumbnail-worker.ts` — derived image cache.
- [`app-architecture.md`](../app-architecture.md) — broader ownership/data flow.
- [`data-model-separation.md`](../data-model-separation.md) — durable catalog
  rationale.
- [`chromebook-offline-kids-plan.md`](../chromebook-offline-kids-plan.md) —
  hardware evidence and remaining travel workflow.
