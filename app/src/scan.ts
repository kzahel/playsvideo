import {
  db,
  type CatalogEntry,
} from './db.js';
import {
  folderProvider,
  type FileAccessOptions,
  type FolderRescanOptions,
  isFileAccessPermissionError,
  type ScannedFile,
  type ScannedManifest,
} from './folder-provider.js';
import { refreshCatalogMetadata } from './metadata/client.js';
import { reconcilePendingHandoffs } from './handoff/pending-handoffs.js';
import { backfillCatalogAliases } from './playback-identity-resolver.js';
import {
  buildMissingCatalogEntry,
  planFocusedCatalogUpdates,
  planFullCatalogReconciliation,
} from './scanning/catalog-reconciliation.js';
import {
  buildFocusedDiscoveryPlan,
  emptyFocusedDiscoveryResult,
  FocusedDiscoveryCoordinator,
  focusedDiscoveryPlanKey,
  type FocusedDiscoveryResult,
} from './scanning/focused-discovery.js';
import { DirectoryScanCoordinator } from './scanning/scan-coordinator.js';

export { type ScannedFile } from './folder-provider.js';
export { refreshCatalogMetadata } from './metadata/client.js';

export interface ScanResult {
  fileCount: number;
}

export async function setFolder(): Promise<ScanResult> {
  const result = await folderProvider.pickFolder();
  await syncCatalog(result.directoryId, result.files, result.manifests);
  return { fileCount: result.files.length };
}

export async function rescanFolder(
  directoryId?: number,
  options?: FolderRescanOptions,
): Promise<ScanResult> {
  const resolvedDirectoryId =
    directoryId ?? (await db.directories.toCollection().first())?.id;
  if (resolvedDirectoryId == null) throw new Error('No directory to rescan');

  return directoryScanCoordinator.run(resolvedDirectoryId, async () => {
    const result = await folderProvider.rescan(resolvedDirectoryId, options);
    await syncCatalog(result.directoryId, result.files, result.manifests);
    return { fileCount: result.files.length };
  });
}

export async function rescanAllFolders(options?: FolderRescanOptions): Promise<ScanResult> {
  const dirs = await db.directories.toArray();
  let fileCount = 0;
  for (const dir of dirs) {
    const result = await rescanFolder(dir.id, options);
    fileCount += result.fileCount;
  }
  return { fileCount };
}

export async function removeFolder(directoryId: number): Promise<void> {
  const updatedAt = Date.now();
  await db.transaction('rw', db.catalog, db.directories, async () => {
    const catalogEntries = await db.catalog.where('directoryId').equals(directoryId).toArray();
    if (catalogEntries.length > 0) {
      await db.catalog.bulkPut(
        catalogEntries.map((entry) => buildMissingCatalogEntry(entry, updatedAt)),
      );
    }
    await db.directories.delete(directoryId);
  });
}

export async function getFile(entry: CatalogEntry, options?: FileAccessOptions): Promise<File> {
  return folderProvider.getFile(entry, options);
}

const focusedDiscoveryCoordinator = new FocusedDiscoveryCoordinator();
const directoryScanCoordinator = new DirectoryScanCoordinator();

export async function discoverFocusedMediaForEntry(
  currentEntry: CatalogEntry,
): Promise<FocusedDiscoveryResult> {
  const catalogEntries = await db.catalog.toArray();
  const discovery = buildFocusedDiscoveryPlan(currentEntry, catalogEntries);
  if (!discovery) return emptyFocusedDiscoveryResult('unsupported');

  return focusedDiscoveryCoordinator.run(focusedDiscoveryPlanKey(discovery), () =>
    directoryScanCoordinator.run(discovery.directoryId, async () => {
      let result;
      try {
        result = await folderProvider.discover(discovery.directoryId, {
          scopePath: discovery.scopePath,
          maxEntries: discovery.maxEntries,
        });
      } catch (error) {
        return emptyFocusedDiscoveryResult(
          isFileAccessPermissionError(error) ? 'permission-required' : 'failed',
          discovery,
        );
      }

      const [latestCatalogEntries, seriesMetadata, movieMetadata] = await Promise.all([
        db.catalog.toArray(),
        db.seriesMetadata.toArray(),
        db.movieMetadata.toArray(),
      ]);
      const updatePlan = planFocusedCatalogUpdates({
        discovery,
        files: result.files,
        manifests: result.manifests,
        allCatalogEntries: latestCatalogEntries,
        seriesMetadata,
        movieMetadata,
        scannedAt: Date.now(),
      });
      if (updatePlan.updates.length > 0) {
        await db.catalog.bulkPut(updatePlan.updates);
      }

      return {
        status: updatePlan.updates.length > 0 ? 'updated' : 'unchanged',
        scopePath: discovery.scopePath,
        inspectedEntryCount: result.inspectedEntryCount,
        relevantFileCount: updatePlan.relevantFileCount,
        updatedEntryCount: updatePlan.updates.length,
        truncated: result.truncated,
      };
    }),
  );
}

async function syncCatalog(
  directoryId: number,
  files: ScannedFile[],
  manifests: ScannedManifest[],
): Promise<void> {
  const scannedAt = Date.now();
  const [allCatalogEntries, seriesMetadata, movieMetadata] = await Promise.all([
    db.catalog.toArray(),
    db.seriesMetadata.toArray(),
    db.movieMetadata.toArray(),
  ]);
  const { presentUpdates, missingUpdates } = planFullCatalogReconciliation({
    directoryId,
    files,
    manifests,
    allCatalogEntries,
    seriesMetadata,
    movieMetadata,
    scannedAt,
  });
  const catalogChanged = presentUpdates.length > 0 || missingUpdates.length > 0;
  let persistedPresentEntries: CatalogEntry[] = [];

  await db.transaction('rw', db.catalog, db.directories, async () => {
    if (presentUpdates.length > 0) {
      const ids = await db.catalog.bulkPut(presentUpdates, { allKeys: true });
      persistedPresentEntries = presentUpdates.map((entry, index) => ({ ...entry, id: ids[index] }));
    }
    if (missingUpdates.length > 0) {
      await db.catalog.bulkPut(missingUpdates);
    }

    await db.directories.update(directoryId, { lastScannedAt: scannedAt });
  });

  if (presentUpdates.length > 0) {
    await refreshCatalogMetadata({ entries: persistedPresentEntries });
  }
  if (catalogChanged) {
    await backfillCatalogAliases();
    await reconcilePendingHandoffs();
  }
}
