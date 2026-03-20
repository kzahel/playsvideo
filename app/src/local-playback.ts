import { db, type PlaybackEntry, type WatchState } from './db.js';

export async function getLocalPlayback(
  deviceId: string,
  playbackKey: string,
): Promise<PlaybackEntry | undefined> {
  return db.playback.get([deviceId, playbackKey]);
}

export async function putLocalPlayback(input: {
  deviceId: string;
  playbackKey: string;
  positionSec: number;
  durationSec: number;
  watchState: WatchState;
  lastPlayedAt: number;
}): Promise<PlaybackEntry> {
  const row: PlaybackEntry = {
    deviceId: input.deviceId,
    playbackKey: input.playbackKey,
    positionSec: input.positionSec,
    durationSec: input.durationSec,
    watchState: input.watchState,
    lastPlayedAt: input.lastPlayedAt,
    updatedAt: Date.now(),
  };
  await db.playback.put(row);
  return row;
}
