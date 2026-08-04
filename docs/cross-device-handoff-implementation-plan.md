# Cross-Device Activity and Handoff Implementation Plan

Last reviewed: 2026-08-04

Status: Proposed

Owner: Unassigned

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

## Verified baseline

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
| 0 | Pure projection and regression fixtures | Not started | Cross-device behavior is testable without React or Firestore |
| 1 | Complete Activity and device filters | Not started | Every valid playback fact is visible and ordered by recency |
| 2 | Shared row actions and Devices parity | Not started | No remote row is a dead end |
| 3 | Multi-key identity and alias resolution | Not started | Equivalent local media resolves across canonical-key differences |
| 4 | Download-and-resume handoff | Not started | Magnet recovery retains the remote resume intent |
| 5 | Freshness and remote cache completeness | Not started | New handoffs arrive predictably and cached data supports actions |
| 6 | Hardening, migration, and release validation | Not started | Multi-device scenarios pass automated and manual checks |

### Phase 0: Extract a pure activity projection

Goal: establish one testable path from per-device facts to Activity view models.

Tasks:

- [ ] `H0.1` Add a pure normalizer for Firestore device docs and local playback
  rows.
- [ ] `H0.2` Preserve one normalized fact per device and playback key.
- [ ] `H0.3` Add an identity resolver with explicit grouping fallbacks:
  torrent identity, content hash, TMDB identity, parsed title/episode, then
  playback key.
- [ ] `H0.4` Separate grouping identity from local-playability resolution.
- [ ] `H0.5` Select the newest resumable fact for All devices without losing the
  other device facts.
- [ ] `H0.6` Coalesce optional display/locator metadata field by field so a newer
  sparse fact does not erase an older magnet or TMDB identity.
- [ ] `H0.7` Add pure unit fixtures for legacy/sparse device docs, torrent keys,
  file keys, hash keys, and TMDB keys.
- [ ] `H0.8` Record projection diagnostics: input fact count, displayed item
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

- [ ] `H1.1` Replace `extractTmdbIdentity`/`buildShowGroups` page-local logic
  with the Phase 0 selector.
- [ ] `H1.2` Add filter controls for **All devices**, **This device**, and each
  synced device.
- [ ] `H1.3` Display the selected source device, playback timestamp, and device
  sync freshness on each row or its details surface.
- [ ] `H1.4` Sort Continue Watching items by `lastPlayedAt` descending.
- [ ] `H1.5` When grouping a show, order the collapsed preview by recency; keep
  season/episode order only for an expanded episode list.
- [ ] `H1.6` Add a fallback section for entries that cannot be confidently
  grouped as TV or movies.
- [ ] `H1.7` Make the signed-out page local-first by projecting IndexedDB
  playback even when Firestore is unavailable.
- [ ] `H1.8` Add useful empty states for no local activity, no synced activity,
  and a device filter with no matches.
- [ ] `H1.9` Keep filter state stable during the session and handle a forgotten
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

- [ ] `H2.1` Introduce a pure capability resolver that returns `resume`,
  `open-magnet`, `copy-magnet`, `share`, or `unavailable` actions.
- [ ] `H2.2` Build a shared row details/action component used by Activity and
  Devices.
- [ ] `H2.3` Keep the whole row/details trigger interactive even when there is
  no local catalog match.
- [ ] `H2.4` Label local availability clearly: **Available here**, **Download
  required**, **Incomplete download**, or **No source on this device**.
- [ ] `H2.5` Provide **Resume here at H:MM:SS** when a playable local target is
  resolved.
- [ ] `H2.6` Provide **Open in JSTorrent**, **Copy magnet**, and Web Share when a
  magnet is available.
- [ ] `H2.7` Centralize magnet URL handling and set/replace the `so` parameter.
- [ ] `H2.8` Show success and failure feedback for clipboard, protocol-handler,
  and share actions.
- [ ] `H2.9` Expose useful details without dumping sensitive URLs by default:
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

- [ ] `H3.1` Define match precedence and confidence:
  exact canonical key; torrent info hash plus file index; content hash; TMDB
  movie/episode; filename plus size.
- [ ] `H3.2` Populate `catalogAliases` with all known playback-key candidates
  during scan/reconciliation and metadata enrichment.
- [ ] `H3.3` Preserve aliases when a stronger canonical key becomes available.
- [ ] `H3.4` Replace `buildLocalSyncKeyIndex()` with a resolver that indexes
  canonical and alias keys and returns a `LocalPlaybackTarget`.
- [ ] `H3.5` Detect ambiguous matches and require confirmation instead of
  selecting an arbitrary catalog row.
- [ ] `H3.6` Translate the selected remote position onto the local canonical
  playback key before navigating to the player.
- [ ] `H3.7` Compare remote and local durations for medium-confidence matches;
  define and test fraction-based position translation.
- [ ] `H3.8` Ensure resuming an alias does not fork subsequent local playback
  history under the remote key.
- [ ] `H3.9` Add migration/backfill logic for existing catalog rows if aliases
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

- [ ] `H4.1` Add a `pendingHandoffs` Dexie table with bounded retention.
- [ ] `H4.2` Before opening a magnet, persist source identity, file index,
  position, duration, and source device.
