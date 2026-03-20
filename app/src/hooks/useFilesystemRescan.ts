import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { isExtension } from '../context.js';
import { folderProvider, type FolderRescanAccessState } from '../folder-provider.js';
import { rescanAllFolders, rescanFolder, type ScanResult } from '../scan.js';

type RescanMode = 'idle' | 'auto' | 'manual';

interface UseFilesystemRescanOptions {
  autoOnMount?: boolean;
  autoKey?: string;
}

export interface FilesystemRescanState {
  buttonLabel: string;
  canAutoRescan: boolean;
  directoriesReady: boolean;
  error: string | null;
  hasDirectories: boolean;
  isAutoRescanning: boolean;
  isRescanning: boolean;
  needsUserGesture: boolean;
  showManualButton: boolean;
  statusMessage: string | null;
  toast: string | null;
  willAutoRescan: boolean;
  rescan(): Promise<void>;
}

export function useFilesystemRescan(
  options: UseFilesystemRescanOptions = {},
): FilesystemRescanState {
  const { autoOnMount = false, autoKey = 'default' } = options;
  const directories = useLiveQuery(() => db.directories.toArray());
  const [mode, setMode] = useState<RescanMode>('idle');
  const [error, setError] = useState<string | null>(null);
  const [accessState, setAccessState] = useState<FolderRescanAccessState>('unavailable');
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoAttemptRef = useRef<string | null>(null);
  const multiFolder = isExtension();
  const directoriesReady = directories !== undefined;
  const hasDirectories = (directories?.length ?? 0) > 0;
  const canAutoRescan = hasDirectories && accessState === 'ready';
  const autoAttemptKey = canAutoRescan
    ? `${autoKey}:${directories!.map((directory) => directory.id).join(',')}`
    : null;

  useEffect(() => {
    if (!directoriesReady) {
      return;
    }

    if (!hasDirectories) {
      setAccessState('unavailable');
      return;
    }

    let cancelled = false;
    void folderProvider
      .getRescanAccessState()
      .then((nextState) => {
        if (!cancelled) {
          setAccessState(nextState);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAccessState('needs-user-gesture');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [directoriesReady, hasDirectories, directories?.map((directory) => directory.id).join(',')]);

  const showToast = (message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  };

  const runRescan = async (nextMode: Exclude<RescanMode, 'idle'>) => {
    setMode(nextMode);
    setError(null);
    setToast(null);

    try {
      const shouldRequestPermission =
        nextMode === 'manual' && accessState === 'needs-user-gesture';
      const startTime = performance.now();
      let result: ScanResult;
      if (multiFolder) {
        result = await rescanAllFolders({ requestPermission: shouldRequestPermission });
      } else {
        result = await rescanFolder(undefined, { requestPermission: shouldRequestPermission });
      }
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      setAccessState('ready');
      showToast(`Scanned ${result.fileCount} file${result.fileCount === 1 ? '' : 's'} in ${elapsed}s`);
    } catch (err) {
      console.error('Failed to rescan:', err);
      const message = err instanceof Error ? err.message : 'Failed to rescan files.';
      if (message.includes('User activation is required')) {
        setAccessState('needs-user-gesture');
        setError(
          folderProvider.requiresPermissionGrant
            ? 'Grant file access to refresh files.'
            : 'Select the folder again to refresh files.',
        );
      } else if (folderProvider.requiresPermissionGrant && message.includes('Permission')) {
        setAccessState('needs-user-gesture');
        setError('Grant file access to refresh files.');
      } else {
        setError(message);
      }
    } finally {
      setMode('idle');
    }
  };

  useEffect(() => {
    if (!autoOnMount || autoAttemptKey == null) return;
    if (autoAttemptRef.current === autoAttemptKey) return;
    autoAttemptRef.current = autoAttemptKey;
    void runRescan('auto');
  }, [autoAttemptKey, autoOnMount]);

  const isAutoRescanning = mode === 'auto';
  const isRescanning = mode !== 'idle';
  const needsUserGesture = hasDirectories && accessState === 'needs-user-gesture';
  const willAutoRescan =
    autoOnMount && autoAttemptKey != null && autoAttemptRef.current !== autoAttemptKey;
  const showManualButton = hasDirectories && (!autoOnMount || !canAutoRescan || error != null);
  const statusMessage = error
    ? error
    : needsUserGesture
      ? folderProvider.requiresPermissionGrant
        ? 'Grant file access to refresh files.'
        : 'Select the folder again to refresh files.'
    : isAutoRescanning
      ? 'Checking for new files...'
      : mode === 'manual'
        ? 'Rescanning files...'
        : null;
  const buttonLabel = needsUserGesture
    ? folderProvider.requiresPermissionGrant
      ? 'Grant File Access'
      : multiFolder
        ? 'Re-select Folders'
        : 'Re-select Folder'
    : multiFolder
      ? 'Rescan All'
      : 'Rescan';

  return {
    buttonLabel,
    canAutoRescan,
    directoriesReady,
    error,
    hasDirectories,
    isAutoRescanning,
    isRescanning,
    needsUserGesture,
    showManualButton,
    statusMessage,
    toast,
    willAutoRescan,
    rescan: () => runRescan('manual'),
  };
}
