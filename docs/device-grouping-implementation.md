# Logical Device Grouping: Tactical Implementation

## Goal

Present a stable, understandable list of user-facing devices while retaining a
separate immutable sync identity for every browser origin, browser profile, PWA
storage partition, and extension installation.

The existing `deviceId` remains the sync identity and storage key. New code may
describe it as a **client instance**, but the stored field, Firestore document
path, local playback keys, and remote cache keys are not renamed or migrated.

## Non-goals

- Do not fingerprint physical hardware.
- Do not rewrite existing playback rows or device sync documents.
- Do not infer a recovered origin or creation time for inactive legacy records.
- Do not destructively merge playback histories when clients are grouped.
- Do not require old app versions to understand the new presentation model.

## Existing data retained unchanged

```text
sync/{uid}/devices/{deviceId}
```

The document remains the client-written playback snapshot:

```ts
interface DeviceSyncDoc {
  v: 2;
  label: string;
  lastSyncedAt: number;
  entries: Record<string, DeviceSyncEntry>;
}
```

Local `playback` and cached `remotePlayback` rows continue to use `deviceId`.
This is important because an older client replaces its complete device document
on every sync. User-managed metadata must therefore live elsewhere.

## Additive Firestore data

```text
sync/{uid}/clientMeta/{deviceId}
sync/{uid}/deviceGroups/{groupId}
```

### Client metadata

```ts
type ClientStatus = 'active' | 'archived' | 'forgotten';
type ClientKind = 'web' | 'extension';
type ClientChannel = 'production' | 'development';

interface ClientMetadataDoc {
  v: 1;
  deviceId: string;
  generatedLabel: string;
  groupId?: string;
  origin?: string;
  kind: ClientKind;
  channel: ClientChannel;
  registeredAt: number;
  lastSeenAt: number;
  status: ClientStatus;
  legacy?: boolean;
}
```

The current client upserts runtime-owned fields with merge semantics. It must
not overwrite `groupId` or a management status chosen elsewhere.

### Device group

```ts
interface DeviceGroupDoc {
  v: 1;
  name: string;
  createdAt: number;
  updatedAt: number;
}
```

Membership is stored on each client metadata document. Keeping membership out
of an array on the group avoids concurrent whole-array updates.

## Legacy compatibility

Every device sync document is usable even when no client metadata or device
group exists.

The reader builds a virtual legacy client using:

- `generatedLabel` from `DeviceSyncDoc.label`
- `lastSeenAt` from `DeviceSyncDoc.lastSyncedAt`
- `origin` unknown
- `status` active
- a deterministic virtual group based on the generated label

Identical legacy labels therefore collapse into a reasonable default device in
Activity. The grouping is only a presentation rule: every underlying
`deviceId` remains available and can later be split or reassigned.

When an existing client becomes active under the new app, it creates or enriches
the metadata record for its exact existing `deviceId`, including the current
origin and channel. It does not claim that `registeredAt` is the original
creation time; it is the time metadata registration was first observed.

## Device projection

The UI consumes a pure projection with these concepts:

```ts
interface DeviceClient {
  deviceId: string;
  doc: DeviceSyncDoc;
  metadata: ClientMetadataDoc;
  isCurrent: boolean;
}

interface LogicalDevice {
  id: string;
  name: string;
  clients: DeviceClient[];
  deviceIds: string[];
  lastSeenAt: number;
  isCurrent: boolean;
}
```

Archived and forgotten clients are omitted from normal Activity projection.
The Devices page can reveal archived clients for restoration or deletion.

Activity filtering scopes facts to all `deviceIds` in the selected logical
device. Existing playback deduplication then selects the newest fact per media
identity without changing source data.

## Management operations

### Rename device

Update only the `DeviceGroupDoc.name`. A virtual legacy group is materialized
first, then renamed.

### Merge devices

Materialize the target group if needed and set each source client's `groupId`
to the target. Delete an empty source group document after reassignment.

### Split client into a new device

Create a group named from the client's generated label and assign that single
client to it. Remaining clients stay in their original or virtual group.

### Archive and restore

Set client metadata status to `archived` or `active`. The playback snapshot is
retained. This is the preferred cleanup operation.

### Forget client

Delete the raw device sync document but retain client metadata with status
`forgotten` as a tombstone. The tombstone keeps a still-running old client from
reappearing in modern UI if it recreates its raw document. Forgetting the
current client is prohibited. Restoring a forgotten client sets it active; its
raw document reappears only if that client syncs again.

## Display and diagnostics

Activity shows one filter per logical device rather than one per client. The
current logical device is labeled `This device`; duplicate generated labels no
longer produce duplicate pills.

Devices shows logical device cards with nested client instances. Each client
shows:

- generated platform/browser label
- origin or `Origin unknown` for legacy data
- production/development/extension context
- short `deviceId` suffix
- last-seen time
- current, archived, or forgotten state

Management controls are available from the logical device and client rows.

## Offline behavior

The existing cached remote playback remains readable without a Firestore
connection. When grouping metadata is unavailable, Activity falls back to the
same deterministic label grouping used for legacy clients. Durable offline
caching of management metadata can be added later with an additive Dexie table;
it is not required for this rollout.

## Security rules and deployment

Firestore rules add owner-only access for `clientMeta` and `deviceGroups` under
the existing user sync namespace. Rules must be deployed before a production
app starts writing the new collections:

```bash
pnpm -w run firebase:deploy-rules
```

There is no bulk schema or playback-data migration. Deployment consists of:

1. Deploy additive Firestore rules.
2. Deploy the compatible app reader/writer and management UI.
3. Let active clients register metadata lazily.
4. Let users materialize groups through management actions.

Rollback leaves the original device documents intact and readable by old app
versions. Old versions simply continue showing raw client records.

## Implementation slices

- [x] Pure client/group types, legacy projection, and unit tests
- [x] Firestore client metadata/group CRUD and current-client registration
- [x] Owner-only Firestore rules for new collections
- [x] Group-aware Activity filters and fact scoping
- [x] Grouped Devices page with client diagnostics
- [x] Rename, merge, split, archive, restore, and forget operations
- [x] Unit tests for grouping, legacy fallback, management transformations, and
      archived/forgotten visibility
- [x] Typecheck, unit tests, lint, formatting, and production builds

## Acceptance criteria

- Existing device and playback records work without modification.
- Identically labeled legacy Mac clients appear as one default Activity device.
- Production and localhost instances are distinguishable in Devices after each
  active client registers metadata.
- A user can rename a logical device and reversibly merge or split clients.
- Archived clients disappear from Activity without losing playback facts.
- Forgotten non-current clients stay suppressed if an old client resyncs.
- Old clients cannot overwrite group names, membership, or management status.
- The current client cannot be forgotten.

## Verification record

Verified locally on 2026-08-05:

- Firestore rules compiled and loaded in the Firebase Firestore emulator.
- TypeScript typecheck passed.
- All 242 unit tests passed.
- Biome lint passed with two pre-existing warnings outside this feature.
- Biome formatting completed with no remaining changes.
- The library build and production app build passed.