- [ ] `H4.3` After folder scan or JSTorrent manifest ingestion, resolve pending
  handoffs against newly available catalog entries.
- [ ] `H4.4` Surface ready handoffs in Activity with **Resume downloaded video**.
- [ ] `H4.5` Decide whether automatic navigation is ever appropriate; default
  to an explicit user action for the first release.
- [ ] `H4.6` Mark a handoff consumed after successful player initialization,
  not merely after route navigation.
- [ ] `H4.7` Expire or dismiss stale handoffs and allow manual cancellation.
- [ ] `H4.8` Deduplicate repeated clicks for the same torrent/file identity.
- [ ] `H4.9` Preserve the original remote fact so a failed download does not
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

- [ ] `H5.1` Expand `RemotePlaybackEntry` or introduce a companion cached media
  descriptor so torrent, TMDB, season/episode, and sync-freshness metadata are
  retained locally.
- [ ] `H5.2` Build Activity from local/cache data first, then merge Firestore
  updates without blanking the page.
- [ ] `H5.3` Add a visible refresh action with last-refreshed feedback.
- [ ] `H5.4` Evaluate a Firestore snapshot listener while Activity/Devices is
  open; use it only if lifecycle and read costs are acceptable.
- [ ] `H5.5` Serialize or deduplicate concurrent `mergeAndSync()` calls triggered
  by pause, teardown, and multiple auth-hook consumers.
- [ ] `H5.6` Ensure the source device pushes a final position reliably on pause,
  page hide, and app/extension teardown where the platform permits.
- [ ] `H5.7` Validate Firestore document-size behavior for large histories and
  define pruning or pagination before limits become a problem.
- [ ] `H5.8` Preserve the last good cache when a refresh fails and show a
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
- [ ] `H6.6` Confirm that copied/shared private magnet URLs are only exposed
  after an explicit user action and are not written to logs.
- [ ] `H6.7` Run the full project green gates.
- [ ] `H6.8` Perform the manual multi-device acceptance matrix below.
- [ ] `H6.9` Update `docs/app-architecture.md`,
  `docs/data-model-separation.md`, and this status table after implementation.

Exit criteria:

- Automated tests cover the reported regression and the critical handoff
  state transitions.
- Manual web/extension handoff succeeds across two signed-in devices.
- Project typecheck, unit tests, lint, and formatting gates pass.

## Acceptance matrix

| Scenario | Expected result | Automated | Manual |
|---|---|---:|---:|
| Remote torrent entry without TMDB | Visible in All devices and source-device filter | [ ] | [ ] |
| Remote file/hash entry without TMDB | Visible with title/filename fallback | [ ] | [ ] |
| Same canonical key available locally | Resume here opens local player at displayed position | [ ] | [ ] |
| Alias key available locally | Resolves local catalog row and translates to local playback key | [ ] | [ ] |
| Newer remote fact and older local fact | All devices shows/resumes the newer remote fact | [ ] | [ ] |
| Specific device selected | Shows and resumes that device's fact | [ ] | [ ] |
| Five-plus in-progress episodes | Collapsed preview shows most recent episodes | [ ] | [ ] |
| Missing local file with magnet | Details offers open/copy/share and correct `so` value | [ ] | [ ] |
| Existing magnet already has `so` | File selection is replaced, not duplicated | [ ] | [ ] |
| Missing local file without magnet | Details explains unavailability and shows identity | [ ] | [ ] |
| Sparse newer fact, rich older fact | New position retains useful magnet/display metadata | [ ] | [ ] |
| Ambiguous weak identity | User confirmation required; no arbitrary playback | [ ] | [ ] |
| Download initiated then app reloads | Pending handoff remains | [ ] | [ ] |
| Matching manifest arrives | Pending handoff becomes resumable | [ ] | [ ] |
| Firestore unavailable | Cached/local Activity remains visible with stale warning | [ ] | [ ] |
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

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| TMDB groups different encodes with different timelines | Track match confidence; compare durations; label approximate seeks |
| Filename fallback matches the wrong episode | Require confirmation for low-confidence or ambiguous matches |
| Newer sparse facts erase locators | Merge playback facts by recency and optional metadata field by field |
| Magnet links contain private tracker information | Reveal/copy/share only through explicit actions; never log full magnets |
| One Firestore document grows with unbounded history | Measure serialized size; define pruning/pagination before the limit is approached |
| Multiple sync triggers race | Serialize/deduplicate sync and test last-write ordering |
| Pending handoffs accumulate | Deduplicate, expire, and allow dismissal |
| Player writes history under a remote alias | Translate to local canonical key before navigation/save |
| UI implies remote streaming is possible | Use explicit availability labels and download-required messaging |

## Open decisions

Record decisions here before or during implementation.

- [ ] Retention period for consumed and unconsumed pending handoffs.
- [ ] Whether Web Share belongs in the first action slice or a follow-up.
- [ ] Whether Activity filters persist across browser restarts or only the
  current session.
- [ ] Whether medium-confidence duration differences use proportional seeking
  automatically or prompt first.
- [ ] Firestore history retention/pruning policy.
- [ ] Snapshot listener versus manual/background refresh strategy.

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
