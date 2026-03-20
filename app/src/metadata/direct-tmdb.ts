import {
  type MetadataSeasonCacheEntry,
  type MovieMetadataEntry,
  type SeasonMetadataPayload,
  type SeriesMetadataEntry,
  type SeriesMetadataSearchCandidate,
  type SeriesMetadataSeasonSummary,
} from '../db.js';
import type { CachedImageConfig } from './repository.js';
import {
  buildMovieMetadataKey,
  buildSeriesMetadataKey,
  normalizeLookupText,
} from '../media-metadata.js';
import { metadataCoordinator } from './coordinator.js';
import { metadataRepository } from './repository.js';
import type {
  MetadataClient,
  RefreshLibraryMetadataOptions,
  RefreshSeriesSeasonsOptions,
} from './types.js';
import { buildSeasonMetadataCacheKey } from './types.js';

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';
const CONFIG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESOLVED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ERROR_TTL_MS = 6 * 60 * 60 * 1000;

interface TmdbSearchResult {
  id: number;
  name: string;
  original_name?: string;
  first_air_date?: string;
  title?: string;
  original_title?: string;
  release_date?: string;
  popularity?: number;
}

interface TmdbSearchResponse {
  results: TmdbSearchResult[];
}

interface TmdbImageAsset {
  file_path?: string;
  iso_639_1?: string | null;
  vote_average?: number;
}

interface TmdbTvDetails {
  id: number;
  name: string;
  original_name?: string;
  first_air_date?: string;
  number_of_seasons?: number;
  number_of_episodes?: number;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  seasons?: Array<{
    season_number: number;
    name: string;
    episode_count?: number;
    air_date?: string;
    overview?: string;
    poster_path?: string;
  }>;
  images?: {
    logos?: TmdbImageAsset[];
  };
}

interface TmdbSeasonDetails {
  id: number;
  name: string;
  air_date?: string;
  overview?: string;
  poster_path?: string;
  season_number: number;
  episodes?: Array<{
    episode_number: number;
    name: string;
    air_date?: string;
    overview?: string;
    runtime?: number;
    episode_type?: string;
    still_path?: string;
  }>;
}

interface TmdbMovieDetails {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
}

interface TmdbConfigResponse {
  images?: {
    secure_base_url?: string;
    poster_sizes?: string[];
    backdrop_sizes?: string[];
    logo_sizes?: string[];
  };
}

interface SeriesLookupCandidate {
  key: string;
  title: string;
  normalizedTitle: string;
  year?: number;
}

interface MovieLookupCandidate {
  key: string;
  title: string;
  normalizedTitle: string;
  year?: number;
}

export const directTmdbMetadataClient: MetadataClient = {
  refreshLibraryMetadata,
  refreshSeriesSeasons,
  getTransportState() {
    return metadataRepository.listTransportState({ transport: 'direct' });
  },
  invalidateMetadata(keys?: string[]): Promise<void> {
    return metadataRepository.invalidateMetadata(keys);
  },
};

export { TMDB_READ_ACCESS_TOKEN_KEY } from './settings.js';

export async function refreshLibraryMetadata(
  options?: RefreshLibraryMetadataOptions,
): Promise<void> {
  const entries = await metadataRepository.hydrateParsedCatalogEntries(options?.entries);
  if (!(await metadataRepository.areTmdbRequestsEnabled())) return;
  const credentials = await metadataRepository.listTmdbCredentials();
  if (credentials.length === 0) return;

  const seriesCandidates = new Map<string, SeriesLookupCandidate>();
  const movieCandidates = new Map<string, MovieLookupCandidate>();
  for (const entry of entries) {
    if (!entry.parsedTitle) continue;

    if (entry.detectedMediaType === 'tv') {
      const key =
        entry.seriesMetadataKey ?? buildSeriesMetadataKey(entry.parsedTitle, entry.parsedYear);
      seriesCandidates.set(key, {
        key,
        title: entry.parsedTitle,
        normalizedTitle: normalizeLookupText(entry.parsedTitle),
        year: entry.parsedYear,
      });
      continue;
    }

    if (entry.detectedMediaType === 'movie') {
      const key =
        entry.movieMetadataKey ?? buildMovieMetadataKey(entry.parsedTitle, entry.parsedYear);
      movieCandidates.set(key, {
        key,
        title: entry.parsedTitle,
        normalizedTitle: normalizeLookupText(entry.parsedTitle),
        year: entry.parsedYear,
      });
    }
  }

  if (seriesCandidates.size === 0 && movieCandidates.size === 0) return;

  if (seriesCandidates.size > 0) {
    const existingByKey = await metadataRepository.getSeriesMetadataByKeys(
      Array.from(seriesCandidates.keys()),
    );

    for (const candidate of seriesCandidates.values()) {
      const existing = existingByKey.get(candidate.key);
      if (!options?.force && existing && !isMetadataStale(existing)) {
        continue;
      }

      const metadata = await lookupSeriesMetadata(candidate);
      await metadataRepository.putSeriesMetadata(metadata);
    }
  }

  if (movieCandidates.size > 0) {
    const existingByKey = await metadataRepository.getMovieMetadataByKeys(
      Array.from(movieCandidates.keys()),
    );

    for (const candidate of movieCandidates.values()) {
      const existing = existingByKey.get(candidate.key);
      if (!options?.force && existing && !isMetadataStale(existing)) {
        continue;
      }

      const metadata = await lookupMovieMetadata(candidate);
      await metadataRepository.putMovieMetadata(metadata);
    }
  }
}

