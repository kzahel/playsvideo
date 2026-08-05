# Cross-Device Handoff

Topic: `cross-device-handoff`

Status: product flow implemented; automated tests and signed-in web/live-data
validation complete. Extension, real protocol/download, offline, accessibility,
and injected-failure validation remain open.

## Scope

This topic owns how playback facts from one client become useful on another:
Activity projection, device filtering, content-identity resolution, local
resume, magnet recovery, pending download intent, freshness, and failure-safe
caching.

It does not decide which client instances represent one physical device. That
presentation concern belongs to
[device identity and grouping](device-identity-and-grouping.md).

## Current Flow

```text
local playback + cached remote playback + Firestore device snapshots
  -> normalized per-client activity facts
  -> optional logical-device filter
  -> content grouping and newest resumable fact
  -> local catalog/alias resolution
  -> resume here | acquire with magnet | explain unavailable
  -> pending handoff reconciled by a later scan
```

Activity is local/cache-first. Signed-out users see local playback. Signed-in
users first see local and cached facts, then an explicit/background one-shot
Firestore refresh updates the projection without blanking it. A refresh failure
keeps the last good cache and presents a non-destructive warning.

The All devices projection keeps every source fact long enough to group and
filter correctly. It selects the newest playback position for an equivalent
media item, while filling missing display or locator fields from older rich
facts. TMDB is useful enrichment but is never required for inclusion.

Each device sync document contains at most the 500 most recently played valid
facts. Sync triggers are serialized. Pause, end, page hide, and teardown request
a final sync where the platform permits.

## Identity and Resume Contracts

Local routes use stable `catalog.id`. Cross-device matching uses persisted
playback keys and aliases. The resolver tries:

1. the fact's exact playback key;
2. torrent info hash plus file index;
3. content hash;
4. TMDB movie or episode identity;
5. weak file identity when it is already present as a canonical key or alias.

Catalog aliases retain earlier and alternate keys when stronger identity
becomes available. Resolving a remote alias always navigates with the local
catalog ID and local canonical playback key, so subsequent writes do not fork
history under the remote key.

Confidence governs resume safety:

- exact canonical, torrent, and content-hash matches are high confidence;
- TMDB matches are medium confidence;
- file matches are low confidence and require confirmation;
- any identity resolving to multiple catalog rows is ambiguous and never
  selects a target automatically.

For a medium-confidence match with materially different durations, the resume
position is translated by watched fraction. A material difference is more than
the larger of 30 seconds or five percent of the remote duration. Other matches
clamp the selected position to the known local duration.

Choosing `Resume here` explicitly uses the displayed remote fact. Ordinary
navigation from the local catalog retains the normal local resume policy.

## Acquisition and Pending Handoffs

Activity and Devices use the same action component and availability states:

- `Available here` offers a local resume action;
- `Download required` offers a native magnet link and supported Web Share;
- `Incomplete download` explains why playback is not ready;
- ambiguous matches do not auto-resume;
- missing media without a locator remains inspectable instead of becoming a
  dead row.

Magnet handling sets or replaces exactly one `so` file-selection parameter.
The UI describes this honestly as a magnet link rather than claiming a
particular application will open it. Its native anchor supports browser
context-menu or long-press copying without a redundant clipboard button. Full
magnets are revealed, shared, or opened only after an explicit user action and
are not logged.

Opening a magnet first stores a deduplicated `pendingHandoffs` row containing
source identity, provenance, resume position, and torrent locators. A later scan
or JSTorrent manifest reconciliation marks it ready when a playable local file
appears. Successful player initialization, not route navigation, consumes the
handoff. Waiting handoffs expire after 30 days; consumed handoffs after 7 days;
the user may dismiss either earlier.

PlaysVideo does not stream bytes directly from another signed-in device and
does not sync local filesystem paths or handles.

## Evidence

Unit coverage exercises activity grouping and filters, sparse-fact enrichment,
identity resolution and ambiguity, magnet URL construction, pending-handoff
lifecycle, sync cache shaping, and player resume state.

The 2026-08-04 signed-in web validation used live Firestore data and confirmed:

- All devices plus per-device filters, including non-TMDB torrent facts;
- recency ordering and local resume route/state construction;
- shared actions on Activity and all expanded Devices entries;
- twelve inspected magnets with exactly one expected `so` selector;
- cache/refresh feedback and detailed identity/source diagnostics.

No protocol handler was launched and no media was downloaded in that run. The
detailed execution record and acceptance matrix remain in
[`cross-device-handoff-implementation-plan.md`](../cross-device-handoff-implementation-plan.md).

## Known Gaps and Next Work

1. Add component/E2E coverage for Activity filters, details, and shared actions.
2. Add a deterministic two-client Firestore emulator fixture.
3. Run the complete handoff on the web app and extension: open JSTorrent,
   acquire media, ingest the manifest, resume, and verify consumption.
4. Validate cached Activity and pending intent through a real offline restart.
5. Inject clipboard denial, missing Web Share, expired auth, and Firestore
   failures and verify the user-visible feedback.
6. Validate keyboard, screen-reader, touch, and narrow-screen access.
7. Repeat the manual matrix with TMDB disabled and with alias/ambiguous matches.

## Code and Documentation Map

- `app/src/activity/activity-view.ts` — fact normalization and projection.
- `app/src/activity/handoff-actions.ts` — capabilities and resume translation.
- `app/src/playback-identity-resolver.ts` — alias index and local resolution.
- `app/src/components/PlaybackHandoffActions.tsx` — shared user actions.
- `app/src/handoff/pending-handoffs.ts` — durable acquisition intent.
- `app/src/sync-device-doc.ts` and `app/src/firebase.ts` — sync facts,
  bounded documents, remote cache, and freshness.
- `app/src/pages/Activity.tsx` and `app/src/pages/Devices.tsx` — product
  surfaces.
- [`data-model-separation.md`](../data-model-separation.md) — storage rationale.
- [`app-architecture.md`](../app-architecture.md) — wider app data flow.
