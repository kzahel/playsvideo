# App Architecture

## Purpose

The repo has two related but distinct products:

- `playsvideo`: the playback engine library
- `@playsvideo/app`: the media catalog app built on top of that engine

The app is not just a demo player. It is a browser-based media catalog that:

- scans local folders
- keeps a durable catalog even when files disappear
- stores per-device playback history
- syncs playback facts across devices
- enriches media with optional TMDB metadata

The `playsvideo` engine is one subsystem inside the app, not the app's architecture by itself.

## High-Level Model

The app is organized around a few clear responsibilities:

- `catalog`: durable media records and local identity
- `playback`: local per-device playback facts
- `remotePlayback`: cached playback facts from other devices
- `catalogAliases`: accumulated cross-device identity candidates for local media
- `pendingHandoffs`: durable download-to-resume intent
- scan pipeline: reconciles local files into `catalog`
- metadata pipeline: parses filenames and optionally enriches catalog rows via TMDB
- sync pipeline: pushes/pulls playback facts only
- player UI: resolves a catalog item to a playable local file and writes playback state

The key design rule is separation of ownership:

- scan owns local presence and file attributes
- metadata owns enrichment fields
- player owns local playback updates
- sync owns replication of playback facts
- handoff resolution owns matching remote facts to local catalog targets

No single row is supposed to be the merge target for everything.

## Main Data Flow

### 1. Scan

Entry point:

- [app/src/scan.ts](/Users/kgraehl/code/playsvideo/app/src/scan.ts)

Folder access:

- [app/src/folder-provider.ts](/Users/kgraehl/code/playsvideo/app/src/folder-provider.ts)

Behavior:

- user selects or rescans a folder
- provider returns scanned files and JSTorrent manifests
- scan parses filenames into media hints
- scan matches new results against existing `catalog` rows
- matched rows are updated in place
- unseen rows from that directory are marked `missing`
- scan triggers metadata refresh for the affected catalog rows

Important property:

- normal rescans do not delete catalog history

### 2. Catalog + Metadata

Core storage:

- [app/src/db.ts](/Users/kgraehl/code/playsvideo/app/src/db.ts)

Filename parsing:

- [app/src/media-metadata.ts](/Users/kgraehl/code/playsvideo/app/src/media-metadata.ts)

Metadata transport and caching:

- [app/src/metadata/repository.ts](/Users/kgraehl/code/playsvideo/app/src/metadata/repository.ts)
- [app/src/metadata/direct-tmdb.ts](/Users/kgraehl/code/playsvideo/app/src/metadata/direct-tmdb.ts)
- [app/src/metadata/client.ts](/Users/kgraehl/code/playsvideo/app/src/metadata/client.ts)

Behavior:

- local filename parsing works without TMDB
- TMDB enrichment is optional
- parsed/enriched fields are stored back onto `catalog`
- TMDB-specific transport and cache policy live under `app/src/metadata`

Related docs:

- [docs/tmdb-metadata-architecture.md](/Users/kgraehl/code/playsvideo/docs/tmdb-metadata-architecture.md)
- [docs/data-model-separation.md](/Users/kgraehl/code/playsvideo/docs/data-model-separation.md)

### 3. Playback

Local playback helpers:

- [app/src/local-playback.ts](/Users/kgraehl/code/playsvideo/app/src/local-playback.ts)
- [app/src/local-playback-views.ts](/Users/kgraehl/code/playsvideo/app/src/local-playback-views.ts)
- [app/src/resume-policy.ts](/Users/kgraehl/code/playsvideo/app/src/resume-policy.ts)

Player integration:

- [app/src/pages/Player.tsx](/Users/kgraehl/code/playsvideo/app/src/pages/Player.tsx)
- [app/src/hooks/useEngine.ts](/Users/kgraehl/code/playsvideo/app/src/hooks/useEngine.ts)

Behavior:

- routes use stable local `catalog.id`
- the player resolves `catalog.canonicalPlaybackKey`
- local playback is stored in `playback` keyed by `(deviceId, playbackKey)`
- UI pages derive progress by joining `catalog` with local `playback`

The player only uses `playsvideo` after the app has already decided:

- which catalog item is being played
- how to get the local file
- what playback state should be resumed

### 4. Sync

Sync entry points:

- [app/src/firebase.ts](/Users/kgraehl/code/playsvideo/app/src/firebase.ts)
- [app/src/sync-device-doc.ts](/Users/kgraehl/code/playsvideo/app/src/sync-device-doc.ts)
- [app/src/playback-key.ts](/Users/kgraehl/code/playsvideo/app/src/playback-key.ts)

Behavior:

- only playback facts are synced
- local `catalog` rows are not merged or overwritten by remote devices
- each device document is bounded to its 500 most recently played entries
- pulled remote state, including torrent/TMDB locators and device freshness, is cached in `remotePlayback`
- concurrent sync triggers are serialized and repeated pulls are deduplicated
- Activity paints from local/cache data first and refreshes Firestore in place
- pause, page hide, end, and player teardown request a final sync

Important property:

- sync copies facts; it does not reconcile one mutable media row across devices

