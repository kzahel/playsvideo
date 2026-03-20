import type { CatalogEntry, LibraryEntry, PlaybackEntry } from './db.js';

export interface LibraryPlaybackView extends LibraryEntry {
  playbackKey?: string;
}

export interface NowPlayingView {
  id: number;
  name: string;
  watchState: LibraryEntry['watchState'];
  durationSec: number;
  playbackPositionSec: number;
}

function directoryPathKey(directoryId: number | undefined, path: string): string | null {
  return directoryId == null ? null : `${directoryId}:${path}`;
}

function catalogForLibraryEntry(
  entry: LibraryEntry,
  catalogById: Map<number, CatalogEntry>,
  catalogByDirectoryPath: Map<string, CatalogEntry>,
): CatalogEntry | undefined {
  return (
    catalogById.get(entry.id) ??
    (directoryPathKey(entry.directoryId, entry.path)
      ? catalogByDirectoryPath.get(directoryPathKey(entry.directoryId, entry.path)!)
      : undefined)
  );
}

export function applyLocalPlaybackToLibraryEntries(input: {
  libraryEntries: LibraryEntry[];
  catalogEntries: CatalogEntry[];
  playbackEntries: PlaybackEntry[];
}): LibraryPlaybackView[] {
  const catalogById = new Map(input.catalogEntries.map((entry) => [entry.id, entry]));
  const catalogByDirectoryPath = new Map(
    input.catalogEntries.flatMap((entry) => {
      const key = directoryPathKey(entry.directoryId, entry.path);
      return key ? [[key, entry] as const] : [];
    }),
  );
  const playbackByKey = new Map(input.playbackEntries.map((entry) => [entry.playbackKey, entry]));

  return input.libraryEntries.map((entry) => {
    const catalogEntry = catalogForLibraryEntry(entry, catalogById, catalogByDirectoryPath);
    const playbackKey = catalogEntry?.canonicalPlaybackKey;
    const playback = playbackKey ? playbackByKey.get(playbackKey) : undefined;

    if (!playback) {
      return {
        ...entry,
        playbackKey,
        watchState: 'unwatched',
        playbackPositionSec: 0,
        durationSec: entry.durationSec,
      };
    }

    return {
      ...entry,
      playbackKey,
      watchState: playback.watchState,
      playbackPositionSec: playback.positionSec,
      durationSec: playback.durationSec > 0 ? playback.durationSec : entry.durationSec,
    };
  });
}

export function getNowPlayingView(input: {
  catalogEntries: CatalogEntry[];
  libraryEntries: LibraryEntry[];
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
  const libraryById = new Map(input.libraryEntries.map((entry) => [entry.id, entry]));
  const catalogEntry = catalogByPlaybackKey.get(playback.playbackKey);
  const libraryEntry = catalogEntry ? libraryById.get(catalogEntry.id) : undefined;
  const id = catalogEntry?.id ?? libraryEntry?.id;

  if (id == null) return null;

  return {
    id,
    name: libraryEntry?.name ?? catalogEntry?.parsedTitle ?? catalogEntry?.name ?? playback.playbackKey,
    watchState: playback.watchState,
    durationSec: playback.durationSec,
    playbackPositionSec: playback.positionSec,
  };
}
