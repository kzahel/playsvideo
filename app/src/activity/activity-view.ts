import type { WatchState } from '../db.js';
import type { RemoteDeviceState } from '../sync-device-doc.js';

export interface ActivityFact {
  deviceId: string;
  deviceLabel: string;
  deviceLastSyncedAt?: number;
  playbackKey: string;
  positionSec: number;
  durationSec: number;
  watchState: WatchState;
  lastPlayedAt: number;
  title?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  contentHash?: string;
  torrentInfoHash?: string;
  torrentFileIndex?: number;
  torrentMagnetUrl?: string;
  torrentComplete?: boolean;
  tmdbId?: number;
  tmdbMediaType?: 'tv' | 'movie';
}

export interface ActivityItem {
  id: string;
  fact: ActivityFact;
  facts: ActivityFact[];
  playbackKeys: string[];
  seasonNumber?: number;
  episodeLabel?: string;
  localEntryId?: number;
}

export interface ActivityGroup {
  id: string;
  type: 'tv' | 'movie' | 'other';
  title: string;
  mostRecentAt: number;
  items: ActivityItem[];
}

export interface ActivityDeviceOption {
  deviceId: string;
  label: string;
  lastSyncedAt?: number;
}

interface TmdbIdentity {
  type: 'tv' | 'movie';
  tmdbId: number;
  seasonNumber?: number;
  episodeLabel?: string;
}

const OPTIONAL_METADATA_FIELDS = [
  'title',
  'seasonNumber',
  'episodeNumber',
  'contentHash',
  'torrentInfoHash',
  'torrentFileIndex',
  'torrentMagnetUrl',
  'torrentComplete',
  'tmdbId',
  'tmdbMediaType',
] as const satisfies ReadonlyArray<keyof ActivityFact>;

function parseTmdbIdentity(playbackKey: string): TmdbIdentity | null {
  const tvMatch = playbackKey.match(/^tmdb:tv:(\d+):s(\d+):e(\d+(?:-\d+)?)$/);
  if (tvMatch) {
    return {
      type: 'tv',
      tmdbId: Number(tvMatch[1]),
      seasonNumber: Number(tvMatch[2]),
      episodeLabel: tvMatch[3],
    };
  }

  const movieMatch = playbackKey.match(/^tmdb:movie:(\d+)$/);
  if (movieMatch) {
    return { type: 'movie', tmdbId: Number(movieMatch[1]) };
  }

  return null;
}

function getTmdbIdentity(fact: ActivityFact): TmdbIdentity | null {
  if (fact.tmdbId != null && fact.tmdbMediaType != null) {
    return {
      type: fact.tmdbMediaType,
      tmdbId: fact.tmdbId,
      seasonNumber: fact.tmdbMediaType === 'tv' ? fact.seasonNumber : undefined,
      episodeLabel:
        fact.tmdbMediaType === 'tv' && fact.episodeNumber != null
          ? String(fact.episodeNumber).padStart(2, '0')
          : undefined,
    };
  }

  return parseTmdbIdentity(fact.playbackKey);
}

function normalizedTitle(title: string | undefined): string | null {
  if (!title) return null;
  const normalized = title
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return normalized || null;
}

function enrichFact(facts: ActivityFact[]): ActivityFact {
  const sorted = [...facts].sort((left, right) => right.lastPlayedAt - left.lastPlayedAt);
  const selected = { ...sorted[0] };

  for (const field of OPTIONAL_METADATA_FIELDS) {
    if (selected[field] != null) continue;
    const source = sorted.find((fact) => fact[field] != null);
    if (source) {
      Object.assign(selected, { [field]: source[field] });
    }
  }

  return selected;
}

function activityItemIdentity(fact: ActivityFact): string {
  if (fact.torrentInfoHash && fact.torrentFileIndex != null) {
    return `torrent:${fact.torrentInfoHash.toLocaleLowerCase()}:${fact.torrentFileIndex}`;
  }
  if (fact.contentHash) {
    return `hash:${fact.contentHash.toLocaleLowerCase()}`;
  }

  const tmdb = getTmdbIdentity(fact);
  if (tmdb?.type === 'tv' && tmdb.seasonNumber != null && tmdb.episodeLabel) {
    return `tmdb:tv:${tmdb.tmdbId}:s${tmdb.seasonNumber}:e${tmdb.episodeLabel}`;
  }
  if (tmdb?.type === 'movie') {
    return `tmdb:movie:${tmdb.tmdbId}`;
  }

  const title = normalizedTitle(fact.title);
  if (title && fact.seasonNumber != null && fact.episodeNumber != null) {
    return `title:tv:${title}:s${fact.seasonNumber}:e${fact.episodeNumber}`;
  }

  return `playback:${fact.playbackKey}`;
}

function createActivityItem(
  facts: ActivityFact[],
  localEntryByPlaybackKey: ReadonlyMap<string, number>,
): ActivityItem {
  const fact = enrichFact(facts);
  const playbackKeys = [...new Set(facts.map((entry) => entry.playbackKey))];
  const localEntryId = playbackKeys
    .map((playbackKey) => localEntryByPlaybackKey.get(playbackKey))
    .find((entryId) => entryId != null);
  const tmdb = getTmdbIdentity(fact);
  const seasonNumber = tmdb?.seasonNumber ?? fact.seasonNumber;
  const episodeLabel =
    tmdb?.episodeLabel ??
    (fact.episodeNumber != null ? String(fact.episodeNumber).padStart(2, '0') : undefined);

  return {
    id: activityItemIdentity(fact),
    fact,
    facts: [...facts].sort((left, right) => right.lastPlayedAt - left.lastPlayedAt),
    playbackKeys,
    seasonNumber,
    episodeLabel,
    localEntryId,
  };
}

