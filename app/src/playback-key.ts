import type {
  CatalogEntry,
  DetectedMediaType,
  MovieMetadataEntry,
  PlaybackKeySource,
  SeriesMetadataEntry,
} from './db.js';

export interface PlaybackKeyInput {
  name: string;
  size: number;
  detectedMediaType: DetectedMediaType;
  seriesMetadataKey?: string;
  movieMetadataKey?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  endingEpisodeNumber?: number;
  contentHash?: string;
  torrentInfoHash?: string;
  torrentFileIndex?: number;
}

export interface PlaybackKeyCandidate {
  key: string;
  source: PlaybackKeySource;
}

export interface PlaybackKeyContext {
  seriesMetadataByKey?: Map<string, Pick<SeriesMetadataEntry, 'status' | 'tmdbId'>>;
  movieMetadataByKey?: Map<string, Pick<MovieMetadataEntry, 'status' | 'tmdbId'>>;
}

function pushUnique(
  candidates: PlaybackKeyCandidate[],
  seen: Set<string>,
  candidate: PlaybackKeyCandidate | null,
): void {
  if (!candidate || seen.has(candidate.key)) return;
  seen.add(candidate.key);
  candidates.push(candidate);
}

function buildTmdbTvCandidate(
  input: PlaybackKeyInput,
  seriesMetadataByKey: Map<string, Pick<SeriesMetadataEntry, 'status' | 'tmdbId'>>,
): PlaybackKeyCandidate | null {
  if (
    input.detectedMediaType !== 'tv' ||
    !input.seriesMetadataKey ||
    input.seasonNumber == null ||
    input.episodeNumber == null
  ) {
    return null;
  }

  const seriesMetadata = seriesMetadataByKey.get(input.seriesMetadataKey);
  if (seriesMetadata?.status !== 'resolved' || seriesMetadata.tmdbId == null) {
    return null;
  }

  const episodeKey =
    input.endingEpisodeNumber != null
      ? `${String(input.episodeNumber).padStart(2, '0')}-${String(input.endingEpisodeNumber).padStart(2, '0')}`
      : String(input.episodeNumber).padStart(2, '0');

  return {
    key: `tmdb:tv:${seriesMetadata.tmdbId}:s${String(input.seasonNumber).padStart(2, '0')}:e${episodeKey}`,
    source: 'tmdb',
  };
}

function buildTmdbMovieCandidate(
  input: PlaybackKeyInput,
  movieMetadataByKey: Map<string, Pick<MovieMetadataEntry, 'status' | 'tmdbId'>>,
): PlaybackKeyCandidate | null {
  if (input.detectedMediaType !== 'movie' || !input.movieMetadataKey) {
    return null;
  }

  const movieMetadata = movieMetadataByKey.get(input.movieMetadataKey);
  if (movieMetadata?.status !== 'resolved' || movieMetadata.tmdbId == null) {
    return null;
  }

  return {
    key: `tmdb:movie:${movieMetadata.tmdbId}`,
    source: 'tmdb',
  };
}

export function buildPlaybackKeyCandidates(
  input: PlaybackKeyInput,
  context: PlaybackKeyContext = {},
): PlaybackKeyCandidate[] {
  const candidates: PlaybackKeyCandidate[] = [];
  const seen = new Set<string>();
  const seriesMetadataByKey = context.seriesMetadataByKey ?? new Map();
  const movieMetadataByKey = context.movieMetadataByKey ?? new Map();

  if (input.torrentInfoHash != null && input.torrentFileIndex != null) {
    pushUnique(candidates, seen, {
      key: `torrent:${input.torrentInfoHash}:${input.torrentFileIndex}`,
      source: 'torrent',
    });
  }

  if (input.contentHash) {
    pushUnique(candidates, seen, {
      key: `hash:${input.contentHash}`,
      source: 'hash',
    });
  }

  pushUnique(candidates, seen, buildTmdbTvCandidate(input, seriesMetadataByKey));
  pushUnique(candidates, seen, buildTmdbMovieCandidate(input, movieMetadataByKey));

  pushUnique(candidates, seen, {
    key: `file:${input.name}|${input.size}`,
    source: 'file',
  });

  return candidates;
}

export function chooseCanonicalPlaybackKey(
  input: PlaybackKeyInput,
  context: PlaybackKeyContext = {},
): PlaybackKeyCandidate {
  return buildPlaybackKeyCandidates(input, context)[0];
}

export function toPlaybackKeyInput(entry: Pick<
  CatalogEntry,
  | 'name'
  | 'size'
  | 'detectedMediaType'
  | 'seriesMetadataKey'
  | 'movieMetadataKey'
  | 'seasonNumber'
  | 'episodeNumber'
  | 'endingEpisodeNumber'
  | 'contentHash'
  | 'torrentInfoHash'
  | 'torrentFileIndex'
>): PlaybackKeyInput {
  return {
    name: entry.name,
    size: entry.size,
    detectedMediaType: entry.detectedMediaType,
    seriesMetadataKey: entry.seriesMetadataKey,
    movieMetadataKey: entry.movieMetadataKey,
    seasonNumber: entry.seasonNumber,
    episodeNumber: entry.episodeNumber,
    endingEpisodeNumber: entry.endingEpisodeNumber,
    contentHash: entry.contentHash,
    torrentInfoHash: entry.torrentInfoHash,
    torrentFileIndex: entry.torrentFileIndex,
  };
}
