import { describe, expect, it } from 'vitest';
import {
  mergeDeviceDocs,
  type RemoteDeviceState,
  type SyncEntry,
} from '../../../app/src/firebase.js';

function makeEntry(overrides: Partial<SyncEntry> = {}): SyncEntry {
  return {
    position: 0,
    watchState: 'unwatched',
    durationSec: 3600,
    watchedAt: 1000,
    ...overrides,
  };
}

function makeDevice(
  deviceId: string,
  label: string,
  entries: Record<string, SyncEntry>,
): RemoteDeviceState {
  return {
    deviceId,
    doc: { v: 2, label, lastSyncedAt: Date.now(), entries },
  };
}

describe('mergeDeviceDocs', () => {
  it('returns empty map for no devices', () => {
    const result = mergeDeviceDocs([]);
    expect(result.size).toBe(0);
  });

  it('returns entries from a single device', () => {
    const devices = [
      makeDevice('d1', 'Mac · Chrome', {
        'hash:abc123': makeEntry({ position: 120, watchState: 'in-progress', watchedAt: 5000 }),
      }),
    ];
    const result = mergeDeviceDocs(devices);
    expect(result.size).toBe(1);
    const entry = result.get('hash:abc123')!;
    expect(entry.position).toBe(120);
    expect(entry.sourceDeviceId).toBe('d1');
    expect(entry.sourceDeviceLabel).toBe('Mac · Chrome');
  });

  it('picks most recent watchedAt across devices', () => {
    const devices = [
      makeDevice('phone', 'Android · Chrome', {
        'hash:abc123': makeEntry({ position: 300, watchState: 'in-progress', watchedAt: 2000 }),
      }),
      makeDevice('desktop', 'Mac · Chrome', {
        'hash:abc123': makeEntry({ position: 600, watchState: 'in-progress', watchedAt: 5000 }),
      }),
    ];
    const result = mergeDeviceDocs(devices);
    const entry = result.get('hash:abc123')!;
    expect(entry.position).toBe(600);
    expect(entry.sourceDeviceId).toBe('desktop');
  });

  it('keeps entries unique to each device', () => {
    const devices = [
      makeDevice('phone', 'Android', {
        'torrent:aaa:0': makeEntry({ position: 100, watchedAt: 1000 }),
      }),
      makeDevice('desktop', 'Mac', {
        'hash:bbb': makeEntry({ position: 200, watchedAt: 2000 }),
      }),
    ];
    const result = mergeDeviceDocs(devices);
    expect(result.size).toBe(2);
    expect(result.get('torrent:aaa:0')!.position).toBe(100);
    expect(result.get('hash:bbb')!.position).toBe(200);
  });

  it('never loses data — all keys present in output', () => {
    const devices = [
      makeDevice('d1', 'A', {
        'hash:a': makeEntry({ watchedAt: 1 }),
        'hash:b': makeEntry({ watchedAt: 3 }),
      }),
      makeDevice('d2', 'B', {
        'hash:b': makeEntry({ watchedAt: 2 }),
        'hash:c': makeEntry({ watchedAt: 4 }),
      }),
    ];
    const result = mergeDeviceDocs(devices);
    expect(result.size).toBe(3);
    expect(result.has('hash:a')).toBe(true);
    expect(result.has('hash:b')).toBe(true);
    expect(result.has('hash:c')).toBe(true);
    // hash:b should come from d1 (watchedAt 3 > 2)
    expect(result.get('hash:b')!.sourceDeviceId).toBe('d1');
  });

  it('preserves torrent metadata in merged entries', () => {
    const devices = [
      makeDevice('d1', 'Phone', {
        'torrent:infohash123:5': makeEntry({
          position: 42,
          watchedAt: 9000,
          torrentInfoHash: 'infohash123',
          torrentFileIndex: 5,
          torrentMagnetUrl: 'magnet:?xt=urn:btih:infohash123&tr=udp://tracker.example.com',
          title: 'Big Buck Bunny',
        }),
      }),
    ];
    const result = mergeDeviceDocs(devices);
    const entry = result.get('torrent:infohash123:5')!;
    expect(entry.torrentInfoHash).toBe('infohash123');
    expect(entry.torrentFileIndex).toBe(5);
    expect(entry.torrentMagnetUrl).toContain('magnet:');
    expect(entry.title).toBe('Big Buck Bunny');
  });
});
