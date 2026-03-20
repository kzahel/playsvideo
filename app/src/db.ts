import Dexie, { type EntityTable, type Table } from 'dexie';

export type WatchState = 'unwatched' | 'in-progress' | 'watched';
export type DetectedMediaType = 'tv' | 'movie' | 'unknown';
export type SeriesMetadataStatus = 'resolved' | 'not-found' | 'error';
export type MetadataTransportKind = 'direct' | 'proxy';
export type MetadataCredentialSlot = 'primary' | 'standby';
export type MetadataTransportStatus = 'healthy' | 'cooldown' | 'invalid';
export type CatalogAvailability = 'present' | 'missing';
export type PlaybackKeySource = 'file' | 'hash' | 'torrent' | 'tmdb';

export interface SeriesMetadataSearchCandidate {
  id: number;
  name: string;
  originalName?: string;
  firstAirDate?: string;
  score: number;
}

export interface SeriesMetadataSeasonSummary {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airDate?: string;
  overview?: string;
  posterUrl?: string;
}

export interface SeasonMetadataEpisode {
  episodeNumber: number;
  name: string;
  airDate?: string;
  overview?: string;
  runtimeMinutes?: number;
  episodeType?: string;
  stillUrl?: string;
}

export interface SeasonMetadataPayload {
  id: number;
  tmdbSeriesId: number;
  seasonNumber: number;
  name: string;
  airDate?: string;
  overview?: string;
  posterUrl?: string;
  episodeCount: number;
  episodes: SeasonMetadataEpisode[];
}

export interface CatalogEntry {
  id: number;
  createdAt: number;
  updatedAt: number;
  name: string;
  path: string;
  directoryId?: number;
  size: number;
  lastModified: number;
  availability: CatalogAvailability;
  lastSeenAt?: number;
  firstMissingAt?: number;
  detectedMediaType: DetectedMediaType;
  parsedTitle?: string;
  parsedYear?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  endingEpisodeNumber?: number;
  seriesMetadataKey?: string;
  movieMetadataKey?: string;
  contentHash?: string;
  torrentInfoHash?: string;
  torrentFileIndex?: number;
  torrentMagnetUrl?: string;
  torrentComplete?: boolean;
  hasLocalFile?: boolean;
  canonicalPlaybackKey?: string;
}

export interface PlaybackEntry {
  deviceId: string;
  playbackKey: string;
  positionSec: number;
  durationSec: number;
  watchState: WatchState;
  lastPlayedAt: number;
  updatedAt: number;
}

export interface RemotePlaybackEntry {
  deviceId: string;
  playbackKey: string;
  deviceLabel: string;
  positionSec: number;
  durationSec: number;
  watchState: WatchState;
  lastPlayedAt: number;
  title?: string;
  updatedAt: number;
}

export interface CatalogAliasEntry {
  catalogId: number;
  playbackKey: string;
  source: PlaybackKeySource;
  createdAt: number;
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
  seasonCount?: number;
  episodeCount?: number;
  seasons?: SeriesMetadataSeasonSummary[];
  debugSelectedScore?: number;
  debugReason?: string;
  debugError?: string;
  debugSearchCandidates?: SeriesMetadataSearchCandidate[];
}

export interface MovieMetadataEntry {
  key: string;
  query: string;
  normalizedQuery: string;
  fetchedAt: number;
  status: SeriesMetadataStatus;
  year?: number;
  tmdbId?: number;
  title?: string;
  originalTitle?: string;
  overview?: string;
  releaseDate?: string;
  posterUrl?: string;
  backdropUrl?: string;
  debugSelectedScore?: number;
  debugReason?: string;
  debugError?: string;
  debugSearchCandidates?: SeriesMetadataSearchCandidate[];
}

export type ParsedCatalogFields = Pick<
  CatalogEntry,
  | 'detectedMediaType'
  | 'parsedTitle'
  | 'parsedYear'
  | 'seasonNumber'
  | 'episodeNumber'
  | 'endingEpisodeNumber'
  | 'seriesMetadataKey'
  | 'movieMetadataKey'
