import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { isExtension } from '../context.js';
import { rescanAllFolders, rescanFolder } from '../scan.js';

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
  showManualButton: boolean;
  statusMessage: string | null;
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
  const autoAttemptRef = useRef<string | null>(null);
  const multiFolder = isExtension();
  const buttonLabel = multiFolder ? 'Rescan All' : 'Rescan';
  const directoriesReady = directories !== undefined;
  const hasDirectories = (directories?.length ?? 0) > 0;
  const canAutoRescan = hasDirectories && directories!.every((directory) => directory.handle != null);
  const autoAttemptKey = canAutoRescan
    ? `${autoKey}:${directories!.map((directory) => directory.id).join(',')}`
    : null;

  const runRescan = async (nextMode: Exclude<RescanMode, 'idle'>) => {
    setMode(nextMode);
    setError(null);

    try {
      if (multiFolder) {
        await rescanAllFolders();
      } else {
        await rescanFolder();
      }
    } catch (err) {
      console.error('Failed to rescan:', err);
      setError(err instanceof Error ? err.message : 'Failed to rescan files.');
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
  const willAutoRescan =
    autoOnMount && autoAttemptKey != null && autoAttemptRef.current !== autoAttemptKey;
  const showManualButton = hasDirectories && (!autoOnMount || !canAutoRescan || error != null);
  const statusMessage = error
    ? error
    : isAutoRescanning
      ? 'Checking for new files...'
      : mode === 'manual'
        ? 'Rescanning files...'
        : null;

  return {
    buttonLabel,
    canAutoRescan,
    directoriesReady,
    error,
    hasDirectories,
    isAutoRescanning,
    isRescanning,
    showManualButton,
    statusMessage,
    willAutoRescan,
    rescan: () => runRescan('manual'),
  };
}
