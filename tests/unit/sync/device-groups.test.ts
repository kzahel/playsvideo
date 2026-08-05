import { describe, expect, it } from 'vitest';
import {
  buildObservedClientMetadata,
  clientMetadataSeed,
  projectLogicalDevices,
  remoteDeviceStatesFromClientFacts,
  virtualDeviceGroupId,
  type DeviceRegistryState,
} from '../../../app/src/device-groups.js';
import type { RemoteDeviceState } from '../../../app/src/sync-device-doc.js';

function remoteDevice(deviceId: string, label: string, lastSyncedAt: number): RemoteDeviceState {
  return {
    deviceId,
    doc: { v: 2, label, lastSyncedAt, entries: {} },
  };
}

describe('logical device projection', () => {
  it('groups identically labeled legacy clients without changing their identities', () => {
    const devices = projectLogicalDevices({
      devices: [
        remoteDevice('production', 'Mac · Chrome', 100),
        remoteDevice('localhost', 'Mac · Chrome', 300),
        remoteDevice('phone', 'Android · Chrome', 200),
      ],
      currentDeviceId: 'localhost',
    });

    expect(devices).toHaveLength(2);
    expect(devices[0]).toEqual(
      expect.objectContaining({
        id: virtualDeviceGroupId('Mac · Chrome'),
        name: 'Mac · Chrome',
        deviceIds: ['localhost', 'production'],
        isCurrent: true,
      }),
    );
    expect(devices[0].clients.every((client) => client.isLegacy)).toBe(true);
    expect(devices[1].deviceIds).toEqual(['phone']);
  });

  it('uses persisted group names and membership across different labels', () => {
    const registry: DeviceRegistryState = {
      clients: [
        {
          deviceId: 'web',
          doc: {
            v: 1,
            deviceId: 'web',
            generatedLabel: 'Mac · Chrome',
            groupId: 'kyles-mac',
            origin: 'https://playsvideo.com',
            kind: 'web',
            channel: 'production',
            registeredAt: 10,
            lastSeenAt: 100,
            status: 'active',
          },
        },
        {
          deviceId: 'extension',
          doc: {
            v: 1,
            deviceId: 'extension',
            generatedLabel: 'Mac · Extension',
            groupId: 'kyles-mac',
            kind: 'extension',
            channel: 'production',
            registeredAt: 20,
            lastSeenAt: 200,
            status: 'active',
          },
        },
      ],
      groups: [
        {
          groupId: 'kyles-mac',
          doc: { v: 1, name: "Kyle's MacBook", createdAt: 1, updatedAt: 2 },
        },
      ],
    };

    const [device] = projectLogicalDevices({
      devices: [
        remoteDevice('web', 'Mac · Chrome', 100),
        remoteDevice('extension', 'Mac · Extension', 200),
      ],
      registry,
      currentDeviceId: 'web',
    });

    expect(device.name).toBe("Kyle's MacBook");
    expect(device.deviceIds).toEqual(['web', 'extension']);
    expect(device.clients[0]).toEqual(
      expect.objectContaining({
        deviceId: 'web',
        origin: 'https://playsvideo.com',
        isCurrent: true,
      }),
    );
  });

  it('reversibly splits a client by changing only registry membership', () => {
    const devices = [
      remoteDevice('production', 'Mac · Chrome', 100),
      remoteDevice('localhost', 'Mac · Chrome', 200),
    ];
    const mergedRegistry: DeviceRegistryState = {
      clients: devices.map((device) => ({
        deviceId: device.deviceId,
        doc: {
          v: 1,
          deviceId: device.deviceId,
          generatedLabel: device.doc.label,
          groupId: 'mac',
          kind: 'web',
          channel: 'production',
          registeredAt: 1,
          lastSeenAt: device.doc.lastSyncedAt,
          status: 'active',
        },
      })),
      groups: [{ groupId: 'mac', doc: { v: 1, name: 'My Mac', createdAt: 1, updatedAt: 1 } }],
    };
    expect(projectLogicalDevices({ devices, registry: mergedRegistry })).toHaveLength(1);

    const splitRegistry: DeviceRegistryState = {
      clients: mergedRegistry.clients.map((client) =>
        client.deviceId === 'localhost'
          ? { ...client, doc: { ...client.doc, groupId: 'dev-mac' } }
          : client,
      ),
      groups: [
        ...mergedRegistry.groups,
        {
          groupId: 'dev-mac',
          doc: { v: 1, name: 'Development Mac', createdAt: 2, updatedAt: 2 },
        },
      ],
    };
    const split = projectLogicalDevices({ devices, registry: splitRegistry });
    expect(split.map((device) => device.name)).toEqual(['Development Mac', 'My Mac']);
    expect(split.flatMap((device) => device.deviceIds).sort()).toEqual([
      'localhost',
      'production',
    ]);
  });

  it('omits archived and forgotten clients normally but reveals their tombstones', () => {
    const registry: DeviceRegistryState = {
      clients: [
        {
          deviceId: 'archived',
          doc: {
            v: 1,
            deviceId: 'archived',
            generatedLabel: 'Old Mac',
            kind: 'web',
            channel: 'production',
            registeredAt: 10,
            lastSeenAt: 100,
            status: 'archived',
          },
        },
        {
          deviceId: 'forgotten',
          doc: {
            v: 1,
            deviceId: 'forgotten',
            generatedLabel: 'Older Mac',
            kind: 'web',
            channel: 'production',
            registeredAt: 5,
            lastSeenAt: 50,
            status: 'forgotten',
          },
        },
      ],
      groups: [],
    };

    expect(
      projectLogicalDevices({
        devices: [remoteDevice('archived', 'Old Mac', 100)],
        registry,
      }),
    ).toEqual([]);

    const hidden = projectLogicalDevices({
      devices: [remoteDevice('archived', 'Old Mac', 100)],
      registry,
      includeHidden: true,
    });
    expect(hidden.flatMap((device) => device.clients).map((client) => client.status)).toEqual([
      'archived',
      'forgotten',
    ]);
    expect(
      hidden.flatMap((device) => device.clients).find((client) => client.status === 'forgotten'),
    ).toEqual(expect.objectContaining({ syncDoc: undefined }));
  });

  it('creates legacy device inputs from cached facts', () => {
    const states = remoteDeviceStatesFromClientFacts([
      { deviceId: 'mac', label: 'Mac · Chrome', lastSeenAt: 10 },
      { deviceId: 'mac', label: 'Mac · Chrome', lastSeenAt: 20 },
    ]);

    expect(states).toEqual([
      {
        deviceId: 'mac',
        doc: { v: 2, label: 'Mac · Chrome', lastSyncedAt: 20, entries: {} },
      },
    ]);
  });

  it('builds a safe metadata seed for a legacy client management action', () => {
    const [client] = projectLogicalDevices({
      devices: [remoteDevice('legacy', 'Mac · Chrome', 123)],
    })[0].clients;

    expect(clientMetadataSeed(client)).toEqual({
      v: 1,
      deviceId: 'legacy',
      generatedLabel: 'Mac · Chrome',
      kind: 'web',
      channel: 'production',
      registeredAt: 123,
      lastSeenAt: 123,
      status: 'active',
      legacy: true,
    });
  });

  it('enriches an active legacy client without losing managed state', () => {
    expect(
      buildObservedClientMetadata({
        deviceId: 'client',
        generatedLabel: 'Mac · Chrome',
        origin: 'https://playsvideo.com',
        kind: 'web',
        channel: 'production',
        observedAt: 500,
        existing: {
          v: 1,
          deviceId: 'client',
          generatedLabel: 'Old label',
          groupId: 'group',
          kind: 'web',
          channel: 'development',
          registeredAt: 100,
          lastSeenAt: 200,
          status: 'archived',
          legacy: true,
        },
      }),
    ).toEqual({
      v: 1,
      deviceId: 'client',
      generatedLabel: 'Mac · Chrome',
      groupId: 'group',
      origin: 'https://playsvideo.com',
      kind: 'web',
      channel: 'production',
      registeredAt: 100,
      lastSeenAt: 500,
      status: 'archived',
      legacy: false,
    });
  });
});
