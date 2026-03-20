import { describe, expect, it } from 'vitest';
import {
  buildDeviceSyncDoc,
  flattenRemoteDeviceDocs,
  mergeRemoteDeviceDocs,
  type RemoteDeviceState,
} from '../../../app/src/sync-device-doc.js';

describe('sync-device-doc', () => {
  it('builds a device doc from playback facts and optional metadata', () => {
    const result = buildDeviceSyncDoc({
      label: 'Mac Chrome',
      lastSyncedAt: 123,
      playback: [
        {
          playbackKey: 'movie:1',
          positionSec: 150,
          durationSec: 3600,
          watchState: 'in-progress',
          lastPlayedAt: 100,
        },
        {
          playbackKey: 'movie:2',
          positionSec: 0,
          durationSec: 0,
          watchState: 'unwatched',
          lastPlayedAt: 50,
        },
      ],
      metadataByPlaybackKey: new Map([
        [
          'movie:1',
          {
            title: 'Movie',
            contentHash: 'hash1',
          },
        ],
      ]),
    });

    expect(result).toEqual({
      v: 2,
      label: 'Mac Chrome',
      lastSyncedAt: 123,
      entries: {
        'movie:1': {
          position: 150,
          watchState: 'in-progress',
          durationSec: 3600,
          watchedAt: 100,
          title: 'Movie',
          contentHash: 'hash1',
          torrentInfoHash: undefined,
          torrentFileIndex: undefined,
          torrentMagnetUrl: undefined,
          torrentComplete: undefined,
        },
      },
    });
  });

  it('flattens remote device docs into cache rows per device and playback key', () => {
    const devices: RemoteDeviceState[] = [
      {
        deviceId: 'self',
        doc: {
          v: 2,
          label: 'This Device',
          lastSyncedAt: 1,
          entries: {
            'movie:1': {
              position: 1,
              watchState: 'in-progress',
              durationSec: 100,
              watchedAt: 10,
            },
          },
        },
      },
      {
        deviceId: 'tv',
        doc: {
          v: 2,
          label: 'Living Room TV',
          lastSyncedAt: 2,
          entries: {
            'movie:1': {
              position: 20,
              watchState: 'in-progress',
              durationSec: 100,
              watchedAt: 30,
              title: 'Movie',
            },
          },
        },
      },
    ];

    const rows = flattenRemoteDeviceDocs(devices, {
      excludeDeviceId: 'self',
      updatedAt: 999,
    });

    expect(rows).toEqual([
      {
        deviceId: 'tv',
        deviceLabel: 'Living Room TV',
        playbackKey: 'movie:1',
        positionSec: 20,
        durationSec: 100,
        watchState: 'in-progress',
        lastPlayedAt: 30,
        title: 'Movie',
        updatedAt: 999,
      },
    ]);
  });

  it('merges remote docs by taking the newest watchedAt per playback key', () => {
    const devices: RemoteDeviceState[] = [
      {
        deviceId: 'phone',
        doc: {
          v: 2,
          label: 'Phone',
          lastSyncedAt: 1,
          entries: {
            'movie:1': {
              position: 20,
              watchState: 'in-progress',
              durationSec: 100,
              watchedAt: 30,
            },
          },
        },
      },
      {
        deviceId: 'tv',
        doc: {
          v: 2,
          label: 'TV',
          lastSyncedAt: 2,
          entries: {
            'movie:1': {
              position: 40,
              watchState: 'in-progress',
              durationSec: 100,
              watchedAt: 50,
            },
          },
        },
      },
    ];

    const merged = mergeRemoteDeviceDocs(devices).get('movie:1');

    expect(merged).toEqual({
      playbackKey: 'movie:1',
      position: 40,
      watchState: 'in-progress',
      durationSec: 100,
      watchedAt: 50,
      sourceDeviceId: 'tv',
      sourceDeviceLabel: 'TV',
    });
  });
});
