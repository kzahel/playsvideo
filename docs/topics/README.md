# Topics

Focused, living records of continuing concerns live here.

Prefer the smallest coherent topic whose status, decisions, evidence, and next
work benefit from continuity across sessions or commits. A topic can cover a
contract, recurring problem, product decision, implementation campaign, status
question, or investigation; it does not need to represent an entire subsystem.
Split topics when their decisions or next work can evolve independently.

Adopt this convention incrementally. Existing architecture, reference, status,
and implementation-plan docs do not need to move here solely for consistency.
Create or update a topic when current status is hard to answer, work spans
multiple tacticals or commits, important invariants need to survive the current
session, or new evidence changes the direction. Do not create a topic for every
small standalone change.

Documentation roles:

- Architecture and reference docs own durable system shape and external facts.
- Topic docs own current truth, decisions, evidence, gaps, and direction for a
  focused continuing concern.
- Tactical docs under [`docs/tactical/`](../tactical/README.md) own bounded
  implementation slices and execution records.

New topics should normally begin with a crisp scope, a `Topic: <slug>` line,
and an honest status. Add only the sections the concern needs, such as current
state, contracts and invariants, code and documentation map, evidence and
validation, known gaps, and recommended next work. When a commit series
implements the topic, reuse the document slug in its `Topic:` trailers and
register that exact string in the root `topics.md` file.

## Update Policy

- Read the relevant topic before changing the behavior it governs.
- Update it when a tactical lands or its status, contract, evidence,
  validation, gaps, or recommended direction changes.
- Keep the main text as current truth rather than an append-only diary.
- Keep detailed per-slice execution in `docs/tactical/` and topic docs short
  enough to scan.
- Link relevant architecture and reference docs, code, and tacticals so future
  work starts from the right boundaries.
- Create a sibling topic instead of turning an existing topic into a catch-all.

## Initial Adoption Candidates

These are candidates, not empty placeholder docs. Draft one when work next
touches it or when consolidating its current status would immediately help:

- `device-identity-and-grouping.md` — client-instance identity, logical device
  grouping, legacy records, diagnostics, and operational cleanup. Start from
  [`device-grouping-implementation.md`](../device-grouping-implementation.md).
- `cross-device-handoff.md` — content identity, playback aliases, handoff
  matching, and compatibility between independently deployed clients. Start
  from
  [`cross-device-handoff-implementation-plan.md`](../cross-device-handoff-implementation-plan.md)
  and [`data-model-separation.md`](../data-model-separation.md).
- `playback-compatibility.md` — passthrough versus remux/transcode decisions,
  browser-specific evidence, and the next unsupported media cases. Start from
  [`codec-architecture.md`](../codec-architecture.md),
  [`supported-media.md`](../supported-media.md), and
  [`mediabunny-integration.md`](../mediabunny-integration.md).
- `local-library-and-file-access.md` — persisted file handles, directory
  scanning, permission recovery, offline use, and extension-specific storage.
  Start from
  [`file-system-access-persistence.md`](../file-system-access-persistence.md),
  [`app-architecture.md`](../app-architecture.md), and
  [`chromebook-offline-kids-plan.md`](../chromebook-offline-kids-plan.md).
- `metadata-and-media-identity.md` — TMDB matching, local metadata ownership,
  artwork, and identity boundaries between media, files, and playback. Start
  from [`tmdb-metadata-architecture.md`](../tmdb-metadata-architecture.md) and
  [`data-model-separation.md`](../data-model-separation.md).

## Current Topics

No focused topic docs have been created under this convention yet.
