# Device Identity and Grouping

Topic: `device-identity-and-grouping`

Status: implemented on `main` and locally verified; production rules/app
rollout and mixed-surface manual validation remain pending.

## Scope

This topic owns the distinction between an origin-scoped client instance and a
user-facing logical device. It covers identity lifetime, Firestore registry
data, legacy projection, management operations, diagnostics, compatibility,
and cleanup.

It does not own playback-content matching or download/resume behavior; those
belong to [cross-device handoff](cross-device-handoff.md).

## Current Model

The historical `deviceId` is actually a client-instance identifier. It is a
random UUID stored in the local Dexie `settings` table by
`app/src/device.ts`. Its durable boundary is the browser storage partition,
not the physical computer.

Consequently, one MacBook can legitimately have several client IDs:

- `https://playsvideo.com` and a localhost origin have separate IndexedDB;
- the extension has its own extension-origin storage;
- different browser profiles have separate storage;
- clearing site data or uninstalling an extension discards the ID;
- a later visit or reinstall creates a new ID.

The ID is not derived from a hostname, machine serial, account, IP address, or
browser fingerprint. `generateDeviceLabel()` derives only a coarse
platform/browser label from the user agent, so duplicate labels are expected.

The presentation layer adds two owner-only Firestore collections without
changing the historical sync documents:

```text
sync/{uid}/devices/{deviceId}       playback snapshot; unchanged
sync/{uid}/clientMeta/{deviceId}    client-instance description and status
sync/{uid}/deviceGroups/{groupId}   user-facing logical-device name
```

`clientMeta` records the generated label, observed origin, web/extension kind,
production/development channel, first metadata-registration time, last-seen
time, management status, and optional logical group membership. It cannot
recover when the underlying client ID was originally created. Active clients
register or enrich this record lazily during sync.

A logical device is a derived group of one or more client instances. Group
membership lives on each client metadata record; the group document owns only
the user-visible name and timestamps. Playback rows and device snapshots remain
keyed by the immutable client ID.

## Legacy and Offline Projection

A `devices/{deviceId}` document remains valid when `clientMeta` and
`deviceGroups` do not exist. The projection creates a virtual client from the
old label and sync timestamp. Legacy clients with the same normalized label
appear as one default logical device, but the original client IDs and playback
facts remain separate underneath.

That grouping is deliberately reversible. Renaming, merging, or splitting
materializes explicit registry records; it never rewrites playback history.

Activity can render cached `remotePlayback` without Firestore. When registry
metadata is unavailable, it falls back to the same label-based virtual
grouping. Device names, origins, and management status are not yet cached in a
dedicated offline Dexie table.

## User-Visible Contracts

- Activity shows logical devices, not one filter per storage partition.
- The logical device containing the current client is labeled `This device`.
- Devices exposes the nested client instances and shows the generated label,
  origin or `Origin unknown`, channel, kind, short ID, last-seen time, and
  management status.
- Rename changes only the logical-device name.
- Merge and split change only registry membership.
- Archive hides a client from normal Activity while retaining its playback
  snapshot and metadata.
- Forget deletes a non-current playback snapshot and retains a `forgotten`
  metadata tombstone so an old client does not silently reappear.
- The current client cannot be forgotten.
- No action claims that two clients are the same physical machine unless the
  user groups them.

## Compatibility and Rollout

This is an additive rollout, not a schema migration:

1. Deploy Firestore rules for `clientMeta` and `deviceGroups`.
2. Deploy the app reader/writer and Devices management UI.
3. Let active clients register their existing IDs lazily.
4. Let users materialize logical groups as needed.

Old clients continue reading and replacing only their own
`devices/{deviceId}` snapshot. Registry state is separate so old clients cannot
overwrite group names, membership, or management status. Rolling the UI back
leaves all historical playback documents intact.

There is no bulk backfill. Inactive records remain legacy records until a user
manages them or the corresponding client syncs with the new app.

## Evidence

The implementation has pure unit coverage for legacy grouping, persisted
membership, reversible splitting, hidden/tombstoned clients, metadata seeding,
and managed-state preservation. On 2026-08-05:

- Firestore rules compiled in the local emulator;
- all 242 unit tests passed;
- typecheck, formatting, lint, library build, and app build passed.

The implementation record is
[`device-grouping-implementation.md`](../device-grouping-implementation.md).

## Known Gaps and Next Work

1. Deploy the additive Firestore rules before deploying the app changes.
2. Validate one account across production web, localhost, and the extension,
   confirming that origin/channel diagnostics explain the separate clients.
3. Exercise rename, merge, split, archive, restore, and forget against live
   data, including an old client that recreates a forgotten snapshot.
4. Decide later whether registry metadata needs a durable offline cache. The
   current label-based fallback is safe but loses managed names while offline.
5. Consider conservative stale-client suggestions only after real usage data.
   Do not introduce hardware fingerprinting or automatic cross-label merging.

## Code and Documentation Map

- `app/src/device.ts` — local UUID and generated label.
- `app/src/device-groups.ts` — client/group types and pure projection.
- `app/src/firebase.ts` — registry reads, lazy registration, and management
  writes.
- `app/src/pages/Activity.tsx` — logical-device filters.
- `app/src/pages/Devices.tsx` — diagnostics and management UI.
- `firestore.rules` — owner-only access to all three sync collections.
- `tests/unit/sync/device-groups.test.ts` — projection and compatibility tests.
- [`app-architecture.md`](../app-architecture.md) — wider app ownership model.
