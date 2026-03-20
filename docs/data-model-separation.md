# Data Model Separation

## Goal

Treat the app as a durable media catalog, not a transient file scan.

If a local file disappears because the user deleted it, moved it, or freed disk space, that should not erase:

- watch history
- playback history
- metadata
- content hashes
- torrent identity
- the fact that this media item existed in the catalog

The catalog should outlive any one scan result.

## What We Want

1. Stable local IDs for routing and UI
2. Per-device playback history stored as separate facts
3. Sync that copies facts between devices instead of reconciling mutable rows
4. Scan behavior that marks items missing instead of deleting them
5. TMDB as enhancement only, never a requirement for the app to function
6. A design that is easy to test in isolation

We do not need backwards compatibility for this phase. It is acceptable to reset IndexedDB and rebuild on a cleaner schema.

## Implemented So Far

Phases 1 through 7 are now implemented in the codebase.

What exists today:

- `catalog` is the durable media table
- scan reconciles into `catalog` and marks unseen items as `missing`
- `playback` stores local per-device playback state
- `remotePlayback` caches playback facts pulled from other devices
- sync pushes local `playback` facts and does not merge remote state into local media rows
- player resume/save behavior uses `catalogId -> canonicalPlaybackKey -> playback`
- catalog, movie, and TV pages derive local progress from `catalog + playback`
- the old `library` table has been removed

## Problem With The Previous Model

Previously one `LibraryEntry` row tried to serve too many roles at once:

- scan result
- local playback state
- remote sync merge target
- metadata container
- torrent state container
- UI view model

That makes the row fragile. Multiple writers update it for unrelated reasons, and scan currently deletes and recreates rows while manually preserving fields from the old row.

This creates a brittle system:

- scan must know which playback fields to preserve
- sync must know which local fields it is allowed to overwrite
- UI reads depend on fields whose ownership is unclear
- a new field can be lost unless every write path preserves it correctly

The real issue is not just “missing a field during rescan.” The issue is that storage ownership is unclear.

## Core Design Principles

### 1. Separate identity by purpose

We need two identities, not one:

- `catalogId`: stable local identity for routes, UI, and local joins
- `playbackKey`: cross-device identity for relating playback facts across devices

These should not be the same thing.

`catalogId` should be stable once created. It does not need to mean anything outside the local database.

`playbackKey` is only for cross-device playback matching. It can be best-effort, and it can improve over time as stronger identity becomes available.

### 2. Store facts, not reconciled rows

Each table should have a clear owner:

- scan owns catalog presence and file attributes
- metadata enrichment owns metadata fields
- player owns local playback events
- sync owns copying playback facts between devices

No writer should need to preserve another writer's fields.

### 3. Missing is not deleted

A normal rescan should not remove catalog rows just because a file is absent.

Instead:

- present locally: mark available
- not found locally: mark missing

That preserves history and metadata. Actual deletion should be an explicit product decision, not an incidental side effect of scan.

### 4. TMDB is optional

The app must still work if TMDB is disabled, rate-limited, or never configured.

That means:

- local cataloging must work without TMDB
- local playback must work without TMDB
- local routing must work without TMDB
- cross-device playback matching should still have a non-TMDB fallback

TMDB can improve identity and presentation, but it cannot be foundational to basic behavior.

## Proposed Data Model

### `catalog`

The durable local media catalog.

One row represents one locally known media item. This row persists even if the local file later disappears.

Suggested fields:

| Field | Purpose |
|-------|---------|
| `id` | stable local primary key |
| `createdAt` | when this catalog row was first created |
| `updatedAt` | last catalog-level update |
| `name` | display/file name |
| `path` | most recent known path |
| `directoryId` | last known directory source |
| `size` | most recent known size |
| `lastModified` | most recent known mtime |
| `availability` | `present` or `missing` |
| `lastSeenAt` | last successful scan that saw this item |
| `firstMissingAt` | when it first became missing |
| `detectedMediaType` | local parser output |
| `parsedTitle`, `parsedYear` | local parser output |
| `seasonNumber`, `episodeNumber`, `endingEpisodeNumber` | local parser output |
| `seriesMetadataKey`, `movieMetadataKey` | metadata enrichment output |
| `contentHash` | stronger local identity when available |
| `torrentInfoHash`, `torrentFileIndex`, `torrentMagnetUrl`, `torrentComplete` | torrent identity/state |
| `canonicalPlaybackKey` | persisted current best playback key |

Important properties:

- `id` is for local stability only
- scan updates rows in place when it can match them
- rows are not removed during ordinary rescans
- metadata and hashes remain attached even after files are missing
- this is the long-term replacement for `library`

### `playback`

Per-device playback facts.

This table stores only the local device's playback state.

