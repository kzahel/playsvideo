import { db } from '../db.js';
import type {
  LibraryEntry,
  MetadataCredentialSlot,
  MetadataParseCacheEntry,
  MetadataSeasonCacheEntry,
  MetadataTransportStateEntry,
  MetadataTransportKind,
  MovieMetadataEntry,
  ParsedLibraryFields,
  SeriesMetadataEntry,
} from '../db.js';
import { parseMediaMetadata } from '../media-metadata.js';

const TMDB_CONFIG_CACHE_KEY = 'tmdb-image-config-v1';
export const TMDB_READ_ACCESS_TOKEN_KEY = 'tmdb-read-access-token';
export const TMDB_STANDBY_READ_ACCESS_TOKEN_KEY = 'tmdb-read-access-token-standby';

export interface TmdbCredential {
  slot: MetadataCredentialSlot;
  token: string;
}

export interface CachedImageConfig {
  secureBaseUrl: string;
  posterSize: string;
  backdropSize: string;
  logoSize: string;
  fetchedAt: number;
}

function buildParseCacheKey(path: string, lastModified: number): string {
  return `${path}|${lastModified}`;
}

function toParsedLibraryFields(entry: LibraryEntry): ParsedLibraryFields {
  return {
    detectedMediaType: entry.detectedMediaType,
    parsedTitle: entry.parsedTitle,
    parsedYear: entry.parsedYear,
    seasonNumber: entry.seasonNumber,
    episodeNumber: entry.episodeNumber,
    endingEpisodeNumber: entry.endingEpisodeNumber,
    seriesMetadataKey: entry.seriesMetadataKey,
    movieMetadataKey: entry.movieMetadataKey,
  };
}

