import {
  db,
  type CatalogEntry,
  type DetectedMediaType,
  type LibraryEntry,
  type MovieMetadataEntry,
  type SeriesMetadataEntry,
} from './db.js';
import { matchScannedCatalogItems, type ScannedCatalogItem } from './catalog-match.js';
import {
  folderProvider,
  type FileAccessOptions,
  type FolderRescanOptions,
  type ScannedFile,
  type ScannedManifest,
} from './folder-provider.js';
import { parseMediaMetadata } from './media-metadata.js';
import { refreshLibraryMetadata } from './metadata/client.js';
import { buildPlaybackKeyCandidates } from './playback-key.js';

export { type ScannedFile } from './folder-provider.js';
export { refreshLibraryMetadata } from './metadata/client.js';

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.webm', '.mov', '.m4v',
  '.ts', '.mts', '.flv', '.wmv', '.ogv', '.3gp',
]);

function isVideoFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return VIDEO_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

export async function setFolder(): Promise<void> {
  const result = await folderProvider.pickFolder();
  await syncToLibrary(result.directoryId, result.files, result.manifests);
}

export async function rescanFolder(
  directoryId?: number,
  options?: FolderRescanOptions,
): Promise<void> {
  const result = await folderProvider.rescan(directoryId, options);
  await syncToLibrary(result.directoryId, result.files, result.manifests);
}

export async function rescanAllFolders(options?: FolderRescanOptions): Promise<void> {
  const dirs = await db.directories.toArray();
  for (const dir of dirs) {
    await rescanFolder(dir.id, options);
  }
}

export async function removeFolder(directoryId: number): Promise<void> {
  const updatedAt = Date.now();
  await db.transaction('rw', db.catalog, db.library, db.directories, async () => {
    const catalogEntries = await db.catalog.where('directoryId').equals(directoryId).toArray();
    if (catalogEntries.length > 0) {
      await db.catalog.bulkPut(
        catalogEntries.map((entry) => buildMissingCatalogEntry(entry, updatedAt)),
      );
    }
    await db.library.where('directoryId').equals(directoryId).delete();
    await db.directories.delete(directoryId);
  });
}

export async function getFile(entry: LibraryEntry, options?: FileAccessOptions): Promise<File> {
  return folderProvider.getFile(entry, options);
}

function manifestDir(manifestPath: string): string {
  const slash = manifestPath.lastIndexOf('/');
  return slash === -1 ? '' : manifestPath.slice(0, slash);
}

interface ScannedCatalogRecord extends ScannedCatalogItem {
  directoryId: number;
  hasLocalFile: boolean;
  detectedMediaType: DetectedMediaType;
  parsedTitle?: string;
  parsedYear?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  endingEpisodeNumber?: number;
  seriesMetadataKey?: string;
  movieMetadataKey?: string;
  torrentMagnetUrl?: string;
  torrentComplete?: boolean;
}

function identityKey(entry: Pick<LibraryEntry, 'name' | 'size' | 'lastModified'>): string {
  return `${entry.name}|${entry.size}|${entry.lastModified}`;
}

function torrentKey(entry: {
  torrentInfoHash?: string;
  torrentFileIndex?: number;
}): string | null {
  return entry.torrentInfoHash != null && entry.torrentFileIndex != null
    ? `${entry.torrentInfoHash}:${entry.torrentFileIndex}`
    : null;
}

function mergeDetectedMediaType(
  nextType: DetectedMediaType,
  existingType?: DetectedMediaType,
): DetectedMediaType {
  return nextType !== 'unknown' ? nextType : existingType ?? 'unknown';
}

function chooseCatalogPlaybackKey(
  entry: CatalogEntry,
  seriesMetadataByKey: Map<string, SeriesMetadataEntry>,
  movieMetadataByKey: Map<string, MovieMetadataEntry>,
): string {
  const candidates = buildPlaybackKeyCandidates(
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
    {
      seriesMetadataByKey,
      movieMetadataByKey,
    },
  );

  if (entry.canonicalPlaybackKey) {
    const existing = candidates.find((candidate) => candidate.key === entry.canonicalPlaybackKey);
    if (existing) {
      return existing.key;
    }
  }

  return candidates[0].key;
}

