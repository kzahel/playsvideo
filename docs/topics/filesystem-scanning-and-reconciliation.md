# Filesystem Scanning and Reconciliation

Topic: `filesystem-scanning-and-reconciliation`

Status: focused player discovery and full authoritative reconciliation are
implemented; broader triggers and large-library evidence remain open.

## Scope

This topic owns when PlaysVideo inspects configured directories, how scan scope
is chosen, which observations may mutate the catalog, concurrency and budget
rules, and the distinction between partial discovery and authoritative full
reconciliation.

Filesystem capability storage and permission recovery remain in
[local library and file access](local-library-and-file-access.md). Filename and
cross-device media identity remain in
[metadata and media identity](metadata-and-media-identity.md).

## Scan Semantics

PlaysVideo has two intentionally different operations:

- **Focused discovery** finds relevant additions or material changes from a
  bounded subtree. Partial evidence can never prove absence.
- **Full reconciliation** walks a complete configured directory, refreshes
  observed rows, marks unseen rows missing, and runs post-scan metadata, alias,
  and pending-handoff work.

Both operations require an existing configured directory. Background focused
discovery uses only already-granted access and never requests permission.
Manual reconciliation may request access because it begins with a user gesture.

Filesystem enumeration is a single deterministically ordered traversal that
collects video file metadata and JSTorrent manifests together. Focused scans
process at most 2,000 entries in the planned subtree. Full scans remain
unbounded because only they may draw conclusions about absence.

## Invariants

- Scans never delete playback history or catalog rows implicitly.
- Only a complete full reconciliation may mark a catalog entry missing.
- A bounded or truncated result can safely contribute additions and changes.
- Known-incomplete JSTorrent files are not treated as playable discoveries.
- Player rendering and playback do not wait for background discovery.
- Repeated requests for the same scope are coalesced and throttled.
- Focused and full scans for one configured directory are serialized so stale
  snapshots cannot race catalog writes.
- Scope, filtering, and catalog mutation decisions are pure functions with
  deterministic unit coverage.

## Current Trigger Model

- Folder selection and the header Rescan action run full reconciliation.
- TV-show and movie detail pages may run full reconciliation on mount when the
  setting is enabled and access is already granted.
- Episode-player mount will run focused discovery for its current series and
  configured directory.

There is no continuous filesystem watcher. Further triggers such as window
focus or a final end-of-episode check require separate product decisions and
must reuse the same coordinator rather than creating component-local scans.

## Evidence

Pure unit coverage owns scope selection, additions-only mutation rules,
known-incomplete torrent safety, full-reconciliation authority, request
coalescing, cooldown, and per-directory serialization. The 2026-08-05 green
run passed all 258 unit tests and both builds. A signed-in localhost player
reload retained its Next Episode action without browser console errors.

## Code and Documentation Map

- `app/src/scanning/focused-discovery.ts` — pure identity, scope, coordinator,
  and outcome contracts.
- `app/src/scanning/scan-coordinator.ts` — per-directory scan serialization.
- `app/src/scanning/catalog-reconciliation.ts` — pure scanned-record and
  catalog-mutation planning.
- `app/src/folder-provider.ts` — complete and bounded filesystem enumeration.
- `app/src/scan.ts` — persistence and post-scan orchestration.
- `app/src/hooks/useFocusedMediaDiscovery.ts` — player-facing lifecycle.
- [`000-focused-media-discovery.md`](../tactical/000-focused-media-discovery.md)
  — bounded implementation record.

## Known Gaps and Next Work

- Validate discovery across same-season, new-season, root-level, extension
  multi-folder, and retained-permission layouts.
- Decide whether a missing next episode should trigger one final discovery when
  playback ends.
- Consider a throttled window-focus trigger for downloads completed while the
  player remains mounted.
- Measure large-library enumeration and tune the deterministic entry budget
  from evidence.
- Make full reconciliation change-aware and avoid post-scan work when the
  catalog did not materially change.
- Serialize folder replacement and removal with scans that target the same
  configured directory.
- Add an end-to-end filesystem fixture that completes a JSTorrent download
  between player loads and verifies that the next episode appears.
- If manifests can live above the selected focused subtree, define a stable
  completion signal for previously unknown in-progress torrent files.
