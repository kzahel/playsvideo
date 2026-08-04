# Cross-Device Activity and Handoff Implementation Plan

Last reviewed: 2026-08-04

Status: Implemented; web/live-data validation complete within the no-download constraint

Owner: playsvideo app

## Purpose

Make it easy to find something watched on another device and continue it on the
current device. Activity should be the user-facing cross-device history, while
Devices should remain a useful device-oriented diagnostic and drill-down view.

This document is the tactical plan and implementation-status record for that
work. Update the status tables and checkboxes as slices land.

## Desired user outcome

A signed-in user can:

1. Open Activity and see recent playback from every synced device, including
   media without TMDB metadata.
2. Filter the view to all devices, this device, or a named device.
3. See which device supplied the displayed resume position and when it synced.
4. Resume immediately when the same media is available locally.
5. Recover unavailable torrent-backed media through an open, copy, or share
   action.
6. Start a torrent download and retain the intended resume position until the
   media becomes playable.
7. Open any row on Devices and get the same useful actions and details.

## Verified baseline before implementation

| Area | Current behavior | Consequence |
|---|---|---|
| Activity source | Pulls every Firestore device document and merges by playback key | Activity is intended to be cross-device already |
| Activity grouping | Silently drops entries without a TMDB identity | Remote file/hash/torrent entries can appear only on Devices |
| Device filtering | No Activity filter controls | Users cannot inspect or compare a specific device from Activity |
| Merge behavior | Keeps only the newest whole entry for a playback key | Per-device alternatives are lost and richer metadata from an older fact may be discarded |
| Activity ordering | Sorts episodes by season/episode, then previews the first five in progress | The most recently watched episode may not appear in the preview |
| Local resolution | Indexes only `catalog.canonicalPlaybackKey` | The same media under a known alternate identity is treated as unavailable |
| Alias support | `catalogAliases` exists but is not populated or read by handoff UI | Playback-key upgrades do not help cross-device matching |
| Devices actions | A row is a link only after an exact local key match; otherwise it is static | Torrent-backed remote rows can be visible but unusable |
| Magnet actions | Activity can open/copy a magnet only for a visible row with no local match | TMDB filtering and exact-key matching can hide or bypass recovery actions |
| Remote cache | `remotePlayback` drops torrent and TMDB locator metadata during flattening | Cached remote facts are insufficient for offline/local-first handoff UI |
| Freshness | Activity and Devices perform one-time reads; playback pushes on pause, end, and teardown | A newly stopped session may require navigation/reload before it appears |
| Resume transport | Route state can carry a remote position, but only when its playback key equals the local canonical key | Alias matches cannot currently carry a usable resume position |

The known TMDB-only Activity limitation is also recorded in
`docs/chromebook-offline-kids-plan.md`.

## Product decisions

These decisions define the first implementation unless later evidence changes
them.

### Activity scope

- Activity defaults to **All devices**.
- Activity never requires TMDB metadata to display a playback fact.
- TMDB improves grouping and artwork but is not an inclusion criterion.
- The All devices view selects the most recently played resumable fact for each
  resolved media identity.
- A device-filtered view uses the fact from the selected device.
- The displayed source device and playback timestamp remain visible.

### Resume behavior

- Selecting **Resume here** explicitly uses the position shown on the Activity
  or Devices row, even if an older local position exists.
- Ordinary navigation from the local catalog keeps the existing local resume
  policy. Changing global player resume policy is not required for the first
  slice.
- High-confidence identity matches use the remote position directly.
- Medium-confidence matches should compare durations and may translate the
  position by watched fraction when durations materially differ.
- Low-confidence filename matches require user confirmation before seeking.

### Availability and recovery

- A row can always open a details/action surface; absence of a local file must
  not make it inert.
- Local playable media offers **Resume here**.
- Torrent-backed media that is not playable locally offers **Open in
  JSTorrent**, **Copy magnet**, and **Share** when supported.
- Missing media without a locator explains what is unavailable and exposes
  useful identity details.
- Magnet construction must set or replace the `so` file-selection parameter,
  not append duplicates.

### Page responsibilities

- Activity is the primary continue-watching and handoff experience.
- Devices is the device-by-device history and troubleshooting view.
- Both pages use the same media-resolution and action logic.
- The player continues to route through a local `catalog.id`; remote facts do
  not become remote catalog rows.

