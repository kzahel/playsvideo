import type { CatalogEntry, PlaybackEntry, WatchState } from './db.js';

export interface CatalogPlaybackView extends CatalogEntry {
  playbackKey?: string;
  watchState: WatchState;
  playbackPositionSec: number;
  durationSec: number;
}

export interface NowPlayingView {
  id: number;
  name: string;
  watchState: WatchState;
  durationSec: number;
  playbackPositionSec: number;
}

export function applyLocalPlaybackToCatalogEntries(input: {
  catalogEntries: CatalogEntry[];
  playbackEntries: PlaybackEntry[];
}): CatalogPlaybackView[] {
  const playbackByKey = new Map(input.playbackEntries.map((entry) => [entry.playbackKey, entry]));

  return input.catalogEntries.map((entry) => {
    const playbackKey = entry.canonicalPlaybackKey;
    const playback = playbackKey ? playbackByKey.get(playbackKey) : undefined;

    if (!playback) {
      return {
        ...entry,
        playbackKey,
        watchState: 'unwatched',
        playbackPositionSec: 0,
        durationSec: 0,
      };
    }

    return {
      ...entry,
      playbackKey,
      watchState: playback.watchState,
      playbackPositionSec: playback.positionSec,
      durationSec: playback.durationSec,
    };
  });
}

export function getNowPlayingView(input: {
  catalogEntries: CatalogEntry[];
  playbackEntries: PlaybackEntry[];
}): NowPlayingView | null {
  const playback = [...input.playbackEntries]
    .sort((left, right) => right.lastPlayedAt - left.lastPlayedAt)
    .find((entry) => entry.lastPlayedAt > 0);

  if (!playback) return null;

  const catalogByPlaybackKey = new Map(
    input.catalogEntries
      .filter((entry) => entry.canonicalPlaybackKey)
      .map((entry) => [entry.canonicalPlaybackKey!, entry]),
  );
  const catalogEntry = catalogByPlaybackKey.get(playback.playbackKey);
  const id = catalogEntry?.id;

  if (id == null) return null;

  return {
    id,
    name: catalogEntry?.parsedTitle ?? catalogEntry?.name ?? playback.playbackKey,
    watchState: playback.watchState,
    durationSec: playback.durationSec,
    playbackPositionSec: playback.positionSec,
  };
}
