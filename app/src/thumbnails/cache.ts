import type { CatalogEntry } from '../db.js';

export const LOCAL_THUMBNAIL_GENERATOR_VERSION = 1;

type LocalThumbnailIdentity = Pick<
  CatalogEntry,
  'directoryId' | 'path' | 'size' | 'lastModified' | 'hasLocalFile' | 'availability'
>;

export function getLocalThumbnailCacheKey(entry: LocalThumbnailIdentity): string | null {
  if (
    entry.directoryId == null ||
    entry.hasLocalFile === false ||
    entry.availability !== 'present'
  ) {
    return null;
  }

  return [
    'local-video',
    LOCAL_THUMBNAIL_GENERATOR_VERSION,
    entry.directoryId,
    entry.size,
    entry.lastModified,
    entry.path,
  ].join(':');
}
