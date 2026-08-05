import { matchScannedCatalogItems, type ScannedCatalogItem } from '../catalog-match.js';
import type {
  CatalogEntry,
  DetectedMediaType,
  MovieMetadataEntry,
  SeriesMetadataEntry,
} from '../db.js';
import type { ScannedFile, ScannedManifest } from '../folder-provider.js';
import { parseMediaMetadata } from '../media-metadata.js';
import { buildPlaybackKeyCandidates } from '../playback-key.js';
import { catalogSeriesIdentity, type FocusedDiscoveryPlan } from './focused-discovery.js';

const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mkv',
  '.avi',
  '.webm',
  '.mov',
  '.m4v',
  '.ts',
  '.mts',
  '.flv',
  '.wmv',
  '.ogv',
  '.3gp',
]);

function isVideoFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return VIDEO_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

function manifestDirectory(manifestPath: string): string {
  const slash = manifestPath.lastIndexOf('/');
  return slash === -1 ? '' : manifestPath.slice(0, slash);
}

export interface ScannedCatalogRecord extends ScannedCatalogItem {
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

function mergeDetectedMediaType(
  nextType: DetectedMediaType,
  existingType?: DetectedMediaType,
): DetectedMediaType {
  return nextType !== 'unknown' ? nextType : existingType ?? 'unknown';
}

function metadataMaps(input: {
  seriesMetadata: SeriesMetadataEntry[];
  movieMetadata: MovieMetadataEntry[];
}): {
  seriesMetadataByKey: Map<string, SeriesMetadataEntry>;
  movieMetadataByKey: Map<string, MovieMetadataEntry>;
} {
  return {
    seriesMetadataByKey: new Map(input.seriesMetadata.map((entry) => [entry.key, entry])),
    movieMetadataByKey: new Map(input.movieMetadata.map((entry) => [entry.key, entry])),
  };
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
    if (existing) return existing.key;
  }

  return candidates[0].key;
}

export function buildScannedCatalogRecords(
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
    const directory = manifestDirectory(manifest.path);
    for (const [fileName, fileData] of Object.entries(manifest.data.files)) {
      if (!isVideoFileName(fileName)) continue;

      const filePath = directory ? `${directory}/${fileName}` : fileName;
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

export function buildCatalogEntry(
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
    hasLocalFile: record.hasLocalFile,
    lastSeenAt: scannedAt,
    firstMissingAt: undefined,
    detectedMediaType: mergeDetectedMediaType(record.detectedMediaType, existing?.detectedMediaType),
    parsedTitle: record.parsedTitle ?? existing?.parsedTitle,
    parsedYear: record.parsedYear ?? existing?.parsedYear,
    seasonNumber: record.seasonNumber ?? existing?.seasonNumber,
    episodeNumber: record.episodeNumber ?? existing?.episodeNumber,
    endingEpisodeNumber: record.endingEpisodeNumber,
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

export function buildMissingCatalogEntry(
  existing: CatalogEntry,
  scannedAt: number,
): CatalogEntry {
  return {
    ...existing,
    availability: 'missing',
    hasLocalFile: false,
    updatedAt: scannedAt,
    firstMissingAt: existing.firstMissingAt ?? scannedAt,
  };
}

export interface FullCatalogReconciliationPlan {
  presentUpdates: CatalogEntry[];
  missingUpdates: CatalogEntry[];
}

export function planFullCatalogReconciliation(input: {
  directoryId: number;
  files: ScannedFile[];
  manifests: ScannedManifest[];
  allCatalogEntries: CatalogEntry[];
  seriesMetadata: SeriesMetadataEntry[];
  movieMetadata: MovieMetadataEntry[];
  scannedAt: number;
}): FullCatalogReconciliationPlan {
  const scannedRecords = buildScannedCatalogRecords(
    input.directoryId,
    input.files,
    input.manifests,
  );
  const { seriesMetadataByKey, movieMetadataByKey } = metadataMaps(input);
  const { matches } = matchScannedCatalogItems(input.allCatalogEntries, scannedRecords);
  const matchedCatalogIds = new Set(
    matches.flatMap((match) => (match.existing ? [match.existing.id] : [])),
  );
  const presentUpdates = matches.flatMap((match) => {
    const next = buildCatalogEntry(
      match.scanned as ScannedCatalogRecord,
      match.existing,
      input.scannedAt,
      seriesMetadataByKey,
      movieMetadataByKey,
    );
    if (match.existing && !catalogEntryNeedsMaterialUpdate(match.existing as CatalogEntry, next)) {
      return [];
    }
    return [next];
  });
  const missingUpdates = input.allCatalogEntries
    .filter((entry) => entry.directoryId === input.directoryId)
    .filter((entry) => !matchedCatalogIds.has(entry.id))
    .flatMap((entry) => {
      const next = buildMissingCatalogEntry(entry, input.scannedAt);
      return catalogEntryNeedsMaterialUpdate(entry, next) ? [next] : [];
    });

  return {
    presentUpdates,
    missingUpdates,
  };
}

const CATALOG_MATERIAL_FIELDS = [
  'name',
  'path',
  'directoryId',
  'size',
  'lastModified',
  'availability',
  'firstMissingAt',
  'detectedMediaType',
  'parsedTitle',
  'parsedYear',
  'seasonNumber',
  'episodeNumber',
  'endingEpisodeNumber',
  'seriesMetadataKey',
  'movieMetadataKey',
  'contentHash',
  'torrentInfoHash',
  'torrentFileIndex',
  'torrentMagnetUrl',
  'torrentComplete',
  'hasLocalFile',
  'canonicalPlaybackKey',
] as const satisfies ReadonlyArray<keyof CatalogEntry>;

export function catalogEntryNeedsMaterialUpdate(
  existing: CatalogEntry,
  next: CatalogEntry,
): boolean {
  return CATALOG_MATERIAL_FIELDS.some((field) => existing[field] !== next[field]);
}

export interface FocusedCatalogUpdatePlan {
  updates: CatalogEntry[];
  relevantFileCount: number;
}

export function planFocusedCatalogUpdates(input: {
  discovery: FocusedDiscoveryPlan;
  files: ScannedFile[];
  manifests: ScannedManifest[];
  allCatalogEntries: CatalogEntry[];
  seriesMetadata: SeriesMetadataEntry[];
  movieMetadata: MovieMetadataEntry[];
  scannedAt: number;
}): FocusedCatalogUpdatePlan {
  const focusedRecords = buildScannedCatalogRecords(
    input.discovery.directoryId,
    input.files,
    input.manifests,
  )
    .filter((record) => record.hasLocalFile)
    .filter(
      (record) => catalogSeriesIdentity(record) === input.discovery.seriesIdentity,
    );
  const existingDirectoryEntries = input.allCatalogEntries.filter(
    (entry) => entry.directoryId === input.discovery.directoryId,
  );
  const { matches } = matchScannedCatalogItems(existingDirectoryEntries, focusedRecords);
  const { seriesMetadataByKey, movieMetadataByKey } = metadataMaps(input);
  let relevantFileCount = 0;
  const updates = matches.flatMap((match) => {
    const next = buildCatalogEntry(
      match.scanned as ScannedCatalogRecord,
      match.existing,
      input.scannedAt,
      seriesMetadataByKey,
      movieMetadataByKey,
    );
    if (next.torrentComplete === false) return [];
    relevantFileCount += 1;
    if (!match.existing || catalogEntryNeedsMaterialUpdate(match.existing as CatalogEntry, next)) {
      return [next];
    }
    return [];
  });

  return { updates, relevantFileCount };
}
