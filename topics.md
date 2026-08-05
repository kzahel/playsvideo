# Commit Topics

Registry of topic strings used in `Topic:` commit trailers. This is not an
index of `docs/topics/`; the two normally share a slug when they represent the
same continuing concern.

Append a topic when its first commit is created. Do not reconstruct historical
topics unless doing so is useful. Keep each string exact across its commit
series so `git log --grep "Topic: ..."` finds the whole chain.

- `device-identity-and-grouping` — origin-scoped client identity, logical-device
  presentation, diagnostics, compatibility, and cleanup.
- `cross-device-handoff` — cross-client Activity, content matching, local
  resume, acquisition intent, and freshness.
- `playback-compatibility` — direct/remux selection, codec evidence, segment
  processing, audio transcode, and unsupported-video direction.
- `local-library-and-file-access` — folder capabilities, permission recovery,
  durable scan reconciliation, file reacquisition, and offline access.
- `metadata-and-media-identity` — local parse identity, optional TMDB
  enrichment, worker-owned transport, cache/credential policy, and aliases.