## Non-goals

- Streaming bytes directly from another signed-in device.
- Synchronizing local filesystem paths or file handles.
- Turning TMDB into a required identity provider.
- Automatically deleting remote history when a local file disappears.
- Building a general-purpose messaging or device-control service.
- Changing the core `playsvideo` engine; this work belongs to the app layer.

## Target data flow

```text
local playback rows -----------+
                               |
Firestore per-device docs -----+--> normalized activity facts
                                      |
                                      +--> device filter
                                      +--> identity resolution
                                      +--> newest fact selection
                                      +--> field-wise metadata enrichment
                                      |
local catalog + aliases --------------+--> local target resolution
                                      |
                                      +--> Resume here
                                      +--> Open/copy/share magnet
                                      +--> unavailable explanation
                                      +--> pending download handoff
```

The projection must preserve the original per-device facts. It may derive a
recommended fact for All devices, but it should not destructively merge the
input before device filtering or details are built.

## Proposed app-layer types

The names are illustrative; implementation may adjust them while preserving
the boundaries.

```ts
interface ActivityFact {
  deviceId: string;
  deviceLabel: string;
  playbackKey: string;
  positionSec: number;
  durationSec: number;
  watchState: WatchState;
  lastPlayedAt: number;
  deviceLastSyncedAt?: number;
  title?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  tmdbId?: number;
  tmdbMediaType?: 'tv' | 'movie';
  contentHash?: string;
  torrentInfoHash?: string;
  torrentFileIndex?: number;
  torrentMagnetUrl?: string;
  torrentComplete?: boolean;
}

interface LocalPlaybackTarget {
  catalogId: number;
  localPlaybackKey: string;
  matchKind: 'canonical' | 'torrent' | 'hash' | 'tmdb' | 'file';
  confidence: 'high' | 'medium' | 'low';
  hasLocalFile: boolean;
  magnetUrl?: string;
}

interface PendingHandoff {
  id: string;
  createdAt: number;
  sourceDeviceId: string;
  sourcePlaybackKey: string;
  positionSec: number;
  durationSec: number;
  torrentInfoHash?: string;
  torrentFileIndex?: number;
  magnetUrl?: string;
  status: 'waiting-for-media' | 'ready' | 'consumed' | 'expired';
}
```

## Delivery plan

### Status summary

| Phase | Scope | Status | Exit outcome |
|---|---|---|---|
| 0 | Pure projection and regression fixtures | Complete | Cross-device behavior is testable without React or Firestore |
| 1 | Complete Activity and device filters | Complete | Every valid playback fact is visible and ordered by recency |
| 2 | Shared row actions and Devices parity | Complete | No remote row is a dead end |
| 3 | Multi-key identity and alias resolution | Complete | Equivalent local media resolves across canonical-key differences |
| 4 | Download-and-resume handoff | Complete | Magnet recovery retains the remote resume intent |
| 5 | Freshness and remote cache completeness | Complete | New handoffs arrive predictably and cached data supports actions |
| 6 | Hardening, migration, and release validation | Partial validation | Web/live-data and all automated gates pass; protocol launch, actual download, extension, offline, and failure injection remain unrun by constraint |

### Phase 0: Extract a pure activity projection

Goal: establish one testable path from per-device facts to Activity view models.

Tasks:

- [x] `H0.1` Add a pure normalizer for Firestore device docs and local playback
  rows.
- [x] `H0.2` Preserve one normalized fact per device and playback key.
- [x] `H0.3` Add an identity resolver with explicit grouping fallbacks:
  torrent identity, content hash, TMDB identity, parsed title/episode, then
  playback key.
- [x] `H0.4` Separate grouping identity from local-playability resolution.
- [x] `H0.5` Select the newest resumable fact for All devices without losing the
  other device facts.
- [x] `H0.6` Coalesce optional display/locator metadata field by field so a newer
  sparse fact does not erase an older magnet or TMDB identity.
- [x] `H0.7` Add pure unit fixtures for legacy/sparse device docs, torrent keys,
  file keys, hash keys, and TMDB keys.
- [x] `H0.8` Record projection diagnostics: input fact count, displayed item
  count, unresolved grouping count, local match count, and locator count.

Suggested files:

