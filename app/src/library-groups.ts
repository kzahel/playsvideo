import type { CatalogEntry, MovieMetadataEntry, SeriesMetadataEntry } from './db.js';
import { normalizeLookupText } from './media-metadata.js';

export interface TvShowGroup {
  id: string;
  slug: string;
  title: string;
  year?: number;
  entries: CatalogEntry[];
  seriesMetadata?: SeriesMetadataEntry;
}

export interface MovieGroup {
  id: string;
  slug: string;
  title: string;
  year?: number;
  entries: CatalogEntry[];
  movieMetadata?: MovieMetadataEntry;
}

export function buildMovieGroupKey(title: string, year?: number): string {
  return `movie:${normalizeLookupText(title)}:${year ?? ''}`;
}

export function groupTvShows(
  entries: CatalogEntry[],
  metadataByKey: Map<string, SeriesMetadataEntry>,
): TvShowGroup[] {
  const groups = new Map<string, TvShowGroup>();

  for (const entry of entries) {
    if (entry.detectedMediaType !== 'tv' || !entry.parsedTitle || !entry.seriesMetadataKey) {
      continue;
    }

    const existing = groups.get(entry.seriesMetadataKey);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }

    groups.set(entry.seriesMetadataKey, {
      id: entry.seriesMetadataKey,
      slug: entry.seriesMetadataKey,
      title: entry.parsedTitle,
      year: entry.parsedYear,
      entries: [entry],
      seriesMetadata: metadataByKey.get(entry.seriesMetadataKey),
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      entries: sortTvEntries(group.entries),
      title: group.seriesMetadata?.name ?? group.title,
      slug: buildTvShowSlug(group),
    }))
    .sort(compareGroupTitles);
}

export function groupMovies(
  entries: CatalogEntry[],
  metadataByKey: Map<string, MovieMetadataEntry>,
): MovieGroup[] {
  const groups = new Map<string, MovieGroup>();

  for (const entry of entries) {
    if (entry.detectedMediaType !== 'movie' || !entry.parsedTitle) {
      continue;
    }

    const groupKey = buildMovieGroupKey(entry.parsedTitle, entry.parsedYear);
    const existing = groups.get(groupKey);
    if (existing) {
      existing.entries.push(entry);
      continue;
    }

    groups.set(groupKey, {
      id: groupKey,
      slug: groupKey,
      title: entry.parsedTitle,
      year: entry.parsedYear,
      entries: [entry],
      movieMetadata: entry.movieMetadataKey ? metadataByKey.get(entry.movieMetadataKey) : undefined,
    });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      entries: [...group.entries].sort((left, right) => left.name.localeCompare(right.name)),
      title: group.movieMetadata?.title ?? group.title,
      slug: buildMovieSlug(group),
    }))
    .sort(compareGroupTitles);
}

export function buildTvShowSlug(group: Pick<TvShowGroup, 'title' | 'year' | 'seriesMetadata'>): string {
  const titleSlug = slugify(group.seriesMetadata?.name ?? group.title);
  if (group.seriesMetadata?.tmdbId != null) {
    return `${group.seriesMetadata.tmdbId}-${titleSlug}`;
  }
  return group.year != null ? `${titleSlug}-${group.year}` : titleSlug;
}

export function buildMovieSlug(group: Pick<MovieGroup, 'title' | 'year' | 'movieMetadata'>): string {
  const titleSlug = slugify(group.movieMetadata?.title ?? group.title);
  return group.year != null ? `${titleSlug}-${group.year}` : titleSlug;
}

export function sortTvEntries(entries: CatalogEntry[]): CatalogEntry[] {
  return [...entries].sort((left, right) => {
    const seasonDiff = compareOptionalNumber(left.seasonNumber, right.seasonNumber);
    if (seasonDiff !== 0) return seasonDiff;

    const episodeDiff = compareOptionalNumber(left.episodeNumber, right.episodeNumber);
    if (episodeDiff !== 0) return episodeDiff;

    return left.name.localeCompare(right.name);
  });
}

function compareGroupTitles<
  T extends {
    title: string;
    year?: number;
  },
>(left: T, right: T): number {
  const titleDiff = left.title.localeCompare(right.title);
  if (titleDiff !== 0) return titleDiff;
  return compareOptionalNumber(left.year, right.year);
}

function compareOptionalNumber(left?: number, right?: number): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function slugify(value: string): string {
  return normalizeLookupText(value).replace(/\s+/g, '-');
}
