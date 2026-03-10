import Dexie, { type EntityTable } from 'dexie';

export type WatchState = 'unwatched' | 'in-progress' | 'watched';

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

class PlaysVideoDB extends Dexie {
  library!: EntityTable<LibraryEntry, 'id'>;
  directories!: EntityTable<DirectoryEntry, 'id'>;
  playlists!: EntityTable<PlaylistEntry, 'id'>;
  settings!: EntityTable<SettingEntry, 'key'>;

  constructor() {
    super('playsvideo');
    this.version(1).stores({
      library: '++id, directoryId, path, name, watchState, addedAt',
      directories: '++id, name',
      playlists: '++id, name',
      settings: 'key',
    });
  }
}

export const db = new PlaysVideoDB();