- new `app/src/activity/activity-facts.ts`
- new `app/src/activity/activity-identity.ts`
- new `app/src/activity/activity-view.ts`
- new `tests/unit/activity/activity-view.test.ts`
- update `app/src/sync-device-doc.ts`

Exit criteria:

- No normalized playback fact is omitted merely because TMDB data is absent.
- Device filtering can be applied before recommendation/merge logic.
- The newest playback fact and the richest available metadata can come from
  different devices without data loss.
- Pure tests reproduce the current “visible on Devices, missing on Activity”
  failure and pass with the new projection.

### Phase 1: Make Activity complete and explicitly cross-device

Goal: replace the TMDB-gated page logic with the pure projection and make scope
visible to the user.

Tasks:

- [x] `H1.1` Replace `extractTmdbIdentity`/`buildShowGroups` page-local logic
  with the Phase 0 selector.
- [x] `H1.2` Add filter controls for **All devices**, **This device**, and each
  synced device.
- [x] `H1.3` Display the selected source device, playback timestamp, and device
  sync freshness on each row or its details surface.
- [x] `H1.4` Sort Continue Watching items by `lastPlayedAt` descending.
- [x] `H1.5` When grouping a show, order the collapsed preview by recency; keep
  season/episode order only for an expanded episode list.
- [x] `H1.6` Add a fallback section for entries that cannot be confidently
  grouped as TV or movies.
- [x] `H1.7` Make the signed-out page local-first by projecting IndexedDB
  playback even when Firestore is unavailable.
- [x] `H1.8` Add useful empty states for no local activity, no synced activity,
  and a device filter with no matches.
- [x] `H1.9` Keep filter state stable during the session and handle a forgotten
  device gracefully.

Suggested files:

- update `app/src/pages/Activity.tsx`
- update `app/src/app.css`
- update `app/src/hooks/useAuth.ts` only if Activity needs a non-blocking auth
  state rather than an early return
- new `tests/unit/activity/activity-filter.test.ts`
- add or update Activity component tests if the test setup supports them

Exit criteria:

- The remote show from the reported scenario is visible under All devices
  without requiring TMDB.
- Every device shown on Devices is available as an Activity filter.
- The first Continue Watching result is the most recently played resumable
  item.
- Signed-out users still see local Activity.

### Phase 2: Share actions between Activity and Devices

Goal: make every row actionable and keep capability decisions consistent across
both pages.

Tasks:

- [x] `H2.1` Introduce a pure capability resolver that returns `resume`,
  `open-magnet`, `copy-magnet`, `share`, or `unavailable` actions.
- [x] `H2.2` Build a shared row details/action component used by Activity and
  Devices.
- [x] `H2.3` Keep the whole row/details trigger interactive even when there is
  no local catalog match.
- [x] `H2.4` Label local availability clearly: **Available here**, **Download
  required**, **Incomplete download**, or **No source on this device**.
- [x] `H2.5` Provide **Resume here at H:MM:SS** when a playable local target is
  resolved.
- [x] `H2.6` Provide **Open in JSTorrent**, **Copy magnet**, and Web Share when a
  magnet is available.
- [x] `H2.7` Centralize magnet URL handling and set/replace the `so` parameter.
- [x] `H2.8` Show success and failure feedback for clipboard, protocol-handler,
  and share actions.
- [x] `H2.9` Expose useful details without dumping sensitive URLs by default:
  source device, filename/title, info hash, file index, playback key type, and
  last sync time.

Suggested files:

- new `app/src/activity/handoff-actions.ts`
- new `app/src/components/PlaybackHandoffActions.tsx`
- new `app/src/torrent-magnet.ts`
- update `app/src/pages/Activity.tsx`
- update `app/src/pages/Devices.tsx`
- new `tests/unit/activity/handoff-actions.test.ts`
- new `tests/unit/torrent-magnet.test.ts`

Exit criteria:

- The reported Devices row opens a useful details/action surface.
- Activity and Devices produce the same actions for the same fact and local
  catalog state.
- Copy/open magnet includes exactly one correct file-selection parameter.
- Unavailable rows explain the next possible action instead of appearing
  disabled without explanation.

### Phase 3: Resolve equivalent identities and aliases

Goal: resume local media even when the remote and local canonical keys differ.

Tasks:

