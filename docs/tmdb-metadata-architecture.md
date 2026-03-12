# TMDB Metadata Architecture

## Goals

- Ship the same metadata semantics in the web app and the browser extension.
- Use TMDB as the canonical identity source for movies and TV.
- Prefer durable local caching over repeated network lookups.
- Centralize request control, rate limiting, and fallback behavior behind one interface.
- Keep the initial design direct-to-TMDB, while allowing a later server proxy without rewriting callers.

## Non-goals

- TMDB user account features.
- Multi-provider canonical identity.
- Offline storage of artwork bytes.

## Core decisions

### 1. TMDB is the canonical identity provider

Canonical IDs and sync identities should remain TMDB-based:

- TV: `tmdb:tv:{seriesId}:s{season}:e{episode}`
- Movie: `tmdb:movie:{movieId}`

This keeps:

- stable slugs
- stable cross-device sync keys
- one canonical namespace

Other providers may be used later only as lookup helpers. If a fallback provider is ever added, it must resolve back to a TMDB ID before metadata is committed as canonical.

### 2. Web app and extension share the same metadata layer

The web app and MV3 extension should use the same metadata pipeline and cache semantics.

The only runtime difference is the host transport boundary:

- web app: service worker owns metadata transport
- extension: background/service worker owns metadata transport

UI code should never call TMDB directly.

### 2a. Dexie remains the local metadata database

Dexie/IndexedDB remains the durable local source of truth for cached metadata and library state.

It should continue to store:

- scanned library entries
- parsed filename cache
- TMDB match/entity cache
- season cache
- transport health state
- watch progress

The worker/host layer does not replace Dexie. It sits above Dexie and owns:

- all TMDB network access
- request orchestration
- rate limiting
- cooldown state
- transport selection
- invalidation and refresh policy

This distinction matters:

- Dexie is the persistent local database
- background/service worker is the only layer allowed to hit TMDB directly

### 3. Direct TMDB is the initial transport

We start with direct TMDB access from the worker-owned metadata layer.

TMDB application auth is an app credential, not a real client secret. The shipped credential should be treated as public. The worker boundary is still useful because it centralizes:

- rate limiting
- request dedupe
- cache access
- transport selection
- failure handling

### 4. Separate credentials per shipped surface

Use different TMDB application credentials for:

- website/web app
- browser extension

This allows:

- independent rotation
- independent disablement
- cleaner traffic attribution
- reduced blast radius if one credential is abused

### 5. Prefer bearer read tokens over query-string API keys

TMDB documents the v3 `api_key` and v4 read access token as equivalent for application-level access. Prefer the read token because it keeps credentials out of URLs and query strings.

## Architecture

The metadata layer should be split into three pieces:

1. parse + match pipeline
2. durable cache
3. transport

Callers should depend on one worker-owned interface:

```ts
type MetadataClient = {
  parseFilename(input: string): Promise<ParsedMedia>
  matchTv(input: MatchTvInput): Promise<MatchedSeries | null>
  matchMovie(input: MatchMovieInput): Promise<MatchedMovie | null>
  getSeries(id: number): Promise<SeriesRecord | null>
  getMovie(id: number): Promise<MovieRecord | null>
  getSeason(seriesId: number, season: number): Promise<SeasonRecord | null>
}
```

The transport should be pluggable:

```ts
type MetadataTransport = {
  searchTv(input: SearchTvInput): Promise<SearchTvResult>
  searchMovie(input: SearchMovieInput): Promise<SearchMovieResult>
  getTv(id: number): Promise<TvDetails>
  getMovie(id: number): Promise<MovieDetails>
  getSeason(seriesId: number, season: number): Promise<SeasonDetails>
}
```

Implementations:

- `TmdbDirectTransport`
- `ProxyTransport`
- `AutoTransport`

`AutoTransport` should default to direct transport and only fail over when direct transport is unhealthy or explicitly disabled.

## Worker ownership

The service worker/background worker is the sole owner of:

- TMDB credentials
- request queueing
- rate-limit state
- transport selection
- in-flight request dedupe
- metadata refresh/invalidation policy

Dexie remains the durable metadata cache and local database. The worker/host layer owns the policy around when and how that cache is refreshed from TMDB.

UI code should communicate with the worker/host layer through a small internal API instead of constructing TMDB requests itself.

Benefits:

- one place to enforce request policy
- one orchestration layer shared across views/tabs
- easier debugging
- easier future switch to proxy transport

This is primarily an architecture benefit. It is not a true secret boundary for a shipped public client.

