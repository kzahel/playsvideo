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

## Current Topics

- [`filesystem-scanning-and-reconciliation.md`](filesystem-scanning-and-reconciliation.md)
  — focused discovery versus authoritative reconciliation, scan scope,
  budgets, concurrency, and mutation safety.
- [`device-identity-and-grouping.md`](device-identity-and-grouping.md) —
  implemented client-instance registry and user-managed logical-device
  presentation; production rollout and mixed-surface manual validation remain.
- [`cross-device-handoff.md`](cross-device-handoff.md) — implemented Activity,
  identity resolution, local resume, magnet acquisition, and durable pending
  handoffs; extension/download/offline/failure validation remains.
- [`playback-compatibility.md`](playback-compatibility.md) — current direct and
  remux/HLS selection, audio transcode contract, mediabunny boundary, and
  unsupported-video direction.
- [`local-library-and-file-access.md`](local-library-and-file-access.md) —
  browser permission boundaries, file reacquisition, offline extension
  behavior, and remaining hardware validation.
- [`metadata-and-media-identity.md`](metadata-and-media-identity.md) — optional
  TMDB enrichment, local/external/playback identity boundaries, shared host
  transport, cache policy, and packaging/retention gaps.
