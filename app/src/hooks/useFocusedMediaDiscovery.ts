import { useEffect } from 'react';
import type { CatalogEntry } from '../db.js';
import { discoverFocusedMediaForEntry } from '../scan.js';

export function useFocusedMediaDiscovery(entry: CatalogEntry | null | undefined): void {
  useEffect(() => {
    if (!entry) return;
    void discoverFocusedMediaForEntry(entry).catch(() => {
      // Focused discovery is opportunistic and must never disrupt playback.
    });
  }, [
    entry?.id,
    entry?.directoryId,
    entry?.path,
    entry?.detectedMediaType,
    entry?.parsedTitle,
    entry?.parsedYear,
    entry?.seriesMetadataKey,
  ]);
}