export const metadataRepository = {
  async hydrateParsedLibraryEntries(entries?: LibraryEntry[]): Promise<LibraryEntry[]> {
    const source = entries ?? (await db.library.toArray());
    if (source.length === 0) {
      return source;
    }

    const cacheKeys = source.map((entry) => buildParseCacheKey(entry.path, entry.lastModified));
    const cachedEntries = await db.metadataParseCache.bulkGet(cacheKeys);
    const cachedByKey = new Map(
      cachedEntries
        .filter((entry): entry is MetadataParseCacheEntry => Boolean(entry))
        .map((entry) => [entry.key, entry]),
    );

    const libraryUpdates: LibraryEntry[] = [];
    const parseCacheUpdates: MetadataParseCacheEntry[] = [];
    const hydrated = source.map((entry) => {
      const cacheKey = buildParseCacheKey(entry.path, entry.lastModified);
      const cached = cachedByKey.get(cacheKey);
      const hasParsedFields =
        entry.detectedMediaType &&
        entry.parsedTitle !== undefined &&
        (entry.detectedMediaType !== 'tv' || entry.seriesMetadataKey) &&
        (entry.detectedMediaType !== 'movie' || entry.movieMetadataKey);

      if (hasParsedFields) {
        if (!cached) {
          parseCacheUpdates.push({
            key: cacheKey,
            path: entry.path,
            lastModified: entry.lastModified,
            parsedAt: Date.now(),
            parsed: toParsedLibraryFields(entry),
          });
        }
        return entry;
      }

      const parsed = cached?.parsed ?? parseMediaMetadata(entry.path);
      const next: LibraryEntry = {
        ...entry,
        ...parsed,
      };

      libraryUpdates.push(next);

      if (!cached) {
        parseCacheUpdates.push({
          key: cacheKey,
          path: entry.path,
          lastModified: entry.lastModified,
          parsedAt: Date.now(),
          parsed,
        });
      }

      return next;
    });

    if (libraryUpdates.length > 0) {
      await db.library.bulkPut(libraryUpdates);
    }

    if (parseCacheUpdates.length > 0) {
      await db.metadataParseCache.bulkPut(parseCacheUpdates);
    }

    return hydrated;
  },

  async getTmdbCredential(slot: MetadataCredentialSlot): Promise<TmdbCredential | null> {
    const envKey =
      slot === 'primary'
        ? import.meta.env.VITE_TMDB_READ_ACCESS_TOKEN?.trim()
        : import.meta.env.VITE_TMDB_READ_ACCESS_TOKEN_STANDBY?.trim();
    if (envKey) {
      return { slot, token: envKey };
    }

    const settingKey =
      slot === 'primary' ? TMDB_READ_ACCESS_TOKEN_KEY : TMDB_STANDBY_READ_ACCESS_TOKEN_KEY;
    const configured = await db.settings.get(settingKey);
    if (typeof configured?.value === 'string' && configured.value.trim()) {
      return { slot, token: configured.value.trim() };
    }

    return null;
  },

  async listTmdbCredentials(): Promise<TmdbCredential[]> {
    const [primary, standby] = await Promise.all([
      this.getTmdbCredential('primary'),
      this.getTmdbCredential('standby'),
    ]);

    return [primary, standby].filter((entry): entry is TmdbCredential => Boolean(entry));
  },

  async getSeriesMetadataByKeys(keys: string[]): Promise<Map<string, SeriesMetadataEntry>> {
    const entries = await db.seriesMetadata.bulkGet(keys);
    return new Map(
      entries
        .filter((entry): entry is SeriesMetadataEntry => Boolean(entry))
        .map((entry) => [entry.key, entry]),
    );
  },

  async putSeriesMetadata(entry: SeriesMetadataEntry): Promise<void> {
    await db.seriesMetadata.put(entry);
  },

  async getSeriesMetadata(key: string): Promise<SeriesMetadataEntry | undefined> {
    return db.seriesMetadata.get(key);
  },

  async getMovieMetadataByKeys(keys: string[]): Promise<Map<string, MovieMetadataEntry>> {
    const entries = await db.movieMetadata.bulkGet(keys);
    return new Map(
      entries
        .filter((entry): entry is MovieMetadataEntry => Boolean(entry))
        .map((entry) => [entry.key, entry]),
    );
  },

  async putMovieMetadata(entry: MovieMetadataEntry): Promise<void> {
    await db.movieMetadata.put(entry);
  },

  async getMovieMetadata(key: string): Promise<MovieMetadataEntry | undefined> {
    return db.movieMetadata.get(key);
  },

  async getCachedImageConfig(maxAgeMs: number): Promise<CachedImageConfig | null> {
    const cached = await db.settings.get(TMDB_CONFIG_CACHE_KEY);
    if (isCachedImageConfig(cached?.value) && Date.now() - cached.value.fetchedAt < maxAgeMs) {
      return cached.value;
    }

    return null;
  },

  async setCachedImageConfig(config: CachedImageConfig): Promise<void> {
    await db.settings.put({ key: TMDB_CONFIG_CACHE_KEY, value: config });
  },

  async getSeasonCache(key: string): Promise<MetadataSeasonCacheEntry | undefined> {
    return db.metadataSeasonCache.get(key);
  },

  async putSeasonCache(entry: MetadataSeasonCacheEntry): Promise<void> {
    await db.metadataSeasonCache.put(entry);
  },

  async getTransportState(key: string): Promise<MetadataTransportStateEntry | undefined> {
    return db.metadataTransportState.get(key);
  },

  async putTransportState(entry: MetadataTransportStateEntry): Promise<void> {
    await db.metadataTransportState.put(entry);
  },

  async listTransportState(filters?: {
    transport?: MetadataTransportKind;
    credentialSlot?: MetadataCredentialSlot;
  }): Promise<MetadataTransportStateEntry[]> {
    const entries = await db.metadataTransportState.toArray();
    return entries.filter((entry) => {
      if (filters?.transport && entry.transport !== filters.transport) {
        return false;
      }
      if (filters?.credentialSlot && entry.credentialSlot !== filters.credentialSlot) {
        return false;
      }
      return true;
    });
  },

  async invalidateMetadata(keys?: string[]): Promise<void> {
    if (!keys || keys.length === 0) {
      await Promise.all([
        db.seriesMetadata.clear(),
        db.movieMetadata.clear(),
        db.metadataSeasonCache.clear(),
        db.metadataTransportState.clear(),
      ]);
      return;
    }

    await Promise.all([
      db.seriesMetadata.bulkDelete(keys),
      db.movieMetadata.bulkDelete(keys),
      db.metadataSeasonCache.bulkDelete(keys),
      db.metadataTransportState.bulkDelete(keys),
    ]);
  },
};

function isCachedImageConfig(value: unknown): value is CachedImageConfig {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'secureBaseUrl' in value &&
      'posterSize' in value &&
      'backdropSize' in value &&
      'logoSize' in value &&
      'fetchedAt' in value,
  );
}
