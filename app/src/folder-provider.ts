import { db, type LibraryEntry } from './db.js';
import { isExtension } from './context.js';
import { isSiblingSubtitleCandidate } from './subtitle-sibling.js';

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

function parentPath(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
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

export interface SiblingSubtitleFile {
  file: File;
  name: string;
  path: string;
}

export type FolderRescanAccessState = 'ready' | 'needs-user-gesture' | 'unavailable';

export interface FileAccessOptions {
  requestPermission?: boolean;
}

export interface FolderRescanOptions {
  requestPermission?: boolean;
}

export class FileAccessPermissionError extends Error {
  constructor(message = 'File access permission needed') {
    super(message);
    this.name = 'FileAccessPermissionError';
  }
}

export function isFileAccessPermissionError(error: unknown): error is FileAccessPermissionError {
  return error instanceof Error && error.name === 'FileAccessPermissionError';
}

export interface FolderProvider {
  readonly requiresPermissionGrant: boolean;
  getRescanAccessState(): Promise<FolderRescanAccessState>;
  hasLiveAccess(): boolean;
  pickFolder(): Promise<FolderResult>;
  getFile(entry: LibraryEntry, options?: FileAccessOptions): Promise<File>;
  listSiblingSubtitleFiles(entry: LibraryEntry): Promise<SiblingSubtitleFile[]>;
  rescan(directoryId?: number, options?: FolderRescanOptions): Promise<FolderResult>;
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

async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  options: FileAccessOptions = {},
): Promise<void> {
  const status = await handle.queryPermission({ mode: 'read' });
  if (status === 'granted') return;

  if (!options.requestPermission) {
    throw new FileAccessPermissionError();
  }

  try {
    const requested = await handle.requestPermission({ mode: 'read' });
    if (requested !== 'granted') {
      throw new FileAccessPermissionError('Permission denied for directory');
    }
  } catch (error) {
    if (error instanceof Error) {
      throw new FileAccessPermissionError(error.message);
    }
    throw error;
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

  async getRescanAccessState(): Promise<FolderRescanAccessState> {
    const directories = await db.directories.toArray();
    if (directories.length === 0) {
      return 'unavailable';
    }

    for (const directory of directories) {
      if (!directory.handle) {
        return 'unavailable';
      }

      const status = await directory.handle.queryPermission({ mode: 'read' });
      if (status !== 'granted') {
        return 'needs-user-gesture';
      }
    }

    return 'ready';
  }

  hasLiveAccess(): boolean {
    return true; // handles persist in IDB across refreshes
  }

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

  async getFile(entry: LibraryEntry, options: FileAccessOptions = {}): Promise<File> {
    const dir = await db.directories.get(entry.directoryId);
    if (!dir?.handle) throw new Error('No directory available');
    await ensurePermission(dir.handle, options);
    const parts = entry.path.split('/');
    let current: FileSystemDirectoryHandle = dir.handle;
    for (let i = 0; i < parts.length - 1; i++) {
      current = await current.getDirectoryHandle(parts[i]);
    }
    const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
    return fileHandle.getFile();
  }

  async listSiblingSubtitleFiles(entry: LibraryEntry): Promise<SiblingSubtitleFile[]> {
    const dir = await db.directories.get(entry.directoryId);
    if (!dir?.handle) {
      return [];
    }

    try {
      await ensurePermission(dir.handle);
    } catch (error) {
      if (isFileAccessPermissionError(error)) {
        return [];
      }
      throw error;
    }
    const parts = entry.path.split('/');
    let current: FileSystemDirectoryHandle = dir.handle;
    for (let index = 0; index < parts.length - 1; index += 1) {
      current = await current.getDirectoryHandle(parts[index]);
    }

    const siblings: SiblingSubtitleFile[] = [];
    const folder = parentPath(entry.path);
    for await (const handle of current.values()) {
      if (handle.kind !== 'file') {
        continue;
      }
      if (!isSiblingSubtitleCandidate(entry.name, handle.name)) {
        continue;
      }

      const file = await (handle as FileSystemFileHandle).getFile();
      siblings.push({
        file,
        name: handle.name,
        path: folder ? `${folder}/${handle.name}` : handle.name,
      });
    }

    siblings.sort((left, right) => left.name.localeCompare(right.name));
    return siblings;
  }

  async rescan(directoryId?: number, options: FolderRescanOptions = {}): Promise<FolderResult> {
    const dir = directoryId
      ? await db.directories.get(directoryId)
      : await db.directories.toCollection().first();
    if (!dir?.handle) throw new Error('No directory to rescan');
    await ensurePermission(dir.handle, options);
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
  private pathFileMap = new Map<string, File>();

  async getRescanAccessState(): Promise<FolderRescanAccessState> {
    const directories = await db.directories.toArray();
    if (directories.length === 0) {
      return 'unavailable';
    }

    return this.hasLiveAccess() ? 'ready' : 'needs-user-gesture';
  }

  hasLiveAccess(): boolean {
    return this.fileMap.size > 0;
  }

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

  async listSiblingSubtitleFiles(entry: LibraryEntry): Promise<SiblingSubtitleFile[]> {
    const folder = parentPath(entry.path);
    const siblings: SiblingSubtitleFile[] = [];
    for (const [path, file] of this.pathFileMap.entries()) {
      if (parentPath(path) !== folder) {
        continue;
      }
      if (!isSiblingSubtitleCandidate(entry.name, file.name)) {
        continue;
      }
      siblings.push({
        file,
        name: file.name,
        path,
      });
    }

    siblings.sort((left, right) => left.name.localeCompare(right.name));
    return siblings;
  }

  async rescan(): Promise<FolderResult> {
    const rawFiles = await triggerWebkitDirectoryPicker();
    return await this.processFiles(rawFiles);
  }

  private async processFiles(rawFiles: File[]): Promise<FolderResult> {
    this.fileMap.clear();
    this.pathFileMap.clear();
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
      this.pathFileMap.set(path, file);
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
