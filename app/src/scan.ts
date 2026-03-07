import { db, type DirectoryEntry, type LibraryEntry } from './db';

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

function isVideoFile(name: string): boolean {
  const dot = name.lastIndexOf('.');
  if (dot === -1) return false;
  return VIDEO_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

interface ScannedFile {
  name: string;
  path: string;
  size: number;
  lastModified: number;
}

async function* walkDirectory(
  handle: FileSystemDirectoryHandle,
  pathPrefix = '',
): AsyncGenerator<ScannedFile> {
  for await (const entry of handle.values()) {
    const entryPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
    if (entry.kind === 'file') {
      if (isVideoFile(entry.name)) {
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        yield {
          name: entry.name,
          path: entryPath,
          size: file.size,
          lastModified: file.lastModified,
        };
      }
    } else if (entry.kind === 'directory') {
      yield* walkDirectory(entry as FileSystemDirectoryHandle, entryPath);
    }
  }
}

async function ensurePermission(handle: FileSystemDirectoryHandle): Promise<void> {
  const status = await handle.queryPermission({ mode: 'read' });
  if (status === 'granted') return;
  const requested = await handle.requestPermission({ mode: 'read' });
  if (requested !== 'granted') {
    throw new Error('Permission denied for directory');
  }
}

export async function scanDirectory(directoryId: number): Promise<number> {
  const dirEntry = await db.directories.get(directoryId);
  if (!dirEntry) throw new Error(`Directory ${directoryId} not found`);

  await ensurePermission(dirEntry.handle);

  const existingPaths = new Set(
    (await db.library.where('directoryId').equals(directoryId).toArray()).map((e) => e.path),
  );

  const scannedPaths = new Set<string>();
  let addedCount = 0;

  for await (const file of walkDirectory(dirEntry.handle)) {
    scannedPaths.add(file.path);
    if (!existingPaths.has(file.path)) {
      await db.library.add({
        directoryId,
        name: file.name,
        path: file.path,
        size: file.size,
        lastModified: file.lastModified,
        watchState: 'unwatched',
        playbackPositionSec: 0,
        durationSec: 0,
        addedAt: Date.now(),
      } as LibraryEntry);
      addedCount++;
    }
  }

  // Remove entries for files that no longer exist
  const toRemove = [...existingPaths].filter((p) => !scannedPaths.has(p));
  if (toRemove.length > 0) {
    const removeSet = new Set(toRemove);
    await db.library
      .where('directoryId')
      .equals(directoryId)
      .filter((e) => removeSet.has(e.path))
      .delete();
  }

  await db.directories.update(directoryId, { lastScannedAt: Date.now() });

  return addedCount;
}

export async function addDirectory(handle: FileSystemDirectoryHandle): Promise<number> {
  const id = await db.directories.add({
    handle,
    name: handle.name,
    addedAt: Date.now(),
    lastScannedAt: 0,
  } as DirectoryEntry);
  return id as number;
}

export async function getFileFromLibraryEntry(entry: LibraryEntry): Promise<File> {
  const dir = await db.directories.get(entry.directoryId);
  if (!dir) throw new Error(`Directory ${entry.directoryId} not found`);

  await ensurePermission(dir.handle);

  const parts = entry.path.split('/');
  let current: FileSystemDirectoryHandle = dir.handle;
  for (let i = 0; i < parts.length - 1; i++) {
    current = await current.getDirectoryHandle(parts[i]);
  }
  const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
  return fileHandle.getFile();
}
