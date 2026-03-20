import { db, type LibraryEntry } from './db.js';
import {
  folderProvider,
  type FileAccessOptions,
  type FolderRescanOptions,
  type ScannedFile,
  type ScannedManifest,
} from './folder-provider.js';
import { parseMediaMetadata } from './media-metadata.js';
import { refreshLibraryMetadata } from './metadata/client.js';

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
  await db.library.where('directoryId').equals(directoryId).delete();
  await db.directories.delete(directoryId);
}

export async function getFile(entry: LibraryEntry, options?: FileAccessOptions): Promise<File> {
  return folderProvider.getFile(entry, options);
}

function manifestDir(manifestPath: string): string {
  const slash = manifestPath.lastIndexOf('/');
  return slash === -1 ? '' : manifestPath.slice(0, slash);
}

async function syncToLibrary(
  directoryId: number,
  files: ScannedFile[],
  manifests: ScannedManifest[],
): Promise<void> {
  // Snapshot ALL entries for watch state + ID preservation (cross-directory matching)
  const allEntries = await db.library.toArray();
  const oldByIdentity = new Map<string, LibraryEntry>();
  const oldByTorrentKey = new Map<string, LibraryEntry>();
  for (const e of allEntries) {
    oldByIdentity.set(`${e.name}|${e.size}|${e.lastModified}`, e);
    if (e.torrentInfoHash != null && e.torrentFileIndex != null) {
      oldByTorrentKey.set(`${e.torrentInfoHash}:${e.torrentFileIndex}`, e);
    }
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

  const nextEntries: LibraryEntry[] = [];
  const localFilePaths = new Set<string>();

  for (const file of files) {
    const identity = `${file.name}|${file.size}|${file.lastModified}`;
    const old = oldByIdentity.get(identity);
    const parsed = parseMediaMetadata(file.path);
    localFilePaths.add(file.path);
    nextEntries.push({
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
      hasLocalFile: true,
      ...parsed,
    } as LibraryEntry);
  }

  // Process manifest files: enrich local entries + create virtual entries
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

      // Check if we have a local file for this manifest entry
      const localEntry = nextEntries.find((e) => e.path === filePath);
      if (localEntry) {
        Object.assign(localEntry, torrentFields);
        continue;
      }

      // Create virtual entry — use manifest dir as path context for metadata parsing
      const torrentKey = `${manifest.data.infohash}:${fileData.index}`;
      const old = oldByTorrentKey.get(torrentKey);
      const parsed = parseMediaMetadata(filePath);
      nextEntries.push({
        ...(old?.id != null ? { id: old.id } : {}),
        directoryId,
        name: fileName,
        path: filePath,
        size: 0,
        lastModified: 0,
        watchState: old?.watchState ?? 'unwatched',
        playbackPositionSec: old?.playbackPositionSec ?? 0,
        durationSec: old?.durationSec ?? 0,
        addedAt: old?.addedAt ?? Date.now(),
        hasLocalFile: false,
        ...torrentFields,
        ...parsed,
      } as LibraryEntry);
    }
  }

  if (nextEntries.length > 0) {
    await db.library.bulkPut(nextEntries);
  }
  await db.directories.update(directoryId, { lastScannedAt: Date.now() });
  await refreshLibraryMetadata({ entries: nextEntries });
}