## Durable cache model

Aggressive local caching is the main availability and rate-limit strategy.

This durable cache lives in Dexie/IndexedDB.

Store these caches durably:

### Parse cache

Key:

- raw filename or normalized basename

Value:

- parsed title
- media type
- year
- season/episode numbers
- normalized metadata key

TTL:

- effectively permanent until filename changes

### Match cache

Key examples:

- `tv|yellowstone|2018`
- `movie|dune|2021`

Value:

- chosen TMDB ID
- confidence
- normalized query
- alternatives for debug
- fetched timestamp

TTL:

- long-lived, ideally 30-90 days or manual refresh only

### Negative match cache

Key:

- normalized query

Value:

- no-match or low-confidence result
- fetched timestamp

TTL:

- short-lived, ideally 1-7 days

### Entity cache

Keys:

- `tv:{id}`
- `movie:{id}`

Value:

- title
- original title
- overview
- release/air year
- poster path
- backdrop path
- logo path
- useful metadata for display/grouping

TTL:

- 7-30 days

### Season cache

Key:

- `tv:{seriesId}:season:{n}`

Value:

- ordered episode records
- episode names
- still paths
- overviews

TTL:

- 7-30 days

### TMDB config cache

Key:

- `tmdb:configuration`

Value:

- image base URLs
- size options

TTL:

- 7-30 days

## Image handling

Persist image metadata, not image bytes:

- `poster_path`
- `backdrop_path`
- `logo_path`
- optional width/height/aspect metadata if available

The browser cache and TMDB CDN should handle image bytes. Offline artwork storage is unnecessary for the initial design.

## Request minimization rules

The system should avoid repeated per-file search requests.

For TV:

- parse `Sample Show s01e07`
- normalize to one series query
- search series once
- cache the chosen series ID
- fetch season data only when needed

Do not search one TMDB series per episode file if all files belong to the same series.

For movies:

- parse once
- search once per normalized movie query
- reuse entity cache across file variants

## Rate limiting

Respect TMDB `429` responses strictly.

Worker policy:

- keep concurrency low, ideally `1` or `2`
- coalesce duplicate in-flight requests
- read `Retry-After`
- persist cooldown state durably
- do not keep probing TMDB during cooldown

State to persist:

- active transport mode
- active credential slot
- direct transport cooldown-until timestamp
- per-key cooldown-until timestamp
- last auth failure state

Recommended failure handling:

- `429`: enter cooldown using `Retry-After`; otherwise use a backoff ladder
- `401/403`: mark credential invalid until config update or deploy
- network errors: retry conservatively, do not thrash

## Multiple TMDB credentials

If multiple shipped TMDB credentials are used, they should not be selected randomly.

Preferred model:

- one primary credential
- one standby credential

Policy:

- use primary by default
- switch to standby only when primary is cooling down or invalid
- track health per credential
- persist active credential choice

Why not randomize:

- worse debuggability
- fragmented health state
- intermittent failures
- harder attribution

## Future proxy fallback

We do not want to depend on a server now, but the design should support one later.

The proxy, if added, should be a transport implementation, not a new metadata pipeline.

Possible later role of proxy:

- shield TMDB credentials
- rate limit per user or IP
- centralize abuse handling
- provide a fallback path when direct TMDB access is unhealthy

Recommended worker policy:

- `direct` mode
- `proxy` mode
- `auto` mode

`auto` mode:

- prefer direct
- fall back to proxy when direct enters cooldown or auth failure state
- periodically probe direct again

Important rule:

Cache keys must be transport-independent. A series resolved through proxy and a series resolved directly should share the same local cache entry.

## Why not multi-provider canonical identity

A second metadata provider sounds useful, but it makes identity much worse unless everything is normalized back to TMDB.

Without that normalization, we lose:

- canonical slugs
- stable sync keys
- predictable matching semantics
- clean cache keys

If a non-TMDB provider is ever used, it should be treated only as a resolution helper that must end in a TMDB ID before commit.

## Implementation guidance

Build in this order:

1. shared worker-owned `MetadataClient`
2. durable parse and match caches
3. direct TMDB transport
4. low-concurrency request queue + `429` cooldown handling
5. per-credential health state
6. optional standby TMDB credential
7. optional proxy transport

## Summary

The correct design is:

- TMDB-only canonical identity
- one shared metadata client for web app and extension
- worker-owned transport and cache
- durable cache as the primary protection against rate limits
- direct TMDB first
- proxy fallback possible later through transport abstraction
- separate credentials for web and extension
