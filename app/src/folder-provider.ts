import { db, type LibraryEntry } from './db.js';
import { isExtension } from './context.js';

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

export interface ScannedFile {
  name: string;
  path: string;
  size: number;
  lastModified: number;
}

export interface FolderResult {
  directoryId: number;
  name: string;
  files: ScannedFile[];
}

export interface FolderProvider {
  readonly requiresPermissionGrant: boolean;
  pickFolder(): Promise<FolderResult>;
  getFile(entry: LibraryEntry): Promise<File>;
  rescan(directoryId?: number): Promise<FolderResult>;
}

// --- File System Access API provider (Chromium) ---

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

async function collectFiles(handle: FileSystemDirectoryHandle): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];
  for await (const f of walkDirectory(handle)) {
    files.push(f);
  }
  return files;
}

class FsAccessProvider implements FolderProvider {
  readonly requiresPermissionGrant = true;

  async pickFolder(): Promise<FolderResult> {
    const handle = await window.showDirectoryPicker({ mode: 'read' });
    if (!isExtension()) {
      await db.directories.clear();
    }
    const directoryId = await db.directories.add({
      handle,
      name: handle.name,
      addedAt: Date.now(),
      lastScannedAt: Date.now(),
    } as Parameters<typeof db.directories.add>[0]);
    const files = await collectFiles(handle);
    return { directoryId: directoryId as number, name: handle.name, files };
  }

  async getFile(entry: LibraryEntry): Promise<File> {
    const dir = await db.directories.get(entry.directoryId);
    if (!dir?.handle) throw new Error('No directory available');
    await ensurePermission(dir.handle);
    const parts = entry.path.split('/');
    let current: FileSystemDirectoryHandle = dir.handle;
    for (let i = 0; i < parts.length - 1; i++) {
      current = await current.getDirectoryHandle(parts[i]);
    }
    const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
    return fileHandle.getFile();
  }

  async rescan(directoryId?: number): Promise<FolderResult> {
    const dir = directoryId
      ? await db.directories.get(directoryId)
      : await db.directories.toCollection().first();
    if (!dir?.handle) throw new Error('No directory to rescan');
    await ensurePermission(dir.handle);
    const files = await collectFiles(dir.handle);
    return { directoryId: dir.id, name: dir.name, files };
  }
}

// --- webkitdirectory provider (Firefox, Safari) ---

function fileKey(name: string, size: number, lastModified: number): string {
  return `${name}|${size}|${lastModified}`;
}

function triggerWebkitDirectoryPicker(): Promise<File[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.setAttribute('webkitdirectory', '');
    input.multiple = true;

    input.addEventListener('change', () => {
      const files = input.files;
      if (!files || files.length === 0) {
        reject(new DOMException('No files selected', 'AbortError'));
        return;
      }
      resolve(Array.from(files));
    });

    input.addEventListener('cancel', () => {
      reject(new DOMException('User cancelled', 'AbortError'));
    });

    input.click();
  });
}

class WebkitDirectoryProvider implements FolderProvider {
  readonly requiresPermissionGrant = false;
  private fileMap = new Map<string, File>();

  async pickFolder(): Promise<FolderResult> {
    const rawFiles = await triggerWebkitDirectoryPicker();
    return await this.processFiles(rawFiles);
  }

  async getFile(entry: LibraryEntry): Promise<File> {
    const key = fileKey(entry.name, entry.size, entry.lastModified);
    const file = this.fileMap.get(key);
    if (!file) {
      throw new Error('File not available. Please select the folder again.');
    }
    return file;
  }

  async rescan(): Promise<FolderResult> {
    const rawFiles = await triggerWebkitDirectoryPicker();
    return await this.processFiles(rawFiles);
  }

  private async processFiles(rawFiles: File[]): Promise<FolderResult> {
    this.fileMap.clear();
    const files: ScannedFile[] = [];
    let folderName = '';

    for (const file of rawFiles) {
      const relPath = (file as File & { webkitRelativePath: string }).webkitRelativePath;
      if (!relPath) continue;

      if (!folderName) {
        folderName = relPath.split('/')[0];
      }

      // Strip the root folder name to get the relative path
      const path = relPath.split('/').slice(1).join('/');
      if (!isVideoFile(file.name)) continue;

      files.push({
        name: file.name,
        path,
        size: file.size,
        lastModified: file.lastModified,
      });
      this.fileMap.set(fileKey(file.name, file.size, file.lastModified), file);
    }

    // Store directory entry (no handle)
    await db.directories.clear();
    const directoryId = await db.directories.add({
      name: folderName,
      addedAt: Date.now(),
      lastScannedAt: Date.now(),
    } as Parameters<typeof db.directories.add>[0]);

    return { directoryId: directoryId as number, name: folderName || 'Unknown', files };
  }
}

// --- Detection + singleton ---

function detectProvider(): FolderProvider {
  if ('showDirectoryPicker' in window) {
    return new FsAccessProvider();
  }
  return new WebkitDirectoryProvider();
}

export const folderProvider: FolderProvider = detectProvider();
