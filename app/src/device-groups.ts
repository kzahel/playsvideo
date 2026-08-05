import type { DeviceSyncDoc, RemoteDeviceState } from './sync-device-doc.js';

export type ClientStatus = 'active' | 'archived' | 'forgotten';
export type ClientKind = 'web' | 'extension';
export type ClientChannel = 'production' | 'development';

export interface ClientMetadataDoc {
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

export interface RemoteClientMetadataState {
  deviceId: string;
  doc: ClientMetadataDoc;
}

export interface DeviceGroupDoc {
  v: 1;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteDeviceGroupState {
  groupId: string;
  doc: DeviceGroupDoc;
}

export interface DeviceRegistryState {
  clients: RemoteClientMetadataState[];
  groups: RemoteDeviceGroupState[];
}

export interface DeviceClient {
  deviceId: string;
  syncDoc?: DeviceSyncDoc;
  generatedLabel: string;
  groupId?: string;
  origin?: string;
  kind?: ClientKind;
  channel?: ClientChannel;
  registeredAt?: number;
  lastSeenAt: number;
  status: ClientStatus;
  isLegacy: boolean;
  isCurrent: boolean;
}

export interface LogicalDevice {
  id: string;
  groupId?: string;
  name: string;
  clients: DeviceClient[];
  deviceIds: string[];
  lastSeenAt: number;
  isCurrent: boolean;
}

export const EMPTY_DEVICE_REGISTRY: DeviceRegistryState = {
  clients: [],
  groups: [],
};

function normalizedGeneratedLabel(label: string): string {
  return (
    label
      .normalize('NFKD')
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'unknown-device'
  );
}

export function virtualDeviceGroupId(label: string): string {
  return `virtual:${normalizedGeneratedLabel(label)}`;
}

export function isVirtualDeviceGroupId(groupId: string): boolean {
  return groupId.startsWith('virtual:');
}

export function projectLogicalDevices(input: {
  devices: RemoteDeviceState[];
  registry?: DeviceRegistryState;
  currentDeviceId?: string;
  currentDeviceLabel?: string;
  includeHidden?: boolean;
}): LogicalDevice[] {
  const registry = input.registry ?? EMPTY_DEVICE_REGISTRY;
  const syncDocsById = new Map(input.devices.map((device) => [device.deviceId, device.doc]));
  const metadataById = new Map(registry.clients.map((client) => [client.deviceId, client.doc]));
  const groupsById = new Map(registry.groups.map((group) => [group.groupId, group.doc]));
  const deviceIds = new Set([...syncDocsById.keys(), ...metadataById.keys()]);

  if (input.currentDeviceId) deviceIds.add(input.currentDeviceId);

  const logicalDevices = new Map<string, LogicalDevice>();
  for (const deviceId of deviceIds) {
    const syncDoc = syncDocsById.get(deviceId);
    const metadata = metadataById.get(deviceId);
    const status = metadata?.status ?? 'active';
    if (!input.includeHidden && status !== 'active') continue;

    const generatedLabel =
      metadata?.generatedLabel ??
      syncDoc?.label ??
      (deviceId === input.currentDeviceId ? input.currentDeviceLabel : undefined) ??
      'Unknown Device';
    const persistedGroup = metadata?.groupId ? groupsById.get(metadata.groupId) : undefined;
    const logicalId = metadata?.groupId ?? virtualDeviceGroupId(generatedLabel);
    const client: DeviceClient = {
      deviceId,
      syncDoc,
      generatedLabel,
      groupId: metadata?.groupId,
      origin: metadata?.origin,
      kind: metadata?.kind,
      channel: metadata?.channel,
      registeredAt: metadata?.registeredAt,
      lastSeenAt: Math.max(metadata?.lastSeenAt ?? 0, syncDoc?.lastSyncedAt ?? 0),
      status,
      isLegacy: metadata == null,
      isCurrent: deviceId === input.currentDeviceId,
    };
    const existing = logicalDevices.get(logicalId);
    if (existing) {
      existing.clients.push(client);
      existing.deviceIds.push(deviceId);
      existing.lastSeenAt = Math.max(existing.lastSeenAt, client.lastSeenAt);
      existing.isCurrent ||= client.isCurrent;
    } else {
      logicalDevices.set(logicalId, {
        id: logicalId,
        groupId: metadata?.groupId,
        name: persistedGroup?.name ?? generatedLabel,
        clients: [client],
        deviceIds: [deviceId],
        lastSeenAt: client.lastSeenAt,
        isCurrent: client.isCurrent,
      });
    }
  }

  return [...logicalDevices.values()]
    .map((device) => {
      const clients = [...device.clients].sort((left, right) => {
        if (left.isCurrent) return -1;
        if (right.isCurrent) return 1;
        return right.lastSeenAt - left.lastSeenAt;
      });
      return { ...device, clients, deviceIds: clients.map((client) => client.deviceId) };
    })
    .sort((left, right) => {
      if (left.isCurrent) return -1;
      if (right.isCurrent) return 1;
      return right.lastSeenAt - left.lastSeenAt;
    });
}

export function remoteDeviceStatesFromClientFacts(
  clients: Array<{ deviceId: string; label: string; lastSeenAt?: number }>,
): RemoteDeviceState[] {
  const devices = new Map<string, RemoteDeviceState>();
  for (const client of clients) {
    const existing = devices.get(client.deviceId);
    devices.set(client.deviceId, {
      deviceId: client.deviceId,
      doc: {
        v: 2,
        label: client.label,
        lastSyncedAt: Math.max(existing?.doc.lastSyncedAt ?? 0, client.lastSeenAt ?? 0),
        entries: {},
      },
    });
  }
  return [...devices.values()];
}

export function clientMetadataSeed(client: DeviceClient): ClientMetadataDoc {
  const observedAt = (client.registeredAt ?? client.lastSeenAt) || Date.now();
  return {
    v: 1,
    deviceId: client.deviceId,
    generatedLabel: client.generatedLabel,
    ...(client.groupId ? { groupId: client.groupId } : {}),
    ...(client.origin ? { origin: client.origin } : {}),
    kind: client.kind ?? 'web',
    channel: client.channel ?? 'production',
    registeredAt: observedAt,
    lastSeenAt: client.lastSeenAt || observedAt,
    status: client.status,
    ...(client.isLegacy ? { legacy: true } : {}),
  };
}

export function buildObservedClientMetadata(input: {
  deviceId: string;
  generatedLabel: string;
  origin?: string;
  kind: ClientKind;
  channel: ClientChannel;
  observedAt: number;
  existing?: ClientMetadataDoc;
}): ClientMetadataDoc {
  return {
    v: 1,
    deviceId: input.deviceId,
    generatedLabel: input.generatedLabel,
    ...(input.existing?.groupId ? { groupId: input.existing.groupId } : {}),
    ...(input.origin ? { origin: input.origin } : {}),
    kind: input.kind,
    channel: input.channel,
    registeredAt: input.existing?.registeredAt ?? input.observedAt,
    lastSeenAt: input.observedAt,
    status: input.existing?.status ?? 'active',
    legacy: false,
  };
}
