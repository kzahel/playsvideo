# TMDB Metadata Implementation Plan

This plan maps the architecture in `docs/tmdb-metadata-architecture.md` onto the current repo layout.

## Current state

### Shared UI

- `extension/main.tsx` already renders the React app from `app/src`.
- `app/src/context.ts` already distinguishes `webapp` vs `extension`.
- `app/src/app.css` is already shared by both surfaces.

This is a good base for one shared metadata layer.

### Current TMDB implementation

- `app/src/tmdb.ts` performs TMDB requests directly from app code.
- `app/src/db.ts` stores durable metadata and match results in IndexedDB.
- `app/src/media-metadata.ts` parses filenames and builds metadata keys.
- `app/src/scan.ts` triggers metadata enrichment during scans.
- `app/src/firebase.ts` already uses TMDB-backed sync keys when metadata exists.

### Current extension runtime

- `extension/background.ts` only opens the popup window.
- The extension does not yet own metadata transport, caching policy, or TMDB request control.

## Target state

Both the web app and the extension should call one shared worker-owned metadata client:

- web app: service worker or dedicated shared worker-owned metadata transport
- extension: background/service worker-owned metadata transport

The UI should only call a local interface such as `metadataClient.matchTv(...)`, not `fetch()` TMDB endpoints directly.

## Phase 1: isolate the metadata client

Goal:

- move from "TMDB utility module" to "shared metadata client interface"

Tasks:

- Extract the public API of `app/src/tmdb.ts` into a transport-agnostic client interface.
- Keep current behavior by implementing that interface with direct TMDB calls first.
- Move parsing-plus-lookup orchestration into the client boundary instead of scattering it across scan/UI flows.

Suggested files:

- new `app/src/metadata/client.ts`
- new `app/src/metadata/types.ts`
- new `app/src/metadata/direct-transport.ts`
- trim `app/src/tmdb.ts` down or replace it entirely

Exit criteria:

- app code depends on `MetadataClient`, not on raw TMDB request helpers
- no UI component imports TMDB endpoint code directly

## Phase 2: make cache ownership explicit

Goal:

- separate cache records from transport code

Tasks:

- Move cache read/write logic out of transport code into a metadata repository layer.
- Preserve current durable IndexedDB behavior.
- Add explicit record types for:
  - parse cache
  - match cache
  - negative match cache
  - entity cache
  - season cache
  - transport health state

Suggested files:

- new `app/src/metadata/repository.ts`
- extend `app/src/db.ts`

Likely DB changes:

- keep `seriesMetadata` and `movieMetadata`
- add tables for:
  - `metadataParseCache`
  - `metadataSeasonCache`
  - `metadataTransportState`

Exit criteria:

- transport code can be swapped without changing cache schema
- stale and negative cache handling is explicit instead of implicit

## Phase 3: add a request coordinator

Goal:

- centralize concurrency, in-flight dedupe, and `429` handling

Tasks:

- Add a coordinator layer above the direct TMDB transport.
- Limit concurrent requests to `1` or `2`.
- Deduplicate in-flight requests by canonical request key.
- Persist cooldown state when TMDB returns `429`.
- Respect `Retry-After`.

Suggested files:

- new `app/src/metadata/coordinator.ts`
- new `app/src/metadata/request-key.ts`

Exit criteria:

- repeated lookups for the same series/movie collapse into one network request
- cooldown survives reloads
- stale cache can be served while refresh is deferred

## Phase 4: define the host bridge

Goal:

- support the same metadata semantics in web app and extension while keeping the worker as sole owner

Tasks:

- Define a message protocol for metadata actions.
- The protocol should cover:
  - parse filename
  - match movie
  - match show
  - fetch entity details
  - fetch season details
  - get transport health/debug state
  - refresh/invalidate cache

Suggested files:

- new `src/metadata-protocol.ts`

Recommended message shape:

- request id
- operation name
- typed payload
- success/error response envelope

Exit criteria:

- metadata requests can be sent over a message boundary without changing the metadata logic itself

## Phase 5: wire the extension background worker

Goal:

- make the extension background worker the owner of metadata transport

Tasks:

