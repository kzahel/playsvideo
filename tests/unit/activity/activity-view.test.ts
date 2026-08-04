import { describe, expect, it } from 'vitest';
import {
  activityFactsFromDeviceDocs,
  buildActivityGroups,
  listActivityDevices,
  type ActivityFact,
} from '../../../app/src/activity/activity-view.js';
import type { RemoteDeviceState } from '../../../app/src/sync-device-doc.js';

function fact(overrides: Partial<ActivityFact> = {}): ActivityFact {
  return {
    deviceId: 'device-a',
    deviceLabel: 'Mac · Chrome',
    playbackKey: 'file:Episode.mkv|1000',
    positionSec: 120,
    durationSec: 3600,
    watchState: 'in-progress',
    lastPlayedAt: 1000,
    ...overrides,
  };
}

describe('activity view projection', () => {
  it('keeps a torrent-backed episode without TMDB metadata', () => {
    const groups = buildActivityGroups({
      facts: [
        fact({
          playbackKey: 'torrent:abc:3',
          torrentInfoHash: 'abc',
          torrentFileIndex: 3,
          title: 'Example Show',
          seasonNumber: 1,
          episodeNumber: 4,
        }),
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe('tv');
    expect(groups[0].title).toBe('Example Show');
    expect(groups[0].items[0].episodeLabel).toBe('04');
  });

  it('filters facts by device before selecting the newest position', () => {
    const facts = [
      fact({ deviceId: 'mac', positionSec: 100, lastPlayedAt: 1000 }),
      fact({ deviceId: 'phone', positionSec: 200, lastPlayedAt: 2000 }),
    ];

    expect(buildActivityGroups({ facts })[0].items[0].fact.positionSec).toBe(200);
    expect(buildActivityGroups({ facts, deviceId: 'mac' })[0].items[0].fact.positionSec).toBe(100);
  });

  it('keeps rich metadata from an older fact while using the newest playback fact', () => {
    const groups = buildActivityGroups({
      facts: [
        fact({
          deviceId: 'mac',
          positionSec: 100,
          lastPlayedAt: 1000,
          torrentMagnetUrl: 'magnet:?xt=urn:btih:abc',
          title: 'Example',
        }),
        fact({ deviceId: 'phone', positionSec: 300, lastPlayedAt: 2000 }),
      ],
    });
    const selected = groups[0].items[0].fact;

    expect(selected.deviceId).toBe('phone');
    expect(selected.positionSec).toBe(300);
    expect(selected.torrentMagnetUrl).toBe('magnet:?xt=urn:btih:abc');
    expect(selected.title).toBe('Example');
  });

  it('orders groups and items by most recent playback', () => {
    const groups = buildActivityGroups({
      facts: [
        fact({
          playbackKey: 'file:early|1',
          title: 'Show',
          seasonNumber: 1,
          episodeNumber: 1,
          lastPlayedAt: 1000,
        }),
        fact({
          playbackKey: 'file:late|1',
          title: 'Show',
          seasonNumber: 1,
          episodeNumber: 9,
          lastPlayedAt: 9000,
        }),
        fact({ playbackKey: 'file:movie|1', title: 'Other', lastPlayedAt: 5000 }),
      ],
    });

    expect(groups[0].title).toBe('Show');
    expect(groups[0].items.map((item) => item.episodeLabel)).toEqual(['09', '01']);
  });

  it('indexes exact local playback keys without requiring TMDB', () => {
    const groups = buildActivityGroups({
      facts: [fact()],
      localEntryByPlaybackKey: new Map([['file:Episode.mkv|1000', 42]]),
    });

    expect(groups[0].items[0].localEntryId).toBe(42);
  });

  it('normalizes all entries from every device document', () => {
    const devices: RemoteDeviceState[] = [
      {
        deviceId: 'phone',
        doc: {
          v: 2,
          label: 'Android · Chrome',
          lastSyncedAt: 5000,
          entries: {
            'torrent:abc:1': {
              position: 50,
              durationSec: 100,
              watchState: 'in-progress',
              watchedAt: 4000,
              torrentInfoHash: 'abc',
              torrentFileIndex: 1,
            },
          },
        },
      },
    ];

    const facts = activityFactsFromDeviceDocs(devices);
    expect(facts).toEqual([
      expect.objectContaining({
        deviceId: 'phone',
        deviceLabel: 'Android · Chrome',
        deviceLastSyncedAt: 5000,
        playbackKey: 'torrent:abc:1',
      }),
    ]);
  });

  it('lists the current device first and remote devices by sync time', () => {
    const devices = listActivityDevices(
      [
        fact({ deviceId: 'old', deviceLabel: 'Old', deviceLastSyncedAt: 100 }),
        fact({ deviceId: 'new', deviceLabel: 'New', deviceLastSyncedAt: 300 }),
      ],
      'current',
      'Current',
    );

    expect(devices.map((device) => device.deviceId)).toEqual(['current', 'new', 'old']);
  });
});
