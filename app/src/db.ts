import Dexie, { type EntityTable } from 'dexie';

export type WatchState = 'unwatched' | 'in-progress' | 'watched';
export type DetectedMediaType = 'tv' | 'movie' | 'unknown';
export type SeriesMetadataStatus = 'resolved' | 'not-found' | 'error';

export interface SeriesMetadataSearchCandidate {
  id: number;
  name: string;
  originalName?: string;
  firstAirDate?: string;
  score: number;
}

export interface LibraryEntry {
  id: number;
  directoryId: number;
  name: string;
  path: string;
  size: number;
  lastModified: number;
  watchState: WatchState;
  playbackPositionSec: number;
  durationSec: number;
  addedAt: number;
  detectedMediaType: DetectedMediaType;
  parsedTitle?: string;
  parsedYear?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  endingEpisodeNumber?: number;
  seriesMetadataKey?: string;
}

export interface DirectoryEntry {
  id: number;
  handle?: FileSystemDirectoryHandle;
  name: string;
  addedAt: number;
  lastScannedAt: number;
}

export interface PlaylistEntry {
  id: number;
  name: string;
  entryIds: number[];
  createdAt: number;
}

export interface SettingEntry {
  key: string;
  value: unknown;
}

export interface SeriesMetadataEntry {
  key: string;
  query: string;
  normalizedQuery: string;
  fetchedAt: number;
  status: SeriesMetadataStatus;
  year?: number;
  tmdbId?: number;
  name?: string;
  originalName?: string;
  overview?: string;
  firstAirDate?: string;
  posterUrl?: string;
  backdropUrl?: string;
  logoUrl?: string;
  debugSelectedScore?: number;
  debugReason?: string;
  debugError?: string;
  debugSearchCandidates?: SeriesMetadataSearchCandidate[];
}

class PlaysVideoDB extends Dexie {
  library!: EntityTable<LibraryEntry, 'id'>;
  directories!: EntityTable<DirectoryEntry, 'id'>;
  playlists!: EntityTable<PlaylistEntry, 'id'>;
  settings!: EntityTable<SettingEntry, 'key'>;
  seriesMetadata!: EntityTable<SeriesMetadataEntry, 'key'>;

  constructor() {
    super('playsvideo');
    this.version(1).stores({
      library: '++id, directoryId, path, name, watchState, addedAt',
      directories: '++id, name',
      playlists: '++id, name',
      settings: 'key',
    });
    this.version(2).stores({
      library:
        '++id, directoryId, path, name, watchState, addedAt, detectedMediaType, parsedTitle, seriesMetadataKey',
      directories: '++id, name',
      playlists: '++id, name',
      settings: 'key',
      seriesMetadata: 'key, tmdbId, fetchedAt, query',
    });
  }
}

export const db = new PlaysVideoDB();
