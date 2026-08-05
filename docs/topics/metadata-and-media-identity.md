# Metadata and Media Identity

Topic: `metadata-and-media-identity`

Status: local filename parsing, durable TMDB caches, shared web/extension host
protocol, request coordination, privacy controls, and primary/standby direct
transport are implemented. Extension credential packaging, retention cleanup,
and proxy transport remain open.

## Scope

This topic owns the boundary between local media identity and optional metadata
enrichment. It covers filename parsing, TMDB matching and cache ownership,
worker/background transport, credentials and rate limits, privacy controls,
artwork metadata, and the effect of metadata on playback aliases.

It does not own local file presence, playback-path codec selection, or handoff
UI. Those topics consume the identities and metadata defined here.

## Identity Boundaries

The application uses several identities for different purposes:

- `catalog.id` is the stable local route and join key;
- `seriesMetadataKey` and `movieMetadataKey` are normalized local lookup keys
  derived from parsed title and optional year;
- TMDB IDs identify matched external movie/show entities and can contribute
  stable playback aliases;
- `canonicalPlaybackKey` and `catalogAliases` relate playback facts across
  clients using torrent, hash, TMDB, or file evidence.

TMDB is not required for cataloging, routing, playback, Activity, or handoff.
Current playback-key preference is torrent identity, then content hash, then
TMDB, then weak file identity. An existing canonical key is retained while it
remains a valid candidate; stronger later identities are accumulated as
aliases rather than rewriting playback rows.

Within the metadata namespace, TMDB remains the only canonical external entity
provider. A future lookup helper may be added, but it must resolve back to a
TMDB entity before its result is stored as TMDB metadata. This does not make
TMDB the canonical identity of the local catalog itself.

## Local Parse and Cache Contract

Filename/path parsing is local, synchronous, and available when all network
metadata is disabled. It extracts:

- TV versus movie versus unknown classification;
- normalized title and optional year;
- TV season, starting episode, and optional ending episode;
- stable local series/movie metadata lookup keys.

The parse cache is keyed by path plus modification time. Parsed fields also
live on catalog rows so normal UI remains useful without a metadata host.

Dexie remains the durable cache and local source of truth. Current stores
include:

- `seriesMetadata` and `movieMetadata` for match/entity results;
- `metadataParseCache` for filename parsing;
- `metadataSeasonCache` for episode-level season payloads;
- `metadataTransportState` for credential health and cooldowns;
- a settings entry for TMDB image configuration.

Current refresh windows are 30 days for resolved entities, 7 days for
not-found results and TMDB image configuration, and 6 hours for request errors.
Season records have their own staleness policy. Forced refresh and explicit
cache invalidation are available from Settings and detail pages.

Catalog rows and playback history survive metadata invalidation.

## Host and Transport Contract

UI code calls `metadataClient`; it does not fetch TMDB endpoints directly. A
typed message protocol routes requests to:

- the `/app/` service worker for the web app;
- the MV3 background service worker for the extension.

Both hosts run the same protocol handler, repository, direct TMDB client, and
request coordinator. Dexie owns data; the host owns outbound requests and
refresh policy.

The current network transport is direct to TMDB. The coordinator:

- allows one active request at a time;
- deduplicates identical in-flight URLs;
- reads `Retry-After` and durably cools down a credential after `429`;
- marks a credential invalid after `401` or `403`;
- prefers primary, then deterministically falls back to standby;
- exposes transport health in Settings.

A proxy is an optional future implementation of the same host-side transport
boundary. It must not change cache keys or UI callers.

## Credentials and Privacy

Web and extension builds may supply separate public application read tokens.
They are not user secrets, but they remain isolated to the worker/background
bundle rather than UI modules. Browser-entered primary and standby tokens are
stored locally in Dexie settings.

Current precedence is bundled runtime credential first, then the corresponding
locally entered token. The UI calls the local value an override, so the label
and implementation disagree when a bundled token exists; this is a known gap.

Users can disable TMDB requests. When disabled:

- filename parsing and all local catalog behavior continue;
- no filename-derived lookup is sent to TMDB;
- existing cached metadata remains visible until explicitly cleared.

The request tier defaults to `essential`, which performs title matching and
show/movie-level enrichment. `nice-to-have` may fetch season/episode details
when a show page is opened.

## Matching and Artwork

TV and movie search candidates are normalized and scored by title-token
overlap, exact normalized title, optional year, and a bounded popularity
contribution. A result must meet the current score threshold of 55. The cache
stores selected score, reason, errors, and a bounded candidate list for debug
visibility.

Metadata stores TMDB image URLs and paths resolved through cached TMDB image
configuration. It does not currently persist TMDB artwork bytes for offline
use. Locally generated video thumbnails are a separate derived cache and remain
available without TMDB.

TMDB episode stills, if promoted for offline use, require their own byte cache,
source marker, expiry, purge policy, and attribution compliance. They must not
silently replace the local-thumbnail lifecycle.

## Evidence

The metadata implementation landed as incremental slices covering repository
extraction, request coordination, extension background bridge, shared web host,
standby failover, transport health, selective refresh, season metadata, worker
credential isolation, privacy controls, and cache settings.

`tests/unit/metadata-coordinator.test.ts` covers serialized requests,
deduplication, cooldown handling, credential invalidation/failover, and health
state. Parser, playback-key, grouping, scan, and thumbnail tests cover the
downstream use of local and TMDB-derived identity.

The ChromeOS investigation on 2026-07-28 confirmed that the configured token
itself was valid, but a fresh extension build did not receive it because the
extension Vite config did not read `app/.env.local` and release automation did
not inject a credential.

## Known Gaps and Next Work

1. Define and verify extension build/release credential injection, then test
   real metadata lookup through the background bridge on ChromeOS.
2. Make browser-entered credentials genuine overrides or relabel them as
   fallbacks to match current precedence.
3. Add the planned hard retention/purge policy for TMDB-derived cache records
   and any future cached TMDB image bytes; the current target is before six
   months, with 150 days proposed in the Chromebook plan.
4. Maintain the required TMDB attribution/logo in a durable About/Credits
   surface and confirm release/privacy disclosures.
5. Add integration/E2E coverage for the service-worker and extension bridges,
   disabled requests, stale cache, `429`, invalid primary, and standby success.
6. Add proxy transport only if direct transport produces a demonstrated
   availability or abuse-control need.
7. Reconcile older documentation that describes TMDB as the app-wide canonical
   identity provider with the implemented optional, alias-based model.

## Code and Documentation Map

- `app/src/media-metadata.ts` — local parser and normalized lookup keys.
- `app/src/metadata/client.ts`, `host.ts`, and `protocol.ts` — caller and host
  boundary.
- `app/src/metadata/protocol-handler.ts` — shared host operations.
- `app/src/metadata/repository.ts` — Dexie cache and credential access.
- `app/src/metadata/coordinator.ts` — queue, dedupe, cooldown, and failover.
- `app/src/metadata/direct-tmdb.ts` — matching, details, seasons, and TTLs.
- `app/src/sw.ts` and `extension/metadata-bridge.ts` — shipped hosts.
- `app/src/playback-key.ts` and `app/src/playback-identity-resolver.ts` —
  downstream playback identity.
- [`tmdb-metadata-architecture.md`](../tmdb-metadata-architecture.md) — original
  architecture rationale.
- [`tmdb-metadata-implementation-plan.md`](../tmdb-metadata-implementation-plan.md)
  — historical phase plan.
- [`data-model-separation.md`](../data-model-separation.md) — current storage
  ownership model.
