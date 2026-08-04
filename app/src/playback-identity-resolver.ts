import {
  db,
  type CatalogAliasEntry,
  type CatalogEntry,
  type MovieMetadataEntry,
  type PlaybackKeySource,
  type SeriesMetadataEntry,
} from './db.js';
import {
  buildPlaybackKeyCandidates,
  type PlaybackKeyCandidate,
} from './playback-key.js';

export type PlaybackMatchConfidence = 'high' | 'medium' | 'low';

export interface PlaybackIdentityFact {
  playbackKey: string;
  contentHash?: string;
  torrentInfoHash?: string;
  torrentFileIndex?: number;
  tmdbId?: number;
  tmdbMediaType?: 'tv' | 'movie';
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface LocalPlaybackTarget {
  catalogEntry: CatalogEntry;
  catalogId: number;
  localPlaybackKey: string;
  matchedPlaybackKey: string;
  matchKind: 'canonical' | PlaybackKeySource;
  confidence: PlaybackMatchConfidence;
  hasLocalFile: boolean;
}

interface IndexedTarget {
  catalogEntry: CatalogEntry;
  source: PlaybackKeySource;
}

export interface LocalPlaybackTargetIndex {
  byPlaybackKey: Map<string, IndexedTarget[]>;
}

export type LocalPlaybackResolution =
  | { status: 'resolved'; target: LocalPlaybackTarget }
  | { status: 'ambiguous'; playbackKey: string; catalogIds: number[] }
  | { status: 'unavailable' };

function confidenceForSource(source: PlaybackKeySource): PlaybackMatchConfidence {
  if (source === 'torrent' || source === 'hash') return 'high';
  if (source === 'tmdb') return 'medium';
  return 'low';
}

function sourceFromPlaybackKey(playbackKey: string): PlaybackKeySource {
  if (playbackKey.startsWith('torrent:')) return 'torrent';
  if (playbackKey.startsWith('hash:')) return 'hash';
  if (playbackKey.startsWith('tmdb:')) return 'tmdb';
  return 'file';
}

function candidatesForCatalogEntry(
  entry: CatalogEntry,
  seriesMetadataByKey: Map<string, SeriesMetadataEntry>,
  movieMetadataByKey: Map<string, MovieMetadataEntry>,
): PlaybackKeyCandidate[] {
  return buildPlaybackKeyCandidates(
    {
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
    },
    { seriesMetadataByKey, movieMetadataByKey },
  );
}

function pushIndexedTarget(
  index: Map<string, IndexedTarget[]>,
  playbackKey: string,
  target: IndexedTarget,
): void {
  const existing = index.get(playbackKey) ?? [];
  if (existing.some((candidate) => candidate.catalogEntry.id === target.catalogEntry.id)) return;
  index.set(playbackKey, [...existing, target]);
}

export function createLocalPlaybackTargetIndex(input: {
  catalogEntries: CatalogEntry[];
  aliases?: CatalogAliasEntry[];
  seriesMetadata?: SeriesMetadataEntry[];
  movieMetadata?: MovieMetadataEntry[];
}): LocalPlaybackTargetIndex {
  const seriesMetadataByKey = new Map(
    (input.seriesMetadata ?? []).map((entry) => [entry.key, entry]),
  );
  const movieMetadataByKey = new Map(
    (input.movieMetadata ?? []).map((entry) => [entry.key, entry]),
  );
  const catalogById = new Map(input.catalogEntries.map((entry) => [entry.id, entry]));
  const byPlaybackKey = new Map<string, IndexedTarget[]>();

  for (const entry of input.catalogEntries) {
    for (const candidate of candidatesForCatalogEntry(
      entry,
      seriesMetadataByKey,
      movieMetadataByKey,
    )) {
      pushIndexedTarget(byPlaybackKey, candidate.key, {
        catalogEntry: entry,
        source: candidate.source,
      });
    }
    if (entry.canonicalPlaybackKey) {
      pushIndexedTarget(byPlaybackKey, entry.canonicalPlaybackKey, {
        catalogEntry: entry,
        source: sourceFromPlaybackKey(entry.canonicalPlaybackKey),
      });
    }
  }

  for (const alias of input.aliases ?? []) {
    const entry = catalogById.get(alias.catalogId);
    if (!entry) continue;
    pushIndexedTarget(byPlaybackKey, alias.playbackKey, {
      catalogEntry: entry,
      source: alias.source,
    });
  }

  return { byPlaybackKey };
}

export function playbackKeyCandidatesForFact(fact: PlaybackIdentityFact): PlaybackKeyCandidate[] {
  const result: PlaybackKeyCandidate[] = [];
  const seen = new Set<string>();
  const push = (candidate: PlaybackKeyCandidate | null) => {
    if (!candidate || seen.has(candidate.key)) return;
    seen.add(candidate.key);
    result.push(candidate);
  };

  push({ key: fact.playbackKey, source: sourceFromPlaybackKey(fact.playbackKey) });
  if (fact.torrentInfoHash && fact.torrentFileIndex != null) {
    push({
      key: `torrent:${fact.torrentInfoHash}:${fact.torrentFileIndex}`,
      source: 'torrent',
    });
  }
  if (fact.contentHash) {
    push({ key: `hash:${fact.contentHash}`, source: 'hash' });
  }
  if (fact.tmdbId != null && fact.tmdbMediaType === 'movie') {
    push({ key: `tmdb:movie:${fact.tmdbId}`, source: 'tmdb' });
  }
  if (
    fact.tmdbId != null &&
    fact.tmdbMediaType === 'tv' &&
    fact.seasonNumber != null &&
    fact.episodeNumber != null
  ) {
    push({
      key: `tmdb:tv:${fact.tmdbId}:s${String(fact.seasonNumber).padStart(2, '0')}:e${String(
        fact.episodeNumber,
      ).padStart(2, '0')}`,
      source: 'tmdb',
    });
  }
  return result;
}

export function resolveLocalPlaybackTarget(
  index: LocalPlaybackTargetIndex,
  fact: PlaybackIdentityFact,
): LocalPlaybackResolution {
  for (const candidate of playbackKeyCandidatesForFact(fact)) {
    const matches = index.byPlaybackKey.get(candidate.key) ?? [];
    const uniqueCatalogIds = [...new Set(matches.map((match) => match.catalogEntry.id))];
    if (uniqueCatalogIds.length > 1) {
      return {
        status: 'ambiguous',
        playbackKey: candidate.key,
        catalogIds: uniqueCatalogIds,
      };
    }
    const match = matches[0];
    if (!match) continue;
    const canonical = match.catalogEntry.canonicalPlaybackKey;
    if (!canonical) continue;
    return {
      status: 'resolved',
      target: {
        catalogEntry: match.catalogEntry,
        catalogId: match.catalogEntry.id,
        localPlaybackKey: canonical,
        matchedPlaybackKey: candidate.key,
        matchKind: candidate.key === canonical ? 'canonical' : candidate.source,
        confidence: confidenceForSource(candidate.source),
        hasLocalFile:
          match.catalogEntry.availability === 'present' &&
          match.catalogEntry.hasLocalFile !== false,
      },
    };
  }
  return { status: 'unavailable' };
}

export function buildCatalogAliasEntries(input: {
  catalogEntries: CatalogEntry[];
  existingAliases?: CatalogAliasEntry[];
  seriesMetadata?: SeriesMetadataEntry[];
  movieMetadata?: MovieMetadataEntry[];
  createdAt?: number;
}): CatalogAliasEntry[] {
  const seriesMetadataByKey = new Map(
    (input.seriesMetadata ?? []).map((entry) => [entry.key, entry]),
  );
  const movieMetadataByKey = new Map(
    (input.movieMetadata ?? []).map((entry) => [entry.key, entry]),
  );
  const createdAtByKey = new Map(
    (input.existingAliases ?? []).map((entry) => [
      `${entry.catalogId}\0${entry.playbackKey}`,
      entry.createdAt,
    ]),
  );
  const createdAt = input.createdAt ?? Date.now();
  const aliases: CatalogAliasEntry[] = [];
  for (const entry of input.catalogEntries) {
    for (const candidate of candidatesForCatalogEntry(
      entry,
      seriesMetadataByKey,
      movieMetadataByKey,
    )) {
      aliases.push({
        catalogId: entry.id,
        playbackKey: candidate.key,
        source: candidate.source,
        createdAt: createdAtByKey.get(`${entry.id}\0${candidate.key}`) ?? createdAt,
      });
    }
  }
  return aliases;
}

export async function backfillCatalogAliases(): Promise<void> {
  const [catalogEntries, existingAliases, seriesMetadata, movieMetadata] = await Promise.all([
    db.catalog.toArray(),
    db.catalogAliases.toArray(),
    db.seriesMetadata.toArray(),
    db.movieMetadata.toArray(),
  ]);
  const aliases = buildCatalogAliasEntries({
    catalogEntries,
    existingAliases,
    seriesMetadata,
    movieMetadata,
  });
  if (aliases.length > 0) {
    await db.catalogAliases.bulkPut(aliases);
  }
}

export async function loadLocalPlaybackTargetIndex(): Promise<LocalPlaybackTargetIndex> {
  await backfillCatalogAliases();
  const [catalogEntries, aliases, seriesMetadata, movieMetadata] = await Promise.all([
    db.catalog.toArray(),
    db.catalogAliases.toArray(),
    db.seriesMetadata.toArray(),
    db.movieMetadata.toArray(),
  ]);
  return createLocalPlaybackTargetIndex({
    catalogEntries,
    aliases,
    seriesMetadata,
    movieMetadata,
  });
}