Suggested fields:

| Field | Purpose |
|-------|---------|
| `playbackKey` | cross-device identity |
| `deviceId` | local device id |
| `positionSec` | last known position |
| `durationSec` | last known duration |
| `watchState` | `unwatched`, `in-progress`, `watched` |
| `lastPlayedAt` | last playback event timestamp |
| `updatedAt` | row update timestamp |

Primary key can be `[deviceId+playbackKey]`.

This table does not care whether the media is currently present locally.

### `remotePlayback`

Cached playback facts from other devices.

Suggested fields:

| Field | Purpose |
|-------|---------|
| `playbackKey` | cross-device identity |
| `deviceId` | remote device id |
| `deviceLabel` | display label |
| `positionSec` | remote last known position |
| `durationSec` | remote duration |
| `watchState` | remote watch state |
| `lastPlayedAt` | remote playback timestamp |
| `title` | display fallback from sync doc |
| `updatedAt` | when cache was refreshed |

This is read-only from the app's perspective except for sync refreshes.

### `library` status

`library` is now a temporary compatibility table only.

It is scheduled for removal.

It should not gain new responsibilities.
It should not be treated as durable truth.
It should remain, at most, a short-lived projection while the remaining read paths move to `catalog`.

### Optional: `catalogAliases`

If we want key upgrades to be explicit instead of destructive, add an alias table:

| Field | Purpose |
|-------|---------|
| `catalogId` | local catalog row |
| `playbackKey` | known key for this catalog item |
| `source` | `file`, `hash`, `torrent`, `tmdb` |
| `createdAt` | first seen |

This lets one catalog item accumulate multiple known identities over time.

That may be cleaner than rewriting `playbackKey` rows in place whenever identity improves.

## Identity Strategy

### Stable local identity: `catalogId`

The local app should route by `catalogId`.

Examples:

- `/play/:catalogId`
- sidebar links
- local joins between catalog and UI state

This gives us stable local behavior even if cross-device identity is weak or unavailable.

If we later add shareable or cross-device locator URLs, they should be alternate resolver entrypoints that map to a local catalog row. They should not replace `catalogId` as the primary local route.

### Cross-device identity: `playbackKey`

`playbackKey` should be persisted, not recomputed ad hoc in every read path.

Priority can still be:

1. torrent identity
2. content hash
3. TMDB identity
4. weak file fallback

But this must be treated carefully:

- weak keys are best-effort only
- TMDB-based upgrades should not break local routing
- changes to duration or metadata should not silently orphan playback state

That means the current fallback strategy is too fragile if it includes mutable fields like duration.

A better rule is:

- compute a candidate key
- persist it onto the catalog row as `canonicalPlaybackKey`
- if a stronger key becomes available later, migrate deliberately or add an alias

Do not make cross-device identity depend on volatile playback-derived fields.

## Scan Semantics

Scan should update catalog presence, not rebuild the world.

### On scan match

If a scanned file matches an existing catalog row:

- keep the same `catalogId`
- update path/size/mtime/availability
- update parsed media fields if needed
- preserve metadata, hashes, and history

### On new file

If no catalog row matches:

- create a new row
- assign new `catalogId`
- mark `availability = present`

### On missing file

If an existing catalog row is not seen in the latest scan:

- do not delete it
- mark `availability = missing`
- set `firstMissingAt` if not already set

This supports the product model where watched items remain in the catalog after local deletion.

### Matching rules

Matching should be explicit and tested. Likely priority:

1. torrent identity
2. content hash
3. exact path match
4. file fingerprint fallback like `name + size + lastModified`

This is separate from cross-device playback identity. It is local scan matching.

## Playback And Sync Semantics

### Local playback writes

The player writes only to local `playback`.

It does not write into `catalog` except possibly for harmless catalog facts like cached duration if we decide that belongs there.

### Sync push

Sync push reads local `playback` rows for `thisDevice` and uploads them as that device's playback facts.

If display metadata is needed in the sync doc, push can join `playback` back to `catalog` by `playbackKey` or alias.

### Sync pull

Sync pull reads all device docs and writes them into `remotePlayback`.

It does not merge remote state into local `playback`.
It does not overwrite `catalog`.

### Resume behavior

Resume is a UI policy built on top of facts:

1. check local `playback` for this device
2. optionally inspect `remotePlayback` for other devices
3. choose most recent or prompt the user

This keeps sync deterministic:

- sync copies facts
- UI chooses behavior

## Why We Should Avoid Deletion Propagation

“Deletion propagation” would mean a file disappearing from one device or one scan causes that media item to be deleted or hidden globally.

That does not match the desired product behavior.

In this app:

- file presence is local
- playback history is global per device
- metadata is durable
- absence from a scan is not a global delete event