export async function refreshSeriesSeasons(
  options: RefreshSeriesSeasonsOptions,
): Promise<void> {
  if (!(await metadataRepository.areTmdbRequestsEnabled())) return;

  let series = await metadataRepository.getSeriesMetadata(options.seriesKey);
  if (!series) {
    return;
  }

  if (series.status !== 'resolved') {
    if (!options.force && !isMetadataStale(series)) {
      return;
    }

    series = await refreshSeriesMetadataEntry(series);
    await metadataRepository.putSeriesMetadata(series);
    if (series.status !== 'resolved') {
      return;
    }
  } else if (options.force || needsSeasonSummaryRefresh(series)) {
    series = await refreshSeriesMetadataEntry(series);
    await metadataRepository.putSeriesMetadata(series);
    if (series.status !== 'resolved') {
      return;
    }
  }

  const seasonSummaries = series.seasons ?? [];
  if (seasonSummaries.length === 0 || series.tmdbId == null) {
    return;
  }

  const requestedSeasonNumbers = normalizeRequestedSeasonNumbers(options.seasonNumbers);
  const seasonsToFetch =
    requestedSeasonNumbers.length > 0
      ? seasonSummaries.filter((season) => requestedSeasonNumbers.includes(season.seasonNumber))
      : seasonSummaries;
  if (seasonsToFetch.length === 0) {
    return;
  }

  const imageConfig = await getCachedImageConfig();
  for (const season of seasonsToFetch) {
    const cacheKey = buildSeasonMetadataCacheKey(series.key, season.seasonNumber);
    const existing = await metadataRepository.getSeasonCache(cacheKey);
    if (!options.force && existing && !isSeasonMetadataStale(existing)) {
      continue;
    }

    const refreshed = await lookupSeasonMetadata(series, season.seasonNumber, imageConfig);
    await metadataRepository.putSeasonCache(refreshed);
  }
}