- [x] `H3.1` Define match precedence and confidence:
  exact canonical key; torrent info hash plus file index; content hash; TMDB
  movie/episode; filename plus size.
- [x] `H3.2` Populate `catalogAliases` with all known playback-key candidates
  during scan/reconciliation and metadata enrichment.
- [x] `H3.3` Preserve aliases when a stronger canonical key becomes available.
- [x] `H3.4` Replace `buildLocalSyncKeyIndex()` with a resolver that indexes
  canonical and alias keys and returns a `LocalPlaybackTarget`.
- [x] `H3.5` Detect ambiguous matches and require confirmation instead of
  selecting an arbitrary catalog row.
- [x] `H3.6` Translate the selected remote position onto the local canonical
  playback key before navigating to the player.
- [x] `H3.7` Compare remote and local durations for medium-confidence matches;
  define and test fraction-based position translation.
- [x] `H3.8` Ensure resuming an alias does not fork subsequent local playback
  history under the remote key.
- [x] `H3.9` Add migration/backfill logic for existing catalog rows if aliases
  are required immediately after upgrade.

Suggested files:

- new `app/src/playback-identity-resolver.ts`
- update `app/src/playback-key.ts`
- update `app/src/scan.ts`
- update `app/src/firebase.ts`
- update `app/src/pages/Player.tsx`
- update `app/src/db.ts` if alias indexes or migration logic change
- new `tests/unit/playback-identity-resolver.test.ts`
- extend `tests/unit/player.test.ts`
- extend `tests/unit/playback-key.test.ts`

Exit criteria:

- A remote torrent key resolves a local catalog item that was originally keyed
  by file, hash, or TMDB identity when the evidence identifies the same media.
- The player accepts the selected position under the local canonical key.
- Ambiguous weak matches never auto-play the wrong file.
- New playback saves update one local canonical history row.

### Phase 4: Add a persistent download-and-resume handoff

Goal: retain resume intent while JSTorrent acquires media that is not yet
playable on the current device.

Tasks:

- [x] `H4.1` Add a `pendingHandoffs` Dexie table with bounded retention.
- [x] `H4.2` Before opening a magnet, persist source identity, file index,
  position, duration, and source device.
- [x] `H4.3` After folder scan or JSTorrent manifest ingestion, resolve pending
  handoffs against newly available catalog entries.
- [x] `H4.4` Surface ready handoffs in Activity with **Resume downloaded video**.
- [x] `H4.5` Decide whether automatic navigation is ever appropriate; default
  to an explicit user action for the first release.
- [x] `H4.6` Mark a handoff consumed after successful player initialization,
  not merely after route navigation.
- [x] `H4.7` Expire or dismiss stale handoffs and allow manual cancellation.
- [x] `H4.8` Deduplicate repeated clicks for the same torrent/file identity.
- [x] `H4.9` Preserve the original remote fact so a failed download does not
  erase Activity history.

Suggested files:

- update `app/src/db.ts`
- new `app/src/handoff/pending-handoffs.ts`
- update `app/src/scan.ts`
- update `app/src/pages/Activity.tsx`
- update `app/src/pages/Player.tsx` or `app/src/hooks/useEngine.ts` for consumed
  acknowledgment
- new `tests/unit/handoff/pending-handoffs.test.ts`

Exit criteria:

- Opening a magnet creates one durable pending handoff.
- Reloading or restarting the app does not lose the intended resume position.
- Ingesting the matching JSTorrent manifest makes the handoff resumable.
- Starting playback consumes the handoff and writes normal local playback.

### Phase 5: Improve freshness and cache completeness

Goal: make handoff data arrive predictably and remain useful after the network
becomes unavailable.

Tasks:

- [x] `H5.1` Expand `RemotePlaybackEntry` or introduce a companion cached media
  descriptor so torrent, TMDB, season/episode, and sync-freshness metadata are
  retained locally.
- [x] `H5.2` Build Activity from local/cache data first, then merge Firestore
  updates without blanking the page.
- [x] `H5.3` Add a visible refresh action with last-refreshed feedback.
- [x] `H5.4` Evaluate a Firestore snapshot listener while Activity/Devices is
  open; use it only if lifecycle and read costs are acceptable.
- [x] `H5.5` Serialize or deduplicate concurrent `mergeAndSync()` calls triggered
  by pause, teardown, and multiple auth-hook consumers.
