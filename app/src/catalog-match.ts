export interface CatalogMatchableEntry {
  id: number;
  path: string;
  name: string;
  size: number;
  lastModified: number;
  contentHash?: string;
  torrentInfoHash?: string;
  torrentFileIndex?: number;
}

export interface ScannedCatalogItem {
  path: string;
  name: string;
  size: number;
  lastModified: number;
  contentHash?: string;
  torrentInfoHash?: string;
  torrentFileIndex?: number;
}

export type CatalogMatchReason = 'torrent' | 'hash' | 'path' | 'fingerprint' | 'new';

export interface CatalogMatchResult<T extends CatalogMatchableEntry = CatalogMatchableEntry> {
  scanned: ScannedCatalogItem;
  existing: T | null;
  reason: CatalogMatchReason;
}

function pushBucket<T>(map: Map<string, T[]>, key: string | null, value: T): void {
  if (!key) return;
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(value);
    return;
  }
  map.set(key, [value]);
}

function takeUnmatched<T extends CatalogMatchableEntry>(
  map: Map<string, T[]>,
  key: string | null,
  matchedIds: Set<number>,
): T | null {
  if (!key) return null;
  const bucket = map.get(key);
  if (!bucket) return null;
  for (const item of bucket) {
    if (!matchedIds.has(item.id)) {
      matchedIds.add(item.id);
      return item;
    }
  }
  return null;
}

function torrentKey(item: {
  torrentInfoHash?: string;
  torrentFileIndex?: number;
}): string | null {
  return item.torrentInfoHash != null && item.torrentFileIndex != null
    ? `${item.torrentInfoHash}:${item.torrentFileIndex}`
    : null;
}

function hashKey(item: { contentHash?: string }): string | null {
  return item.contentHash ?? null;
}

function pathKey(item: { path: string }): string {
  return item.path;
}

function fingerprintKey(item: {
  name: string;
  size: number;
  lastModified: number;
}): string {
  return `${item.name}|${item.size}|${item.lastModified}`;
}

export function matchScannedCatalogItems<T extends CatalogMatchableEntry>(
  existing: T[],
  scanned: ScannedCatalogItem[],
): { matches: CatalogMatchResult<T>[]; missing: T[] } {
  const existingByTorrent = new Map<string, T[]>();
  const existingByHash = new Map<string, T[]>();
  const existingByPath = new Map<string, T[]>();
  const existingByFingerprint = new Map<string, T[]>();

  for (const entry of existing) {
    pushBucket(existingByTorrent, torrentKey(entry), entry);
    pushBucket(existingByHash, hashKey(entry), entry);
    pushBucket(existingByPath, pathKey(entry), entry);
    pushBucket(existingByFingerprint, fingerprintKey(entry), entry);
  }

  const matchedIds = new Set<number>();
  const matches = scanned.map((item) => {
    const torrentMatch = takeUnmatched(existingByTorrent, torrentKey(item), matchedIds);
    if (torrentMatch) {
      return { scanned: item, existing: torrentMatch, reason: 'torrent' as const };
    }

    const hashMatch = takeUnmatched(existingByHash, hashKey(item), matchedIds);
    if (hashMatch) {
      return { scanned: item, existing: hashMatch, reason: 'hash' as const };
    }

    const pathMatch = takeUnmatched(existingByPath, pathKey(item), matchedIds);
    if (pathMatch) {
      return { scanned: item, existing: pathMatch, reason: 'path' as const };
    }

    const fingerprintMatch = takeUnmatched(
      existingByFingerprint,
      fingerprintKey(item),
      matchedIds,
    );
    if (fingerprintMatch) {
      return { scanned: item, existing: fingerprintMatch, reason: 'fingerprint' as const };
    }

    return { scanned: item, existing: null, reason: 'new' as const };
  });

  return {
    matches,
    missing: existing.filter((entry) => !matchedIds.has(entry.id)),
  };
}