- Expand `extension/background.ts` beyond popup launching.
- Instantiate the shared metadata coordinator in the background worker.
- Expose a `chrome.runtime.onMessage` or long-lived `Port` bridge for UI requests.
- Keep TMDB credentials read only in the background worker.

Suggested files:

- update `extension/background.ts`
- new `extension/metadata-bridge.ts`

Exit criteria:

- extension UI no longer performs direct TMDB requests
- extension background owns rate limiting and durable metadata policy

## Phase 6: wire the web app host

Goal:

- align the web app with the extension architecture without forcing a server

Options:

- a dedicated metadata worker
- a service worker message bridge
- keep same-thread host initially, but behind the same host interface

Recommended pragmatic approach:

- implement the same host interface used by the extension
- web app may initially use an in-page host adapter that calls the shared metadata coordinator directly
- move to service-worker ownership later if needed

Suggested files:

- new `app/src/metadata/host.ts`
- new `app/src/metadata/web-host.ts`
- optional later `app/public/sw.js` integration

Exit criteria:

- web app and extension call the same metadata host interface
- only the host adapter differs

## Phase 7: add per-credential health state

Goal:

- support one primary and one standby TMDB credential without randomization

Tasks:

- Add credential slot state:
  - `primary`
  - `standby`
- Track:
  - auth validity
  - cooldown-until
  - last failure reason
  - active slot
- Do not randomly distribute requests across both credentials.
- Fail over only when the active slot is unhealthy.

Suggested files:

- `app/src/metadata/coordinator.ts`
- `app/src/metadata/repository.ts`

Exit criteria:

- deterministic failover
- health state survives reloads

## Phase 8: optional proxy transport

Goal:

- allow later fallback to a hosted relay without changing callers or cache semantics

Tasks:

- Add `ProxyTransport` implementing the same transport interface.
- Add `AutoTransport` policy:
  - prefer direct
  - fall back to proxy when direct is unhealthy
  - periodically probe direct again
- Keep cache keys transport-independent.

Suggested files:

- new `app/src/metadata/proxy-transport.ts`
- new `app/src/metadata/auto-transport.ts`

Exit criteria:

- proxy can be introduced without changing UI or sync identity logic

## File-by-file changes

### `app/src/tmdb.ts`

Current role:

- direct TMDB client
- cache policy
- lookup orchestration

Planned role:

- remove or reduce to a direct transport implementation

### `app/src/db.ts`

Current role:

- library entries
- settings
- series/movie metadata cache

Planned additions:

- parse cache table
- season cache table
- transport/key health table

### `app/src/scan.ts`

Current role:

- scan and immediate enrichment

Planned changes:

- call shared `MetadataClient` entry points
- prefer series-level and movie-level dedupe instead of raw looped enrichment

### `app/src/firebase.ts`

Current role:

- sync based on TMDB-backed canonical keys when available

Planned changes:

- minimal
- preserve current TMDB canonical sync identity

### `extension/background.ts`

Current role:

- popup launcher only

Planned changes:

- own metadata coordinator
- own TMDB credentials
- own rate-limit state
- expose metadata RPC bridge

### `app/public/sw.js`

Current role:

- playback-related service worker

Planned changes:

- no immediate requirement
- only extend if we decide the web app also needs worker-owned metadata transport through the SW

## Order of implementation

Recommended execution order:

1. introduce `MetadataClient` interface
2. move cache logic into repository layer
3. add coordinator with in-flight dedupe and cooldown handling
4. define shared metadata protocol
5. move extension metadata ownership into `extension/background.ts`
6. add a matching web host adapter
7. add standby credential support
8. add proxy transport only if needed

## Things not to do yet

- do not add a second metadata provider as canonical identity
- do not randomize between multiple shipped TMDB credentials
- do not store image bytes offline
- do not force the web app through a hosted proxy on day one

## Success criteria

We are done with the first major architecture pass when:

- both web app and extension use the same metadata client contract
- the extension background worker owns TMDB transport
- the web app uses the same host interface
- cache records are durable and transport-independent
- `429` behavior is coordinated and persisted
- TMDB remains the canonical source for sync identity and slugs
