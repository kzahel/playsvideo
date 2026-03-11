import { db, type LibraryEntry } from './db.js';
import { folderProvider, type ScannedFile } from './folder-provider.js';

export { type ScannedFile } from './folder-provider.js';

export async function setFolder(): Promise<void> {
  const result = await folderProvider.pickFolder();
  await syncToLibrary(result.directoryId, result.files);
}

export async function rescanFolder(directoryId?: number): Promise<void> {
  const result = await folderProvider.rescan(directoryId);
  await syncToLibrary(result.directoryId, result.files);
}

export async function rescanAllFolders(): Promise<void> {
  const dirs = await db.directories.toArray();
  for (const dir of dirs) {
    await rescanFolder(dir.id);
  }
}

export async function removeFolder(directoryId: number): Promise<void> {
  await db.library.where('directoryId').equals(directoryId).delete();
  await db.directories.delete(directoryId);
}

export async function getFile(entry: LibraryEntry): Promise<File> {
  return folderProvider.getFile(entry);
}

async function syncToLibrary(directoryId: number, files: ScannedFile[]): Promise<void> {
  // Snapshot ALL entries for watch state + ID preservation (cross-directory matching)
  const allEntries = await db.library.toArray();
  const oldByIdentity = new Map<string, LibraryEntry>();
  for (const e of allEntries) {
    oldByIdentity.set(`${e.name}|${e.size}|${e.lastModified}`, e);
  }

  // Clean up orphaned entries whose directory no longer exists
  const dirIds = new Set((await db.directories.toArray()).map((d) => d.id));
  dirIds.add(directoryId);
  const orphanIds = allEntries
    .filter((e) => !dirIds.has(e.directoryId))
    .map((e) => e.id);
  if (orphanIds.length) await db.library.bulkDelete(orphanIds);

  // Delete current directory's entries (they'll be re-added below)
  await db.library.where('directoryId').equals(directoryId).delete();

  for (const file of files) {
    const identity = `${file.name}|${file.size}|${file.lastModified}`;
    const old = oldByIdentity.get(identity);
    // Use put with old ID to preserve player URLs across folder re-selections
    await db.library.put({
      ...(old?.id != null ? { id: old.id } : {}),
      directoryId,
      name: file.name,
      path: file.path,
      size: file.size,
      lastModified: file.lastModified,
      watchState: old?.watchState ?? 'unwatched',
      playbackPositionSec: old?.playbackPositionSec ?? 0,
      durationSec: old?.durationSec ?? 0,
      addedAt: old?.addedAt ?? Date.now(),
    } as LibraryEntry);
  }

  await db.directories.update(directoryId, { lastScannedAt: Date.now() });
}
