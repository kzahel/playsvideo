declare global {
  interface Window {
    showDirectoryPicker(options?: {
      mode?: 'read' | 'readwrite';
    }): Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemHandle>;
    getDirectoryHandle(name: string): Promise<FileSystemDirectoryHandle>;
    getFileHandle(name: string): Promise<FileSystemFileHandle>;
    queryPermission(descriptor?: {
      mode?: 'read' | 'readwrite';
    }): Promise<PermissionState>;
    requestPermission(descriptor?: {
      mode?: 'read' | 'readwrite';
    }): Promise<PermissionState>;
  }

  interface FileSystemFileHandle {
    getFile(): Promise<File>;
  }

  interface FileSystemHandle {
    kind: 'file' | 'directory';
    name: string;
  }
}

export {};
