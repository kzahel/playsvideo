import {
  db,
  type LibraryEntry,
  type SeriesMetadataEntry,
  type SeriesMetadataSearchCandidate,
} from './db.js';
import {
  buildSeriesMetadataKey,
  normalizeLookupText,
  parseMediaMetadata,
} from './media-metadata.js';

const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_CONFIG_CACHE_KEY = 'tmdb-image-config-v1';
const CONFIG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESOLVED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ERROR_TTL_MS = 6 * 60 * 60 * 1000;

interface TmdbSearchResult {
  id: number;
  name: string;
  original_name?: string;
  first_air_date?: string;
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

interface TmdbConfigResponse {
  images?: {
    secure_base_url?: string;
    poster_sizes?: string[];
    backdrop_sizes?: string[];
    logo_sizes?: string[];
  };
}

interface CachedImageConfig {
  secureBaseUrl: string;
  posterSize: string;
  backdropSize: string;
  logoSize: string;
  fetchedAt: number;
}

interface SeriesLookupCandidate {
  key: string;
  title: string;
  normalizedTitle: string;
  year?: number;
}

export const TMDB_READ_ACCESS_TOKEN_KEY = 'tmdb-read-access-token';

export async function refreshLibraryMetadata(options?: {
  entries?: LibraryEntry[];
  force?: boolean;
}): Promise<void> {
  const entries = await backfillParsedLibraryEntries(options?.entries);
  const token = await getTmdbReadAccessToken();
  if (!token) return;

  const candidates = new Map<string, SeriesLookupCandidate>();
  for (const entry of entries) {
    if (entry.detectedMediaType !== 'tv' || !entry.parsedTitle) continue;
    const key = entry.seriesMetadataKey ?? buildSeriesMetadataKey(entry.parsedTitle, entry.parsedYear);
    candidates.set(key, {
      key,
      title: entry.parsedTitle,
      normalizedTitle: normalizeLookupText(entry.parsedTitle),
      year: entry.parsedYear,
    });
  }

  if (candidates.size === 0) return;

  const existingMetadata = await db.seriesMetadata.bulkGet(Array.from(candidates.keys()));
  const existingByKey = new Map(
    existingMetadata
      .filter((entry): entry is SeriesMetadataEntry => Boolean(entry))
      .map((entry) => [entry.key, entry]),
  );

  for (const candidate of candidates.values()) {
    const existing = existingByKey.get(candidate.key);
    if (!options?.force && existing && !isMetadataStale(existing)) {
      continue;
    }

    const metadata = await lookupSeriesMetadata(candidate, token);
    await db.seriesMetadata.put(metadata);
  }
}

async function backfillParsedLibraryEntries(entries?: LibraryEntry[]): Promise<LibraryEntry[]> {
  const source = entries ?? (await db.library.toArray());
  const updates: LibraryEntry[] = [];
  const hydrated = source.map((entry) => {
    if (
      entry.detectedMediaType &&
      entry.parsedTitle !== undefined &&
      (entry.detectedMediaType !== 'tv' || entry.seriesMetadataKey)
    ) {
      return entry;
    }

    const parsed = parseMediaMetadata(entry.path);
    const next: LibraryEntry = {
      ...entry,
      ...parsed,
    };
    updates.push(next);
    return next;
  });

  if (updates.length > 0) {
    await db.library.bulkPut(updates);
  }

  return hydrated;
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
      posterUrl: buildImageUrl(imageConfig.secureBaseUrl, imageConfig.posterSize, details.poster_path),
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

async function getTmdbReadAccessToken(): Promise<string | null> {
  const envToken = import.meta.env.VITE_TMDB_READ_ACCESS_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }

  const configured = await db.settings.get(TMDB_READ_ACCESS_TOKEN_KEY);
  if (typeof configured?.value === 'string' && configured.value.trim()) {
    return configured.value.trim();
  }

  return null;
}

async function getCachedImageConfig(token: string): Promise<CachedImageConfig> {
  const cached = await db.settings.get(TMDB_CONFIG_CACHE_KEY);
  if (isCachedImageConfig(cached?.value) && Date.now() - cached.value.fetchedAt < CONFIG_TTL_MS) {
    return cached.value;
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
  await db.settings.put({ key: TMDB_CONFIG_CACHE_KEY, value: next });
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
  candidate: SeriesLookupCandidate,
  results: TmdbSearchResult[],
): Array<{ result: TmdbSearchResult; score: number }> {
  return results
    .map((result) => ({ result, score: scoreSearchResult(candidate, result) }))
    .sort((left, right) => right.score - left.score);
}

function scoreSearchResult(candidate: SeriesLookupCandidate, result: TmdbSearchResult): number {
  const name = normalizeLookupText(result.name);
  const originalName = normalizeLookupText(result.original_name ?? '');
  const overlap = Math.max(
    tokenOverlap(candidate.normalizedTitle, name),
    tokenOverlap(candidate.normalizedTitle, originalName),
  );
  let score = overlap * 100;

  if (candidate.normalizedTitle === name || candidate.normalizedTitle === originalName) {
    score += 40;
  }

  if (candidate.year != null && result.first_air_date?.startsWith(String(candidate.year))) {
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

function isMetadataStale(entry: SeriesMetadataEntry): boolean {
  const age = Date.now() - entry.fetchedAt;
  if (entry.status === 'resolved') return age > RESOLVED_TTL_MS;
  if (entry.status === 'not-found') return age > NOT_FOUND_TTL_MS;
  return age > ERROR_TTL_MS;
}