async function lookupSeriesMetadata(
  candidate: SeriesLookupCandidate,
): Promise<SeriesMetadataEntry> {
  try {
    const search = await tmdbRequest<TmdbSearchResponse>('/search/tv', {
      query: candidate.title,
      language: 'en-US',
      include_adult: 'false',
      ...(candidate.year ? { first_air_date_year: String(candidate.year) } : {}),
    });
    const scored = scoreSearchResults(candidate, search.results ?? []);
    const debugCandidates = scored.slice(0, 5).map((item) => ({
      id: item.result.id,
      name: item.result.name,
      originalName: item.result.original_name,
      firstAirDate: item.result.first_air_date,
      score: Math.round(item.score * 10) / 10,
    })) satisfies SeriesMetadataSearchCandidate[];
    const best = scored[0];
    const match = best && best.score >= 55 ? best.result : undefined;
    if (!match) {
      return {
        key: candidate.key,
        query: candidate.title,
        normalizedQuery: candidate.normalizedTitle,
        year: candidate.year,
        fetchedAt: Date.now(),
        status: 'not-found',
        debugReason: best
          ? `Best score ${Math.round(best.score * 10) / 10} was below threshold 55`
          : 'TMDB search returned no results',
        debugSearchCandidates: debugCandidates,
      };
    }

    const details = await tmdbRequest<TmdbTvDetails>(`/tv/${match.id}`, {
      language: 'en-US',
      append_to_response: 'images',
      include_image_language: 'en,null',
    });
    const imageConfig = await getCachedImageConfig();
    const logoAsset = chooseBestLogo(details.images?.logos ?? []);

    return {
      key: candidate.key,
      query: candidate.title,
      normalizedQuery: candidate.normalizedTitle,
      year: candidate.year,
      fetchedAt: Date.now(),
      status: 'resolved',
      tmdbId: details.id,
      name: details.name,
      originalName: details.original_name,
      overview: details.overview,
      firstAirDate: details.first_air_date,
      posterUrl: buildImageUrl(
        imageConfig.secureBaseUrl,
        imageConfig.posterSize,
        details.poster_path,
      ),
      backdropUrl: buildImageUrl(
        imageConfig.secureBaseUrl,
        imageConfig.backdropSize,
        details.backdrop_path,
      ),
      logoUrl: buildImageUrl(imageConfig.secureBaseUrl, imageConfig.logoSize, logoAsset?.file_path),
      seasonCount: details.number_of_seasons,
      episodeCount: details.number_of_episodes,
      seasons: buildSeasonSummaries(details, imageConfig),
      debugSelectedScore: Math.round(best.score * 10) / 10,
      debugReason: `Matched candidate above threshold 55`,
      debugSearchCandidates: debugCandidates,
    };
  } catch (error) {
    return {
      key: candidate.key,
      query: candidate.title,
      normalizedQuery: candidate.normalizedTitle,
      year: candidate.year,
      fetchedAt: Date.now(),
      status: 'error',
      debugReason: 'TMDB request failed',
      debugError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function lookupSeasonMetadata(
  series: SeriesMetadataEntry,
  seasonNumber: number,
  imageConfig: CachedImageConfig,
): Promise<MetadataSeasonCacheEntry> {
  if (series.tmdbId == null) {
    return {
      key: buildSeasonMetadataCacheKey(series.key, seasonNumber),
      seriesMetadataKey: series.key,
      tmdbSeriesId: -1,
      seasonNumber,
      fetchedAt: Date.now(),
      status: 'error',
      debugError: 'TMDB series id is unavailable',
    };
  }

  try {
    const details = await tmdbRequest<TmdbSeasonDetails>(`/tv/${series.tmdbId}/season/${seasonNumber}`, {
      language: 'en-US',
    });

    return {
      key: buildSeasonMetadataCacheKey(series.key, seasonNumber),
      seriesMetadataKey: series.key,
      tmdbSeriesId: series.tmdbId,
      seasonNumber,
      fetchedAt: Date.now(),
      status: 'resolved',
      payload: toSeasonPayload(series.tmdbId, details, imageConfig),
    };
  } catch (error) {
    return {
      key: buildSeasonMetadataCacheKey(series.key, seasonNumber),
      seriesMetadataKey: series.key,
      tmdbSeriesId: series.tmdbId,
      seasonNumber,
      fetchedAt: Date.now(),
      status: 'error',
      debugError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function lookupMovieMetadata(
  candidate: MovieLookupCandidate,
): Promise<MovieMetadataEntry> {
  try {
    const search = await tmdbRequest<TmdbSearchResponse>('/search/movie', {
      query: candidate.title,
      language: 'en-US',
      include_adult: 'false',
      ...(candidate.year ? { primary_release_year: String(candidate.year) } : {}),
    });
    const scored = scoreSearchResults(candidate, search.results ?? [], 'movie');
    const debugCandidates = scored.slice(0, 5).map((item) => ({
      id: item.result.id,
      name: item.result.title ?? item.result.name ?? '',
      originalName: item.result.original_title ?? item.result.original_name,
      firstAirDate: item.result.release_date ?? item.result.first_air_date,
      score: Math.round(item.score * 10) / 10,
    })) satisfies SeriesMetadataSearchCandidate[];
    const best = scored[0];
    const match = best && best.score >= 55 ? best.result : undefined;
    if (!match) {
      return {
        key: candidate.key,
        query: candidate.title,
        normalizedQuery: candidate.normalizedTitle,
        year: candidate.year,
        fetchedAt: Date.now(),
        status: 'not-found',
        debugReason: best
          ? `Best score ${Math.round(best.score * 10) / 10} was below threshold 55`
          : 'TMDB search returned no results',
        debugSearchCandidates: debugCandidates,
      };
    }

    const details = await tmdbRequest<TmdbMovieDetails>(`/movie/${match.id}`, {
      language: 'en-US',
    });
    const imageConfig = await getCachedImageConfig();

    return {
      key: candidate.key,
      query: candidate.title,
      normalizedQuery: candidate.normalizedTitle,
      year: candidate.year,
      fetchedAt: Date.now(),
      status: 'resolved',
      tmdbId: details.id,
      title: details.title,
      originalTitle: details.original_title,
      overview: details.overview,
      releaseDate: details.release_date,
      posterUrl: buildImageUrl(
        imageConfig.secureBaseUrl,
        imageConfig.posterSize,
        details.poster_path,
      ),
      backdropUrl: buildImageUrl(
        imageConfig.secureBaseUrl,
        imageConfig.backdropSize,
        details.backdrop_path,
      ),
      debugSelectedScore: Math.round(best.score * 10) / 10,
      debugReason: `Matched candidate above threshold 55`,
      debugSearchCandidates: debugCandidates,
    };
  } catch (error) {
    return {
      key: candidate.key,
      query: candidate.title,
      normalizedQuery: candidate.normalizedTitle,
      year: candidate.year,
      fetchedAt: Date.now(),
      status: 'error',
      debugReason: 'TMDB request failed',
      debugError: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getCachedImageConfig(): Promise<CachedImageConfig> {
  const cached = await metadataRepository.getCachedImageConfig(CONFIG_TTL_MS);
  if (cached) {
    return cached;
  }

  const response = await tmdbRequest<TmdbConfigResponse>('/configuration');
  const images = response.images;
  const next: CachedImageConfig = {
    secureBaseUrl: images?.secure_base_url ?? 'https://image.tmdb.org/t/p/',
    posterSize: chooseImageSize(images?.poster_sizes, 'w500'),
    backdropSize: chooseImageSize(images?.backdrop_sizes, 'w780'),
    logoSize: chooseImageSize(images?.logo_sizes, 'w500'),
    fetchedAt: Date.now(),
  };
  await metadataRepository.setCachedImageConfig(next);
  return next;
}

async function tmdbRequest<T>(
  path: string,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${TMDB_API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  return metadataCoordinator.fetchJson<T>(url.toString(), url.toString());
}

function scoreSearchResults(
  candidate: SeriesLookupCandidate | MovieLookupCandidate,
  results: TmdbSearchResult[],
  mode: 'tv' | 'movie' = 'tv',
): Array<{ result: TmdbSearchResult; score: number }> {
  return results
    .map((result) => ({ result, score: scoreSearchResult(candidate, result, mode) }))
    .sort((left, right) => right.score - left.score);
}

function scoreSearchResult(
  candidate: SeriesLookupCandidate | MovieLookupCandidate,
  result: TmdbSearchResult,
  mode: 'tv' | 'movie',
): number {
  const primaryName = normalizeLookupText(
    mode === 'movie' ? (result.title ?? result.name ?? '') : (result.name ?? result.title ?? ''),
  );
  const alternateName = normalizeLookupText(
    mode === 'movie'
      ? (result.original_title ?? result.original_name ?? '')
      : (result.original_name ?? result.original_title ?? ''),
  );
  const overlap = Math.max(
    tokenOverlap(candidate.normalizedTitle, primaryName),
    tokenOverlap(candidate.normalizedTitle, alternateName),
  );
  let score = overlap * 100;

  if (candidate.normalizedTitle === primaryName || candidate.normalizedTitle === alternateName) {
    score += 40;
  }

  const dateValue = mode === 'movie' ? result.release_date : result.first_air_date;
  if (candidate.year != null && dateValue?.startsWith(String(candidate.year))) {
    score += 20;
  }

  score += Math.min((result.popularity ?? 0) / 10, 10);
  return score;
}

function tokenOverlap(left: string, right: string): number {
  if (!left || !right) return 0;
  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));
  let matches = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      matches += 1;
    }
  }
  return matches / leftTokens.size;
}

function chooseBestLogo(logos: TmdbImageAsset[]): TmdbImageAsset | undefined {
  return [...logos].sort((left, right) => {
    const languageScore = logoLanguageScore(right.iso_639_1) - logoLanguageScore(left.iso_639_1);
    if (languageScore !== 0) return languageScore;
    return (right.vote_average ?? 0) - (left.vote_average ?? 0);
  })[0];
}

function logoLanguageScore(language?: string | null): number {
  if (language === 'en') return 3;
  if (language == null) return 2;
  return 1;
}

function buildImageUrl(baseUrl: string, size: string, path?: string): string | undefined {
  if (!path) return undefined;
  return `${baseUrl}${size}${path}`;
}

function buildSeasonSummaries(
  details: TmdbTvDetails,
  imageConfig: CachedImageConfig,
): SeriesMetadataSeasonSummary[] {
  return (details.seasons ?? [])
    .filter((season) => Number.isFinite(season.season_number) && season.season_number >= 0)
    .map((season) => ({
      seasonNumber: season.season_number,
      name: season.name,
      episodeCount: season.episode_count ?? 0,
      airDate: season.air_date,
      overview: season.overview,
      posterUrl: buildImageUrl(imageConfig.secureBaseUrl, imageConfig.posterSize, season.poster_path),
    }))
    .sort((left, right) => left.seasonNumber - right.seasonNumber);
}

function toSeasonPayload(
  tmdbSeriesId: number,
  details: TmdbSeasonDetails,
  imageConfig: CachedImageConfig,
): SeasonMetadataPayload {
  const episodes = (details.episodes ?? [])
    .filter((episode) => Number.isFinite(episode.episode_number) && episode.episode_number > 0)
    .map((episode) => ({
      episodeNumber: episode.episode_number,
      name: episode.name,
      airDate: episode.air_date,
      overview: episode.overview,
      runtimeMinutes: episode.runtime,
      episodeType: episode.episode_type,
      stillUrl: buildImageUrl(imageConfig.secureBaseUrl, imageConfig.backdropSize, episode.still_path),
    }))
    .sort((left, right) => left.episodeNumber - right.episodeNumber);

  return {
    id: details.id,
    tmdbSeriesId,
    seasonNumber: details.season_number,
    name: details.name,
    airDate: details.air_date,
    overview: details.overview,
    posterUrl: buildImageUrl(imageConfig.secureBaseUrl, imageConfig.posterSize, details.poster_path),
    episodeCount: episodes.length,
    episodes,
  };
}

function needsSeasonSummaryRefresh(entry: SeriesMetadataEntry): boolean {
  return entry.status === 'resolved' && (!entry.seasons || entry.seasons.length === 0);
}

function normalizeRequestedSeasonNumbers(seasonNumbers?: number[]): number[] {
  if (!seasonNumbers || seasonNumbers.length === 0) {
    return [];
  }

  return [...new Set(seasonNumbers)]
    .filter((seasonNumber) => Number.isInteger(seasonNumber) && seasonNumber >= 0)
    .sort((left, right) => left - right);
}

async function refreshSeriesMetadataEntry(entry: SeriesMetadataEntry): Promise<SeriesMetadataEntry> {
  return lookupSeriesMetadata({
    key: entry.key,
    title: entry.query || entry.name || '',
    normalizedTitle: entry.normalizedQuery || normalizeLookupText(entry.query || entry.name || ''),
    year: entry.year,
  });
}

function chooseImageSize(sizes: string[] | undefined, preferred: string): string {
  if (!sizes || sizes.length === 0) return preferred;
  if (sizes.includes(preferred)) return preferred;
  return sizes.at(-1) ?? preferred;
}

function isMetadataStale(entry: SeriesMetadataEntry): boolean {
  const age = Date.now() - entry.fetchedAt;
  if (entry.status === 'resolved') return age > RESOLVED_TTL_MS;
  if (entry.status === 'not-found') return age > NOT_FOUND_TTL_MS;
  return age > ERROR_TTL_MS;
}

function isSeasonMetadataStale(entry: MetadataSeasonCacheEntry): boolean {
  const age = Date.now() - entry.fetchedAt;
  if (entry.status === 'resolved') return age > RESOLVED_TTL_MS;
  if (entry.status === 'not-found') return age > NOT_FOUND_TTL_MS;
  return age > ERROR_TTL_MS;
}