## Current Storage Model

Defined in:

- [app/src/db.ts](/Users/kgraehl/code/playsvideo/app/src/db.ts)

Main tables:

- `catalog`: durable media records
- `playback`: this device's playback state
- `remotePlayback`: cached playback from other devices
- `catalogAliases`: identity accumulation for playback key upgrades
- `pendingHandoffs`: expiring resume intents for media being acquired

Identity split:

- `catalog.id`: local routing/UI identity
- `canonicalPlaybackKey`: cross-device playback identity

This split is what keeps routing stable while still allowing best-effort cross-device matching.

## UI Structure

Routes:

- [app/src/routes.ts](/Users/kgraehl/code/playsvideo/app/src/routes.ts)

Main pages:

- [app/src/pages/Catalog.tsx](/Users/kgraehl/code/playsvideo/app/src/pages/Catalog.tsx)
- [app/src/pages/MediaBrowser.tsx](/Users/kgraehl/code/playsvideo/app/src/pages/MediaBrowser.tsx)
- [app/src/pages/TvShow.tsx](/Users/kgraehl/code/playsvideo/app/src/pages/TvShow.tsx)
- [app/src/pages/Movie.tsx](/Users/kgraehl/code/playsvideo/app/src/pages/Movie.tsx)
- [app/src/pages/Player.tsx](/Users/kgraehl/code/playsvideo/app/src/pages/Player.tsx)
- [app/src/pages/Activity.tsx](/Users/kgraehl/code/playsvideo/app/src/pages/Activity.tsx)
- [app/src/pages/Devices.tsx](/Users/kgraehl/code/playsvideo/app/src/pages/Devices.tsx)
- [app/src/pages/Settings.tsx](/Users/kgraehl/code/playsvideo/app/src/pages/Settings.tsx)

Grouping/selectors:

- [app/src/catalog-groups.ts](/Users/kgraehl/code/playsvideo/app/src/catalog-groups.ts)
- [app/src/local-playback-views.ts](/Users/kgraehl/code/playsvideo/app/src/local-playback-views.ts)
- [app/src/activity/activity-view.ts](/Users/kgraehl/code/playsvideo/app/src/activity/activity-view.ts)
- [app/src/playback-identity-resolver.ts](/Users/kgraehl/code/playsvideo/app/src/playback-identity-resolver.ts)

### Cross-device activity and handoff

Activity is the primary cross-device history. It preserves per-device facts,
filters before selecting a recommended fact, and never requires TMDB metadata.
The All devices view selects the newest position while enriching sparse facts
field by field from equivalent older facts.

Activity and Devices share the same handoff action component. The resolver
matches exact canonical, torrent/file-index, content-hash, TMDB, and file alias
identities in confidence order. Exact, torrent, and hash matches resume
directly; ambiguous matches do not select a target; weak file aliases require
confirmation. Material duration differences on medium-confidence matches scale
the resume point by watched fraction.

If media is unavailable but has a torrent locator, the shared actions can open,
copy, or share a magnet with exactly one `so` file selector. Opening it first
stores a `pendingHandoffs` row. A later scan reconciles that intent against the
catalog, and successful player initialization consumes it.

The UI should generally treat `catalog` as source data and use selectors/helpers to derive display state, rather than storing duplicated UI-specific rows.

## File Access Model

The app supports multiple local file access modes:

- File System Access API
- `webkitdirectory` fallback
- extension-specific behavior

This logic lives in:

- [app/src/folder-provider.ts](/Users/kgraehl/code/playsvideo/app/src/folder-provider.ts)

The rest of the app should depend on the provider abstraction, not on browser-specific folder APIs directly.

## Relationship To The Engine Library

The app depends on `playsvideo` for:

- streaming/demux/mux/transcode playback
- subtitle extraction/loading
- browser playback orchestration

That engine-level architecture is documented separately:

- [README.md](/Users/kgraehl/code/playsvideo/README.md)
- [docs/engine-api.md](/Users/kgraehl/code/playsvideo/docs/engine-api.md)
- [docs/codec-architecture.md](/Users/kgraehl/code/playsvideo/docs/codec-architecture.md)

The app adds the media-system concerns around the engine:

- persistence
- routing
- folder scanning
- metadata enrichment
- device sync
- catalog UX

## Suggested Reading Order

If you are new to the app codebase, start here:

1. [app/README.md](/Users/kgraehl/code/playsvideo/app/README.md)
2. [docs/app-architecture.md](/Users/kgraehl/code/playsvideo/docs/app-architecture.md)
3. [app/src/db.ts](/Users/kgraehl/code/playsvideo/app/src/db.ts)
4. [app/src/scan.ts](/Users/kgraehl/code/playsvideo/app/src/scan.ts)
5. [app/src/pages/Player.tsx](/Users/kgraehl/code/playsvideo/app/src/pages/Player.tsx)
6. [app/src/firebase.ts](/Users/kgraehl/code/playsvideo/app/src/firebase.ts)
7. [docs/data-model-separation.md](/Users/kgraehl/code/playsvideo/docs/data-model-separation.md)
