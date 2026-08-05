# 001: Adaptive Scan Scheduling

Status: complete

Topic: `filesystem-scanning-and-reconciliation`

## Goal

Discover an episode downloaded during a long playback session without making
the user reload, while avoiding fullscreen/background churn and redundant
catalog work after unchanged full scans.

## Scope

- Retry focused discovery when the window regains focus or the page becomes
  visible.
- Run a focused check every three minutes during active visible playback.
- Run one focused check after playback enters its final fifteen minutes.
- Retry after leaving fullscreen.
- Disable opportunistic triggers while the next episode is already known.
- Make full reconciliation persist and post-process only material catalog
  changes.

## Non-goals

- Do not add a filesystem watcher or service worker timer.
- Do not scan while the page is hidden or playback is fullscreen.
- Do not request filesystem permission from a background trigger.
- Do not make the complete filesystem walk itself incremental.
- Do not remove the directory-level successful-scan timestamp.

## Cost Model

Change-aware reconciliation does not add filesystem reads. A full scan already
loads file metadata, manifests, and catalog rows. The planner compares material
catalog fields in memory after matching. The comparison adds small linear CPU
work while eliminating unchanged catalog writes and reactive query churn.

Every successful full scan still updates `directories.lastScannedAt`. Unchanged
catalog rows retain their existing `updatedAt` and `lastSeenAt`; the directory
timestamp is the authoritative evidence that a no-op reconciliation completed.

## Safety Contracts

- Mount, focus, visibility, periodic, near-end, and fullscreen-exit requests
  reuse the existing focused-scan coordinator and entry budget.
- Periodic and near-end scans require active playback.
- All opportunistic scans require a visible, non-fullscreen document and an
  unknown next episode.
- A full scan remains authoritative for missing entries even when most rows
  are unchanged.
- Metadata refresh runs for new or materially changed present rows.
- Alias and pending-handoff reconciliation run whenever any catalog row
  materially changes.
- A true no-op scan performs only the directory timestamp write after the
  filesystem and catalog comparison.

## Implementation Checklist

- [x] Pure trigger policy for visibility, fullscreen, playback, and near-end
  state
- [x] Player lifecycle wiring for focus, visibility, periodic, near-end, and
  fullscreen-exit triggers
- [x] Pure material-change filtering for full reconciliation
- [x] No-op suppression for catalog writes and post-scan work
- [x] Focused unit coverage
- [x] Full project gates and final topic update

## Verification Record

Verified on 2026-08-05:

- Pure trigger tests cover next-episode suppression, hidden/fullscreen states,
  active-playback requirements, and the fifteen-minute boundary.
- Pure reconciliation tests cover identical scans, material file changes,
  newly missing rows, and rows that were already missing.
- The Player component test covers the discovery lifecycle inputs.
- All 266 unit tests, TypeScript typecheck, formatting, lint, library build, and
  production app build passed. Lint retains two pre-existing warnings outside
  this work.

## Result

The episode player now checks opportunistically without scanning during hidden
or fullscreen playback. Full reconciliation retains authoritative missing-file
semantics while a no-op result causes no catalog write or post-scan pass.