function activityGroupIdentity(item: ActivityItem): {
  id: string;
  type: ActivityGroup['type'];
  title: string;
} {
  const { fact } = item;
  const tmdb = getTmdbIdentity(fact);
  const title = fact.title ?? fact.playbackKey;
  if (tmdb?.type === 'tv') {
    return { id: `tmdb:tv:${tmdb.tmdbId}`, type: 'tv', title };
  }
  if (tmdb?.type === 'movie') {
    return { id: `tmdb:movie:${tmdb.tmdbId}`, type: 'movie', title };
  }

  const titleKey = normalizedTitle(fact.title);
  if (titleKey && item.seasonNumber != null && item.episodeLabel != null) {
    return { id: `title:tv:${titleKey}`, type: 'tv', title };
  }

  return { id: `other:${item.id}`, type: 'other', title };
}

export function activityFactsFromDeviceDocs(devices: RemoteDeviceState[]): ActivityFact[] {
  return devices.flatMap(({ deviceId, doc }) =>
    Object.entries(doc.entries).map(([playbackKey, entry]) => ({
      deviceId,
      deviceLabel: doc.label,
      deviceLastSyncedAt: doc.lastSyncedAt,
      playbackKey,
      positionSec: entry.position,
      durationSec: entry.durationSec,
      watchState: entry.watchState,
      lastPlayedAt: entry.watchedAt,
      title: entry.title,
      seasonNumber: entry.seasonNumber,
      episodeNumber: entry.episodeNumber,
      contentHash: entry.contentHash,
      torrentInfoHash: entry.torrentInfoHash,
      torrentFileIndex: entry.torrentFileIndex,
      torrentMagnetUrl: entry.torrentMagnetUrl,
      torrentComplete: entry.torrentComplete,
      tmdbId: entry.tmdbId,
      tmdbMediaType: entry.tmdbMediaType,
    })),
  );
}

export function listActivityDevices(
  facts: ActivityFact[],
  currentDeviceId?: string,
  currentDeviceLabel?: string,
): ActivityDeviceOption[] {
  const devices = new Map<string, ActivityDeviceOption>();
  if (currentDeviceId) {
    devices.set(currentDeviceId, {
      deviceId: currentDeviceId,
      label: currentDeviceLabel ?? 'This device',
    });
  }

  for (const fact of facts) {
    const existing = devices.get(fact.deviceId);
    devices.set(fact.deviceId, {
      deviceId: fact.deviceId,
      label: fact.deviceLabel,
      lastSyncedAt: Math.max(existing?.lastSyncedAt ?? 0, fact.deviceLastSyncedAt ?? 0) || undefined,
    });
  }

  return [...devices.values()].sort((left, right) => {
    if (left.deviceId === currentDeviceId) return -1;
    if (right.deviceId === currentDeviceId) return 1;
    return (right.lastSyncedAt ?? 0) - (left.lastSyncedAt ?? 0);
  });
}

export function buildActivityGroups(input: {
  facts: ActivityFact[];
  deviceId?: string;
  localEntryByPlaybackKey?: ReadonlyMap<string, number>;
}): ActivityGroup[] {
  const localEntryByPlaybackKey = input.localEntryByPlaybackKey ?? new Map();
  const scopedFacts = input.deviceId
    ? input.facts.filter((fact) => fact.deviceId === input.deviceId)
    : input.facts;

  const factsByPlaybackKey = new Map<string, ActivityFact[]>();
  for (const fact of scopedFacts) {
    const key = fact.playbackKey;
    factsByPlaybackKey.set(key, [...(factsByPlaybackKey.get(key) ?? []), fact]);
  }

  const factsByItemIdentity = new Map<string, ActivityFact[]>();
  for (const facts of factsByPlaybackKey.values()) {
    const identity = activityItemIdentity(enrichFact(facts));
    factsByItemIdentity.set(identity, [...(factsByItemIdentity.get(identity) ?? []), ...facts]);
  }

  const groups = new Map<string, ActivityGroup>();
  for (const facts of factsByItemIdentity.values()) {
    const item = createActivityItem(facts, localEntryByPlaybackKey);
    const identity = activityGroupIdentity(item);
    const existing = groups.get(identity.id);
    if (existing) {
      existing.items.push(item);
      existing.mostRecentAt = Math.max(existing.mostRecentAt, item.fact.lastPlayedAt);
      if (item.fact.lastPlayedAt === existing.mostRecentAt && item.fact.title) {
        existing.title = item.fact.title;
      }
    } else {
      groups.set(identity.id, {
        id: identity.id,
        type: identity.type,
        title: identity.title,
        mostRecentAt: item.fact.lastPlayedAt,
        items: [item],
      });
    }
  }

  const sorted = [...groups.values()].sort(
    (left, right) => right.mostRecentAt - left.mostRecentAt,
  );
  for (const group of sorted) {
    group.items.sort((left, right) => right.fact.lastPlayedAt - left.fact.lastPlayedAt);
  }
  return sorted;
}