>;

export interface MetadataParseCacheEntry {
  key: string;
  path: string;
  lastModified: number;
  parsedAt: number;
  parsed: ParsedCatalogFields;
}

export interface MetadataSeasonCacheEntry {
  key: string;
  seriesMetadataKey?: string;
  tmdbSeriesId: number;
  seasonNumber: number;
  fetchedAt: number;
  status: SeriesMetadataStatus;
  payload?: SeasonMetadataPayload;
  debugError?: string;
}

export interface MetadataTransportStateEntry {
  key: string;
  transport: MetadataTransportKind;
  credentialSlot?: MetadataCredentialSlot;
  status: MetadataTransportStatus;
  cooldownUntil?: number;
  lastError?: string;
  updatedAt: number;
}

class PlaysVideoDB extends Dexie {
  catalog!: EntityTable<CatalogEntry, 'id'>;
  playback!: Table<PlaybackEntry, [string, string]>;
  remotePlayback!: Table<RemotePlaybackEntry, [string, string]>;
  catalogAliases!: Table<CatalogAliasEntry, [number, string]>;
  directories!: EntityTable<DirectoryEntry, 'id'>;
  playlists!: EntityTable<PlaylistEntry, 'id'>;
  settings!: EntityTable<SettingEntry, 'key'>;
  seriesMetadata!: EntityTable<SeriesMetadataEntry, 'key'>;
  movieMetadata!: EntityTable<MovieMetadataEntry, 'key'>;
  metadataParseCache!: EntityTable<MetadataParseCacheEntry, 'key'>;
  metadataSeasonCache!: EntityTable<MetadataSeasonCacheEntry, 'key'>;
  metadataTransportState!: EntityTable<MetadataTransportStateEntry, 'key'>;