- [x] `H5.6` Ensure the source device pushes a final position reliably on pause,
  page hide, and app/extension teardown where the platform permits.
- [x] `H5.7` Validate Firestore document-size behavior for large histories and
  define pruning or pagination before limits become a problem.
- [x] `H5.8` Preserve the last good cache when a refresh fails and show a
  non-blocking stale-data warning.

Suggested files:

- update `app/src/db.ts`
- update `app/src/firebase.ts`
- update `app/src/hooks/useAuth.ts`
- update `app/src/hooks/useEngine.ts`
- new `app/src/hooks/useActivityFacts.ts`
- extend `tests/unit/sync/sync-device-doc.test.ts`
- extend `tests/unit/sync/merge.test.ts`

Exit criteria:

- Activity renders cached facts immediately and refreshes in place.
- A paused session on one device becomes visible on another through a clear,
  testable refresh path.
- Refresh failure does not erase previously synced history or locators.
- Duplicate sync triggers do not race or produce stale overwrites.

### Phase 6: Hardening and release validation

Goal: prove the workflow across realistic device, identity, availability, and
failure combinations.

Tasks:

- [ ] `H6.1` Add component/E2E coverage for Activity filters, details, and
  actions.
- [ ] `H6.2` Add a deterministic two-device Firestore emulator fixture.
- [ ] `H6.3` Validate web app and Chrome extension behavior.
- [ ] `H6.4` Validate keyboard, screen-reader, touch, and narrow-screen access
  to filters and row actions.
- [ ] `H6.5` Verify clipboard-denied, Web Share unavailable, offline, expired
  auth, and Firestore failure states.
- [x] `H6.6` Confirm that copied/shared private magnet URLs are only exposed
  after an explicit user action and are not written to logs.
- [x] `H6.7` Run the full project green gates.
- [ ] `H6.8` Perform the manual multi-device acceptance matrix below.
- [x] `H6.9` Update `docs/app-architecture.md`,
  `docs/data-model-separation.md`, and this status table after implementation.

The unchecked Phase 6 items are validation follow-ups, not missing product
implementation. The 2026-08-04 run was explicitly constrained to inspecting
magnet URLs without launching the protocol handler or downloading media, and
no physical extension device or failure-injection environment was in scope.

Exit criteria:

- Automated tests cover the reported regression and the critical handoff
  state transitions.
- Manual web/extension handoff succeeds across two signed-in devices.
- Project typecheck, unit tests, lint, and formatting gates pass.

## Acceptance matrix

| Scenario | Expected result | Automated | Manual |
|---|---|---:|---:|
| Remote torrent entry without TMDB | Visible in All devices and source-device filter | [x] | [x] |
| Remote file/hash entry without TMDB | Visible with title/filename fallback | [x] | [ ] |
| Same canonical key available locally | Resume here opens local player at displayed position | [x] | [x] URL/state inspected; playback not started |
| Alias key available locally | Resolves local catalog row and translates to local playback key | [x] | [ ] |
| Newer remote fact and older local fact | All devices shows/resumes the newer remote fact | [x] | [x] |
| Specific device selected | Shows and resumes that device's fact | [x] | [x] |
| Five-plus in-progress episodes | Collapsed preview shows most recent episodes | [x] | [x] |
| Missing local file with magnet | Details offers open/copy/share and correct `so` value | [x] | [x] URLs inspected only |
| Existing magnet already has `so` | File selection is replaced, not duplicated | [x] | [x] URLs inspected only |
| Missing local file without magnet | Details explains unavailability and shows identity | [x] | [x] |
| Sparse newer fact, rich older fact | New position retains useful magnet/display metadata | [x] | [ ] |
| Ambiguous weak identity | User confirmation required; no arbitrary playback | [x] | [ ] |
| Download initiated then app reloads | Pending handoff remains | [x] | [ ] no download by constraint |
| Matching manifest arrives | Pending handoff becomes resumable | [x] | [ ] no download by constraint |
| Firestore unavailable | Cached/local Activity remains visible with stale warning | [x] cache projection | [ ] |
| Signed out | Local Activity remains useful; device-only controls are explained | [ ] | [ ] |
| Clipboard/share denied | Non-destructive error feedback appears | [ ] | [ ] |

## Test commands

Run focused tests while implementing:

