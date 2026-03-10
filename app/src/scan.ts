import { db, type LibraryEntry } from './db.js';
import { folderProvider, type ScannedFile } from './folder-provider.js';

export { type ScannedFile } from './folder-provider.js';

export async function setFolder(): Promise<void> {
  const result = await folderProvider.pickFolder();
  await syncToLibrary(result.files);
}

export async function rescanFolder(): Promise<void> {
  const result = await folderProvider.rescan();
  await syncToLibrary(result.files);
}

export async function getFile(entry: LibraryEntry): Promise<File> {
  return folderProvider.getFile(entry);
}

async function syncToLibrary(files: ScannedFile[]): Promise<void> {
  // Snapshot existing entries for file-identity matching (preserves watch progress)
  const oldEntries = await db.library.toArray();
  const oldByIdentity = new Map<string, LibraryEntry>();
  for (const e of oldEntries) {
    oldByIdentity.set(`${e.name}|${e.size}|${e.lastModified}`, e);
  }

  // Get the directory that the provider just created/updated
  const dir = await db.directories.toCollection().first();
  if (!dir) return;

  // Clear old library entries and insert new ones
  await db.library.clear();

  for (const file of files) {
    const identity = `${file.name}|${file.size}|${file.lastModified}`;
    const old = oldByIdentity.get(identity);
    await db.library.add({
      directoryId: dir.id,
      name: file.name,
      path: file.path,
      size: file.size,
      lastModified: file.lastModified,
      watchState: old?.watchState ?? 'unwatched',
      playbackPositionSec: old?.playbackPositionSec ?? 0,
      durationSec: old?.durationSec ?? 0,
      addedAt: Date.now(),
    } as LibraryEntry);
  }

  await db.directories.update(dir.id, { lastScannedAt: Date.now() });
}