function buildScannedCatalogRecords(
  directoryId: number,
  files: ScannedFile[],
  manifests: ScannedManifest[],
): ScannedCatalogRecord[] {
  const records: ScannedCatalogRecord[] = files.map((file) => ({
    directoryId,
    name: file.name,
    path: file.path,
    size: file.size,
    lastModified: file.lastModified,
    hasLocalFile: true,
    ...parseMediaMetadata(file.path),
  }));

  const recordByPath = new Map(records.map((record) => [record.path, record]));
  for (const manifest of manifests) {
    const dir = manifestDir(manifest.path);
    for (const [fileName, fileData] of Object.entries(manifest.data.files)) {
      if (!isVideoFileName(fileName)) continue;

      const filePath = dir ? `${dir}/${fileName}` : fileName;
      const torrentFields = {
        torrentInfoHash: manifest.data.infohash,
        torrentFileIndex: fileData.index,
        torrentMagnetUrl: manifest.data.magnet,
        torrentComplete: fileData.complete,
      };

      const localRecord = recordByPath.get(filePath);
      if (localRecord) {
        Object.assign(localRecord, torrentFields);
        continue;
      }

      const virtualRecord: ScannedCatalogRecord = {
        directoryId,
        name: fileName,
        path: filePath,
        size: 0,
        lastModified: 0,
        hasLocalFile: false,
        ...torrentFields,
        ...parseMediaMetadata(filePath),
      };
      records.push(virtualRecord);
      recordByPath.set(filePath, virtualRecord);
    }
  }

  return records;
}

function buildCatalogEntry(
  record: ScannedCatalogRecord,
  existing: CatalogEntry | null,
  scannedAt: number,
  seriesMetadataByKey: Map<string, SeriesMetadataEntry>,
  movieMetadataByKey: Map<string, MovieMetadataEntry>,
): CatalogEntry {
  const nextEntry: CatalogEntry = {
    ...(existing?.id != null ? { id: existing.id } : {}),
    createdAt: existing?.createdAt ?? scannedAt,
    updatedAt: scannedAt,
    name: record.name,
    path: record.path,
    directoryId: record.directoryId,
    size: record.size,
    lastModified: record.lastModified,
    availability: 'present',
    lastSeenAt: scannedAt,
    firstMissingAt: undefined,
    detectedMediaType: mergeDetectedMediaType(record.detectedMediaType, existing?.detectedMediaType),
    parsedTitle: record.parsedTitle ?? existing?.parsedTitle,
    parsedYear: record.parsedYear ?? existing?.parsedYear,
    seasonNumber: record.seasonNumber ?? existing?.seasonNumber,
    episodeNumber: record.episodeNumber ?? existing?.episodeNumber,
    endingEpisodeNumber: record.endingEpisodeNumber ?? existing?.endingEpisodeNumber,
    seriesMetadataKey: record.seriesMetadataKey ?? existing?.seriesMetadataKey,
    movieMetadataKey: record.movieMetadataKey ?? existing?.movieMetadataKey,
    contentHash: existing?.contentHash,
    torrentInfoHash: record.torrentInfoHash ?? existing?.torrentInfoHash,
    torrentFileIndex: record.torrentFileIndex ?? existing?.torrentFileIndex,
    torrentMagnetUrl: record.torrentMagnetUrl ?? existing?.torrentMagnetUrl,
    torrentComplete: record.torrentComplete ?? existing?.torrentComplete,
    canonicalPlaybackKey: existing?.canonicalPlaybackKey,
  };

  nextEntry.canonicalPlaybackKey = chooseCatalogPlaybackKey(
    nextEntry,
    seriesMetadataByKey,
    movieMetadataByKey,
  );

  return nextEntry;
}

function buildMissingCatalogEntry(existing: CatalogEntry, scannedAt: number): CatalogEntry {
  return {
    ...existing,
    availability: 'missing',
    updatedAt: scannedAt,
    firstMissingAt: existing.firstMissingAt ?? scannedAt,
  };
}

