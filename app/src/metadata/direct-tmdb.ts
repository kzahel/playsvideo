import {
  type MovieMetadataEntry,
  type SeriesMetadataEntry,
  type SeriesMetadataSearchCandidate,
} from '../db.js';
import type { CachedImageConfig } from './repository.js';
import {
  buildMovieMetadataKey,
  buildSeriesMetadataKey,
  normalizeLookupText,
} from '../media-metadata.js';
import { metadataRepository } from './repository.js';
import type { MetadataClient, RefreshLibraryMetadataOptions } from './types.js';

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
  overview?: string;
  poster_path?: string;
  backdrop_path?: string;
  images?: {
    logos?: TmdbImageAsset[];
  };
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
};

export { TMDB_READ_ACCESS_TOKEN_KEY } from './repository.js';

export async function refreshLibraryMetadata(
  options?: RefreshLibraryMetadataOptions,
): Promise<void> {
  const entries = await metadataRepository.hydrateParsedLibraryEntries(options?.entries);
  const token = await metadataRepository.getTmdbReadAccessToken();
  if (!token) return;

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

      const metadata = await lookupSeriesMetadata(candidate, token);
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

      const metadata = await lookupMovieMetadata(candidate, token);
      await metadataRepository.putMovieMetadata(metadata);
    }
  }
}

async function lookupSeriesMetadata(
  candidate: SeriesLookupCandidate,
  token: string,
): Promise<SeriesMetadataEntry> {
  try {
    const search = await tmdbRequest<TmdbSearchResponse>('/search/tv', token, {
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

    const details = await tmdbRequest<TmdbTvDetails>(`/tv/${match.id}`, token, {
      language: 'en-US',
      append_to_response: 'images',
      include_image_language: 'en,null',
    });
    const imageConfig = await getCachedImageConfig(token);
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

async function lookupMovieMetadata(
  candidate: MovieLookupCandidate,
  token: string,
): Promise<MovieMetadataEntry> {
  try {
    const search = await tmdbRequest<TmdbSearchResponse>('/search/movie', token, {
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

    const details = await tmdbRequest<TmdbMovieDetails>(`/movie/${match.id}`, token, {
      language: 'en-US',
    });
    const imageConfig = await getCachedImageConfig(token);

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

async function getCachedImageConfig(token: string): Promise<CachedImageConfig> {
  const cached = await metadataRepository.getCachedImageConfig(CONFIG_TTL_MS);
  if (cached) {
    return cached;
  }

  const response = await tmdbRequest<TmdbConfigResponse>('/configuration', token);
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
  token: string,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${TMDB_API_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`TMDB request failed with ${response.status}`);
  }
  return (await response.json()) as T;
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
