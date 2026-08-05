# 000: Focused Media Discovery

Status: complete

Topic: `filesystem-scanning-and-reconciliation`

## Goal

Let an episode player discover a newly completed next episode when the page is
opened or refreshed, provided its configured directory is already readable,
without running a full authoritative library reconciliation or interrupting
playback.

## Scope

- Derive a deterministic filesystem subtree from the current episode and
  known catalog siblings.
- Enumerate that subtree with a fixed entry budget and no permission prompt.
- Admit only playable files matching the current series identity.
- Upsert only new or materially changed catalog rows.
- Coalesce duplicate requests and throttle repeated scans in one app session.
- Recompute player navigation through the existing live catalog query.

## Non-goals

- Do not watch the filesystem continuously.
- Do not infer deletion or mark unseen entries missing from partial evidence.
- Do not run TMDB enrichment, full alias backfill, thumbnails, or handoff
  reconciliation during focused discovery.
- Do not make player startup depend on scan success.
- Do not request filesystem permission without a user gesture.
- Do not replace manual or detail-page full reconciliation.

## Architecture

Focused discovery is a separate semantic operation from full reconciliation:

```text
Player entry + known catalog
  -> pure series identity and scope plan
  -> provider subtree enumeration with entry budget
  -> pure focused catalog mutation plan
  -> additions/changes-only transaction
  -> Dexie live query recomputes Previous / Next
```

Full reconciliation remains authoritative for absence. It scans the configured
directory, refreshes observation timestamps, marks unseen rows missing, and
runs post-scan enrichment and reconciliation.

The filesystem provider now collects video metadata and JSTorrent manifests in
one deterministically ordered traversal rather than walking the same tree twice.
Focused traversal processes at most 2,000 entries from its planned subtree.

The scope planner uses known directories for the same series. A single normal
directory stays narrow; a season-like directory widens to its parent so a new
season sibling can be found; multiple known directories use their nearest
common ancestor.

## Safety Contracts

- A focused scan may add or update; it may never mark missing or delete.
- A known-incomplete JSTorrent file is not promoted as playable.
- A truncated scan may apply safe discoveries already observed, but absence
  remains meaningless.
- Permission denial and unsupported providers return a skipped outcome.
- Duplicate React effects share one in-flight operation.
- Focused and full scans serialize per configured directory.
- Non-permission failures remain isolated from playback.

## Implementation Slices

- [x] Pure series identity, path-scope planning, and coordinator
- [x] Provider-level deterministic bounded subtree enumeration
- [x] Pure focused catalog mutation planning
- [x] Player-mount integration
- [x] Unit and live-browser verification
- [x] Topic and execution-record update

## Acceptance Criteria

- Reloading a player with retained access starts focused discovery in the
  background.
- A newly completed matching next episode becomes eligible for navigation once
  its catalog row is discovered.
- Unrelated media under the scanned subtree is not added by the focused path.
- Known-incomplete and virtual-only torrent records remain ineligible.
- No row becomes missing because of focused discovery.
- Permission prompts never originate from player refresh.
- Full project gates pass and the live player route remains usable.

## Verification Record

Verified on 2026-08-05:

- Pure tests cover narrow, season-widened, and common-ancestor scopes;
  unsupported entries; in-flight coalescing; cooldown; and per-directory
  serialization.
- Pure reconciliation tests cover matching additions, unchanged-row elision,
  unrelated media, known-incomplete torrents with and without a visible
  manifest, missing-row restoration, and retained full-scan missing authority.
- The Player component test confirms that the current entry is passed to the
  focused-discovery lifecycle.
- All 258 unit tests, TypeScript typecheck, formatting, lint, library build, and
  production app build passed. Lint retains two pre-existing warnings outside
  this work.
- Reloading `https://localhost:9300/app/play/2` rendered the Video.js player and
  one Next Episode action with no browser console errors. The selected live
  file itself remained unavailable in the user's existing folder state; no
  filesystem fixture or user media was modified for validation.

## Result

The player now starts focused discovery on mount and reload. Successful catalog
upserts flow through the existing Dexie live query, so Previous/Next navigation
updates without coupling playback startup to scanning. Permission-required,
unsupported, throttled, and failed outcomes are non-destructive and silent.