  constructor() {
    super('playsvideo');
    this.version(1).stores({
      directories: '++id, name',
      playlists: '++id, name',
      settings: 'key',
    });
    this.version(2).stores({
      directories: '++id, name',
      playlists: '++id, name',
      settings: 'key',
      seriesMetadata: 'key, tmdbId, fetchedAt, query',
    });
    this.version(3).stores({
      directories: '++id, name',
      playlists: '++id, name',
      settings: 'key',
      seriesMetadata: 'key, tmdbId, fetchedAt, query',
      movieMetadata: 'key, tmdbId, fetchedAt, query',
    });
    this.version(4).stores({
      directories: '++id, name',
      playlists: '++id, name',
      settings: 'key',
      seriesMetadata: 'key, tmdbId, fetchedAt, query',
      movieMetadata: 'key, tmdbId, fetchedAt, query',
      metadataParseCache: 'key, path, lastModified, parsedAt',
      metadataSeasonCache: 'key, tmdbSeriesId, seasonNumber, fetchedAt, status',
      metadataTransportState: 'key, transport, credentialSlot, status, cooldownUntil, updatedAt',
    });
    this.version(5).stores({
      directories: '++id, name',
      playlists: '++id, name',
      settings: 'key',
      seriesMetadata: 'key, tmdbId, fetchedAt, query',
      movieMetadata: 'key, tmdbId, fetchedAt, query',
      metadataParseCache: 'key, path, lastModified, parsedAt',
      metadataSeasonCache: 'key, seriesMetadataKey, tmdbSeriesId, seasonNumber, fetchedAt, status',
      metadataTransportState: 'key, transport, credentialSlot, status, cooldownUntil, updatedAt',
    });
    this.version(6).stores({
      directories: '++id, name',
      playlists: '++id, name',
      settings: 'key',
      seriesMetadata: 'key, tmdbId, fetchedAt, query',
      movieMetadata: 'key, tmdbId, fetchedAt, query',
      metadataParseCache: 'key, path, lastModified, parsedAt',
      metadataSeasonCache: 'key, seriesMetadataKey, tmdbSeriesId, seasonNumber, fetchedAt, status',
      metadataTransportState: 'key, transport, credentialSlot, status, cooldownUntil, updatedAt',
    });
    this.version(7).stores({
      directories: '++id, name',
      playlists: '++id, name',
      settings: 'key',
      seriesMetadata: 'key, tmdbId, fetchedAt, query',
      movieMetadata: 'key, tmdbId, fetchedAt, query',
      metadataParseCache: 'key, path, lastModified, parsedAt',
      metadataSeasonCache: 'key, seriesMetadataKey, tmdbSeriesId, seasonNumber, fetchedAt, status',
      metadataTransportState: 'key, transport, credentialSlot, status, cooldownUntil, updatedAt',
    });
    this.version(8).stores({
      directories: '++id, name',
      playlists: '++id, name',
      settings: 'key',
      seriesMetadata: 'key, tmdbId, fetchedAt, query',
      movieMetadata: 'key, tmdbId, fetchedAt, query',
      metadataParseCache: 'key, path, lastModified, parsedAt',
      metadataSeasonCache: 'key, seriesMetadataKey, tmdbSeriesId, seasonNumber, fetchedAt, status',
      metadataTransportState: 'key, transport, credentialSlot, status, cooldownUntil, updatedAt',
    });
    this.version(9).stores({
      catalog:
        '++id, directoryId, path, name, availability, lastSeenAt, firstMissingAt, detectedMediaType, parsedTitle, seriesMetadataKey, movieMetadataKey, canonicalPlaybackKey, contentHash, torrentInfoHash, hasLocalFile, [directoryId+path], [torrentInfoHash+torrentFileIndex]',
      playback: '[deviceId+playbackKey], deviceId, playbackKey, watchState, lastPlayedAt, updatedAt',
      remotePlayback:
        '[deviceId+playbackKey], deviceId, playbackKey, watchState, lastPlayedAt, updatedAt',
      catalogAliases: '[catalogId+playbackKey], catalogId, playbackKey, source, createdAt',
      directories: '++id, name',
      playlists: '++id, name',
      settings: 'key',
      seriesMetadata: 'key, tmdbId, fetchedAt, query',
      movieMetadata: 'key, tmdbId, fetchedAt, query',
      metadataParseCache: 'key, path, lastModified, parsedAt',
      metadataSeasonCache: 'key, seriesMetadataKey, tmdbSeriesId, seasonNumber, fetchedAt, status',
      metadataTransportState: 'key, transport, credentialSlot, status, cooldownUntil, updatedAt',
    });
    this.version(10).stores({
      catalog:
        '++id, directoryId, path, name, availability, lastSeenAt, firstMissingAt, detectedMediaType, parsedTitle, seriesMetadataKey, movieMetadataKey, canonicalPlaybackKey, contentHash, torrentInfoHash, hasLocalFile, [directoryId+path], [torrentInfoHash+torrentFileIndex]',
      playback: '[deviceId+playbackKey], deviceId, playbackKey, watchState, lastPlayedAt, updatedAt',
      remotePlayback:
        '[deviceId+playbackKey], deviceId, playbackKey, watchState, lastPlayedAt, updatedAt',
      catalogAliases: '[catalogId+playbackKey], catalogId, playbackKey, source, createdAt',
      directories: '++id, name',
      playlists: '++id, name',
      settings: 'key',
      seriesMetadata: 'key, tmdbId, fetchedAt, query',
      movieMetadata: 'key, tmdbId, fetchedAt, query',
      metadataParseCache: 'key, path, lastModified, parsedAt',
      metadataSeasonCache: 'key, seriesMetadataKey, tmdbSeriesId, seasonNumber, fetchedAt, status',
      metadataTransportState: 'key, transport, credentialSlot, status, cooldownUntil, updatedAt',
    });
  }
}

export const db = new PlaysVideoDB();