function buildLegacyLibraryProjection(
  records: ScannedCatalogRecord[],
  previousEntries: LibraryEntry[],
): LibraryEntry[] {
  const oldByIdentity = new Map<string, LibraryEntry>();
  const oldByTorrentKey = new Map<string, LibraryEntry>();
  for (const entry of previousEntries) {
    oldByIdentity.set(identityKey(entry), entry);
    const key = torrentKey(entry);
    if (key) {
      oldByTorrentKey.set(key, entry);
    }
  }

  const projected: LibraryEntry[] = [];
  for (const record of records) {
    const key = torrentKey(record);
    const old =
      (key ? oldByTorrentKey.get(key) : undefined) ??
      oldByIdentity.get(identityKey(record));
    projected.push({
      ...(old?.id != null ? { id: old.id } : {}),
      directoryId: record.directoryId,
      name: record.name,
      path: record.path,
      size: record.size,
      lastModified: record.lastModified,
      watchState: old?.watchState ?? 'unwatched',
      playbackPositionSec: old?.playbackPositionSec ?? 0,
      durationSec: old?.durationSec ?? 0,
      addedAt: old?.addedAt ?? Date.now(),
      lastPlayedAt: old?.lastPlayedAt,
      detectedMediaType: record.detectedMediaType,
      parsedTitle: record.parsedTitle,
      parsedYear: record.parsedYear,
      seasonNumber: record.seasonNumber,
      episodeNumber: record.episodeNumber,
      endingEpisodeNumber: record.endingEpisodeNumber,
      seriesMetadataKey: record.seriesMetadataKey,
      movieMetadataKey: record.movieMetadataKey,
      contentHash: old?.contentHash,
      torrentInfoHash: record.torrentInfoHash,
      torrentFileIndex: record.torrentFileIndex,
      torrentMagnetUrl: record.torrentMagnetUrl,
      torrentComplete: record.torrentComplete,
      hasLocalFile: record.hasLocalFile,
    });
  }

  return projected;
}

async function syncToLibrary(
  directoryId: number,
  files: ScannedFile[],
  manifests: ScannedManifest[],
): Promise<void> {
  const scannedAt = Date.now();
  const scannedRecords = buildScannedCatalogRecords(directoryId, files, manifests);
  const [allCatalogEntries, allLibraryEntries, seriesMetadata, movieMetadata] = await Promise.all([
    db.catalog.toArray(),
    db.library.toArray(),
    db.seriesMetadata.toArray(),
    db.movieMetadata.toArray(),
  ]);
  const seriesMetadataByKey = new Map(seriesMetadata.map((entry) => [entry.key, entry]));
  const movieMetadataByKey = new Map(movieMetadata.map((entry) => [entry.key, entry]));
  const { matches } = matchScannedCatalogItems(allCatalogEntries, scannedRecords);
  const matchedCatalogIds = new Set(
    matches.flatMap((match) => (match.existing ? [match.existing.id] : [])),
  );
  const missingCatalogEntries = allCatalogEntries
    .filter((entry) => entry.directoryId === directoryId)
    .filter((entry) => !matchedCatalogIds.has(entry.id))
    .map((entry) => buildMissingCatalogEntry(entry, scannedAt));
  const nextCatalogEntries = matches.map((match) =>
    buildCatalogEntry(
      match.scanned as ScannedCatalogRecord,
      match.existing,
      scannedAt,
      seriesMetadataByKey,
      movieMetadataByKey,
    ),
  );
  const nextLibraryEntries = buildLegacyLibraryProjection(scannedRecords, allLibraryEntries);

  await db.transaction('rw', db.catalog, db.library, db.directories, async () => {
    if (nextCatalogEntries.length > 0) {
      await db.catalog.bulkPut(nextCatalogEntries);
    }
    if (missingCatalogEntries.length > 0) {
      await db.catalog.bulkPut(missingCatalogEntries);
    }

    await db.library.where('directoryId').equals(directoryId).delete();
    if (nextLibraryEntries.length > 0) {
      await db.library.bulkPut(nextLibraryEntries);
    }

    await db.directories.update(directoryId, { lastScannedAt: scannedAt });
  });

  await refreshLibraryMetadata({ entries: nextLibraryEntries });
}