```bash
pnpm -w exec vitest run tests/unit/activity
pnpm -w exec vitest run tests/unit/handoff
pnpm -w exec vitest run tests/unit/sync
pnpm -w exec vitest run tests/unit/player.test.ts
```

Before considering any implementation phase complete, run the project gates:

```bash
pnpm -w run typecheck
pnpm -w run test:unit
pnpm -w run lint
pnpm -w run format
```

After formatting, verify that it did not introduce unreviewed changes.

## Manual multi-device script

Use two independently identified devices signed into the same account.

1. On device A, play an episode beyond the opening and pause it.
2. Confirm device A reports a recent sync timestamp.
3. On device B, open Activity and refresh if necessary.
4. Confirm the episode appears under All devices and the device A filter.
5. If the media is local on device B, choose Resume here and verify the start
   position.
6. Repeat with device B lacking the media but having a synced magnet locator.
7. Open the magnet in JSTorrent, reload the app, and confirm the pending
   handoff persists.
8. Ingest the completed or virtual JSTorrent manifest and confirm the handoff
   becomes resumable.
9. Start playback and verify the pending handoff is consumed and local playback
   updates normally.
10. Repeat with TMDB disabled to prove metadata is optional.
11. Repeat with device B offline after it has a populated remote cache.

For physical Chromebook/ChromeOS validation, follow the project-required
ChromeOS testbed skill and the PlaysVideo-specific offline media runbook before
operating the device.

### 2026-08-04 live-data validation record

- Validated the signed-in web app at `https://localhost:9300/app`; the active
  development server was on port 9300 rather than the anticipated port 9000.
- Activity exposed All devices, This device, Android, and four Mac filters.
- The Android filter isolated its facts and showed nine recent Pluribus
  episodes in recency order without requiring TMDB for inclusion.
- This device resolved Alien Earth to local `/app/play/4` and `/app/play/2`
  routes with the displayed positions.
- Devices showed six device documents; expanding Android exposed open, copy,
  share, and details actions on all 20 entries.
- Inspected 12 visible live magnet URLs without activating them. Every URL had
  exactly one `so` parameter and the expected torrent info hash/file selector.
- Activity and Devices refreshes completed with updated freshness feedback and
  retained the selected Activity device filter.
- Details showed source, playback identity, info hash, file index, local-match
  confidence, and remote device sync freshness.
- No protocol handler was launched, no magnet link was clicked, and no media
  was downloaded.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| TMDB groups different encodes with different timelines | Track match confidence; compare durations; label approximate seeks |
| Filename fallback matches the wrong episode | Require confirmation for low-confidence or ambiguous matches |
| Newer sparse facts erase locators | Merge playback facts by recency and optional metadata field by field |
| Magnet links contain private tracker information | Reveal/copy/share only through explicit actions; never log full magnets |
| One Firestore document grows with unbounded history | Keep only the 500 most recently played valid entries per device document |
| Multiple sync triggers race | Serialize/deduplicate sync and test last-write ordering |
| Pending handoffs accumulate | Deduplicate, expire, and allow dismissal |
| Player writes history under a remote alias | Translate to local canonical key before navigation/save |
| UI implies remote streaming is possible | Use explicit availability labels and download-required messaging |

## Open decisions

Record decisions here before or during implementation.

- [x] Retain waiting handoffs for 30 days and consumed handoffs for 7 days.
- [x] Include Web Share in the first action slice when the API is supported.
- [x] Keep Activity filters for the current mounted session; do not persist
  them across browser restarts.
- [x] Scale medium-confidence positions proportionally when durations differ by
  more than the larger of 30 seconds or 5 percent.
- [x] Retain the 500 most recently played valid entries per Firestore device
  document.
- [x] Use cache-first rendering plus explicit/background one-shot refreshes;
  do not add a snapshot listener in this slice because of lifecycle/read cost.

## Completion definition

This project is complete when:

- Activity reliably represents local and cross-device playback without TMDB
  being required.
- Device filters and source provenance are clear.
- Activity and Devices share consistent, useful row actions.
- Equivalent media identities resolve safely across devices.
- Torrent recovery can retain and complete a resume handoff.
- Cached data, refresh behavior, and error states are predictable.
- The full automated and manual acceptance matrix passes.
- Architecture documentation reflects the final behavior.
