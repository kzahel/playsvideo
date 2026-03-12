import type { DetectedMediaType } from './db.js';

const EPISODE_PATTERNS = [
  /^(?<series>.+?)[\s._-]+s(?<season>\d{1,2})[\s._-]*e(?<episode>\d{1,3})(?:[\s._-]*(?:e|ep)?(?<ending>\d{1,3}))?/i,
  /^(?<series>.+?)[\s._-]+(?<season>\d{1,2})x(?<episode>\d{1,3})(?:[\s._-]*(?<ending>\d{1,3}))?/i,
];

const BARE_EPISODE_PATTERNS = [
  /\bs(?<season>\d{1,2})[\s._-]*e(?<episode>\d{1,3})(?:[\s._-]*(?:e|ep)?(?<ending>\d{1,3}))?/i,
  /\b(?<season>\d{1,2})x(?<episode>\d{1,3})(?:[\s._-]*(?<ending>\d{1,3}))?/i,
];

const SEASON_FOLDER_PATTERN = /^(?:season|series)\s*\d+|s\d{1,2}|specials?$/i;
const RELEASE_STOP_WORDS = new Set([
  '1080p',
  '2160p',
  '480p',
  '576p',
  '720p',
  'amzn',
  'atvp',
  'bluray',
  'brrip',
  'ddp5',
  'ddp5.1',
  'dv',
  'dvdrip',
  'eac3',
  'h264',
  'h265',
  'hdr',
  'hevc',
  'nf',
  'proper',
  'repack',
  'remux',
  'uhd',
  'web',
  'web-dl',
  'webdl',
  'webrip',
  'x264',
  'x265',
]);

export interface ParsedMediaMetadata {
  detectedMediaType: DetectedMediaType;
  parsedTitle?: string;
  parsedYear?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  endingEpisodeNumber?: number;
  seriesMetadataKey?: string;
  movieMetadataKey?: string;
}

export function normalizeLookupText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function buildSeriesMetadataKey(title: string, year?: number): string {
  return `tv:${normalizeLookupText(title)}:${year ?? ''}`;
}

export function buildMovieMetadataKey(title: string, year?: number): string {
  return `movie:${normalizeLookupText(title)}:${year ?? ''}`;
}

export function parseMediaMetadata(path: string): ParsedMediaMetadata {
  const segments = path.split('/').filter(Boolean);
  const baseName = segments.at(-1) ?? path;
  const baseWithoutExtension = stripExtension(baseName);

  for (const pattern of EPISODE_PATTERNS) {
    const match = baseWithoutExtension.match(pattern);
    if (!match?.groups) continue;
    const fallback = getSeriesNameFromParentSegments(segments.slice(0, -1));
    const seriesTitle = cleanSeriesTitle(match.groups.series) || fallback?.title;
    const seasonNumber = parseOptionalNumber(match.groups.season);
    const episodeNumber = parseOptionalNumber(match.groups.episode);
    if (!seriesTitle || seasonNumber == null || episodeNumber == null) continue;

    const extracted = extractTrailingYear(seriesTitle);
    const parsedYear = extracted.year ?? fallback?.year;
    return {
      detectedMediaType: 'tv',
      parsedTitle: extracted.title,
      parsedYear,
      seasonNumber,
      episodeNumber,
      endingEpisodeNumber: parseOptionalNumber(match.groups.ending),
      seriesMetadataKey: buildSeriesMetadataKey(extracted.title, parsedYear),
    };
  }

  for (const pattern of BARE_EPISODE_PATTERNS) {
    const match = baseWithoutExtension.match(pattern);
    if (!match?.groups) continue;
    const fallback = getSeriesNameFromParentSegments(segments.slice(0, -1));
    if (!fallback?.title) continue;

    return {
      detectedMediaType: 'tv',
      parsedTitle: fallback.title,
      parsedYear: fallback.year,
      seasonNumber: parseOptionalNumber(match.groups.season),
      episodeNumber: parseOptionalNumber(match.groups.episode),
      endingEpisodeNumber: parseOptionalNumber(match.groups.ending),
      seriesMetadataKey: buildSeriesMetadataKey(fallback.title, fallback.year),
    };
  }

  const movie = parseMovieCandidate(baseWithoutExtension);
  if (movie.title) {
    return {
      detectedMediaType: 'movie',
      parsedTitle: movie.title,
      parsedYear: movie.year,
      movieMetadataKey: buildMovieMetadataKey(movie.title, movie.year),
    };
  }

  return {
    detectedMediaType: 'unknown',
  };
}

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}

function cleanSeriesTitle(value: string): string {
  const cleaned = value.replace(/[\[\](){}]+/g, ' ');
  return cleaned
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[-\s]+$/, '');
}

function parseOptionalNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getSeriesNameFromParentSegments(
  segments: string[],
): { title: string; year?: number } | undefined {
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const segment = segments[i];
    if (SEASON_FOLDER_PATTERN.test(segment)) continue;
    const candidate = cleanSeriesTitle(segment);
    if (!candidate || /^\d+$/.test(candidate)) continue;
    const extracted = extractTrailingYear(candidate);
    if (!extracted.title) continue;
    return extracted;
  }
  return undefined;
}

function extractTrailingYear(value: string): { title: string; year?: number } {
  const match = value.match(/^(?<title>.+?)\s*(?:\(|\[)?(?<year>(?:19|20)\d{2})(?:\)|\])?$/);
  if (!match?.groups) {
    return { title: value.trim() };
  }
  return {
    title: match.groups.title.trim(),
    year: Number.parseInt(match.groups.year, 10),
  };
}

function parseMovieCandidate(baseWithoutExtension: string): { title?: string; year?: number } {
  const rawTokens = baseWithoutExtension
    .replace(/[._]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const titleTokens: string[] = [];
  let year: number | undefined;

  for (const token of rawTokens) {
    const normalizedToken = token.toLowerCase();
    const maybeYear = token.match(/^(?:\(|\[)?((?:19|20)\d{2})(?:\)|\])?$/);
    if (maybeYear && titleTokens.length > 0) {
      year = Number.parseInt(maybeYear[1], 10);
      break;
    }
    if (RELEASE_STOP_WORDS.has(normalizedToken)) {
      break;
    }
    titleTokens.push(token);
  }

  const title = titleTokens.join(' ').trim();
  return title ? { title, year } : {};
}