So ordinary scans should never produce cross-device deletion semantics.

If we ever want true delete behavior later, it should be explicit and user-driven, like:

- remove this catalog item permanently
- clear playback history
- forget metadata

That is a different feature from scan.

## Refactor Direction

Since we are fine with wiping old IndexedDB state, the cleanest path is not a compatibility migration. It is a schema reset and code simplification.

### Phase 1: Define the new schema

Create clean Dexie tables for:

- `catalog`
- `playback`
- `remotePlayback`
- optionally `catalogAliases`

Also introduce explicit types for:

- catalog row
- playback row
- remote playback row
- scan match result
- playback key candidate

Do this before changing UI code.

### Phase 2: Isolate pure logic

Move core logic into pure modules with no Dexie calls:

- `catalog-match.ts`
- `playback-key.ts`
- `resume-policy.ts`
- `sync-device-doc.ts`

These modules should operate on plain objects only.

This is the main step that makes the design testable and predictable.

### Phase 3: Rebuild scan around update-in-place semantics

Replace delete-and-recreate scan flow with:

1. load existing catalog state
2. match scanned files to existing rows
3. update matched rows in place
4. insert unmatched rows
5. mark unseen rows as missing

No playback logic should exist in scan.

### Phase 4: Rebuild player writes

Make the player read and write only `playback`.

Player startup:

1. load catalog row by `catalogId`
2. resolve its `canonicalPlaybackKey`
3. read local playback row for `(deviceId, playbackKey)`
4. apply resume policy

Player save:

1. write playback row
2. optionally trigger sync

### Phase 5: Rebuild sync as fact replication

Push:

- local `playback` for this device -> Firestore device doc

Pull:

- Firestore device docs -> `remotePlayback`

No merge into local playback.
No writes into catalog.

### Phase 6: Adapt UI to derived reads

Examples:

- sidebar: latest local playback joined to catalog
- library grid: catalog rows with joined local playback
- devices page: grouped `remotePlayback`
- player links: always local `catalogId`

### Phase 7: Remove `library`

After the compatibility reads are gone:

1. move grouping and browse pages fully to `catalog`
2. move file access helpers to accept `CatalogEntry` or a narrower file-source type
3. remove legacy playback fields from `LibraryEntry`
4. delete the `library` table entirely

The desired end state is:

- `catalog` is the only durable media table
- `playback` is the only local playback table
- `remotePlayback` is the only remote playback cache
- “present locally” is derived from `catalog.availability`, not from a second media table

## Test Strategy

The implementation should be built from pure logic tests upward.

### 1. Matching tests

Test scan matching independently.

Examples:

- exact same file rescanned keeps same `catalogId`
- renamed file with same hash matches existing row
- torrent-backed item matches by torrent identity
- absent file becomes `missing`, not deleted

### 2. Playback key tests

Test playback key generation independently.

Examples:

- torrent key wins over hash
- hash wins over TMDB
- TMDB key works when metadata exists
- fallback works without TMDB
- mutable fields do not change the fallback key unexpectedly

### 3. Resume policy tests

Test resume choice as a pure function.

Examples:

- local playback beats remote when newer
- remote suggestion appears when local history is absent
- watched item starts over unless user chooses resume

### 4. Sync doc tests

Test conversion between local playback rows and Firestore docs.

Examples:

- push includes only this device's rows
- pull produces one cached row per `(deviceId, playbackKey)`
- no remote pull mutates local playback

### 5. Scan integration tests

Use Dexie-backed tests only after pure matching logic is solid.

Examples:

- initial scan creates catalog
- rescan updates rows in place
- missing files remain queryable

### 6. UI selector tests

Keep UI data shaping out of components when possible.

Test selectors like:

- `getNowPlaying`
- `getLibraryEntriesWithPlayback`
- `getResumeCandidate`

These should mostly be joins over plain rows.

## Practical Recommendations

1. Stop thinking of scan as the source of truth for whether a catalog row deserves to exist
2. Make catalog durability the default and deletion the exception
3. Keep local routing on stable `catalogId`
4. Keep cross-device playback identity separate from local identity
5. Persist identity decisions instead of recomputing them everywhere
6. Build the new system by testing pure functions before Dexie integration
7. Remove `library` rather than letting it harden into a second source of truth

## Proposed First Slice

The smallest useful clean-slate implementation is:

1. create `catalog`, `playback`, and `remotePlayback`
2. route player by `catalogId`
3. rewrite scan to mark missing instead of deleting
4. rewrite player to store playback separately
5. rewrite sync to copy playback facts only

That gets us most of the architectural benefit without needing to solve every identity refinement on day one.

TMDB can remain purely additive.
