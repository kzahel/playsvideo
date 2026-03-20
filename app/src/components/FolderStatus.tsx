import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { folderProvider, type FolderRescanAccessState } from '../folder-provider.js';
import { setFolder, rescanFolder } from '../scan.js';

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function FolderStatus() {
  const directories = useLiveQuery(() => db.directories.toArray());
  const catalogCount = useLiveQuery(() => db.catalog.count());
  const [accessState, setAccessState] = useState<FolderRescanAccessState>('unavailable');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [granting, setGranting] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const hasDirectories = (directories?.length ?? 0) > 0;
  const directory = hasDirectories ? directories![0] : null;

  useEffect(() => {
    if (!directories) return;
    if (!hasDirectories) {
      setAccessState('unavailable');
      return;
    }
    let cancelled = false;
    void folderProvider
      .getRescanAccessState()
      .then((state) => {
        if (!cancelled) setAccessState(state);
      })
      .catch(() => {
        if (!cancelled) setAccessState('needs-user-gesture');
      });
    return () => {
      cancelled = true;
    };
  }, [directories, hasDirectories]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  const showToast = (message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => setToast(null), 5000);
  };

  const handleGrant = async () => {
    setGranting(true);
    try {
      const startTime = performance.now();
      const result = await rescanFolder(undefined, { requestPermission: true });
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      setAccessState('ready');
      setDropdownOpen(false);
      showToast(`Scanned ${result.fileCount} file${result.fileCount === 1 ? '' : 's'} in ${elapsed}s`);
    } catch {
      // permission denied or cancelled — stay open
    } finally {
      setGranting(false);
    }
  };

  const handleRescan = async () => {
    setRescanning(true);
    try {
      const startTime = performance.now();
      const result = await rescanFolder(undefined, { requestPermission: accessState === 'needs-user-gesture' });
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1);
      setAccessState('ready');
      setDropdownOpen(false);
      showToast(`Scanned ${result.fileCount} file${result.fileCount === 1 ? '' : 's'} in ${elapsed}s`);
    } catch {
      // failed
    } finally {
      setRescanning(false);
    }
  };

  const handleChooseFolder = async () => {
    try {
      const result = await setFolder();
      setAccessState('ready');
      setDropdownOpen(false);
      showToast(`Scanned ${result.fileCount} file${result.fileCount === 1 ? '' : 's'}`);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      console.error('Failed to select folder:', err);
    }
  };

  if (!hasDirectories) {
    return (
      <button type="button" className="folder-status-btn folder-status-empty" onClick={handleChooseFolder}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        Select Folder
      </button>
    );
  }

  const needsGrant = accessState === 'needs-user-gesture';
  const isReady = accessState === 'ready';

  return (
    <div className="folder-status-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className={`folder-status-btn ${needsGrant ? 'folder-status-needs-grant' : isReady ? 'folder-status-ready' : ''}`}
        onClick={() => setDropdownOpen((o) => !o)}
        title={directory?.name}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span className="folder-status-name">{directory?.name}</span>
        {needsGrant && <span className="folder-status-dot folder-status-dot-warning" />}
        {isReady && <span className="folder-status-dot folder-status-dot-ok" />}
      </button>

      {toast && (
        <div className="scan-toast" aria-live="polite">
          {toast}
        </div>
      )}

      {dropdownOpen && (
        <div className="folder-status-dropdown">
          <div className="folder-status-dropdown-header">{directory?.name}</div>
          <div className="folder-status-dropdown-details">
            <span>{catalogCount ?? 0} files</span>
            {directory?.lastScannedAt ? (
              <span>Scanned {formatTimeAgo(directory.lastScannedAt)}</span>
            ) : null}
            <span className={`folder-status-access-label ${needsGrant ? 'warning' : 'ok'}`}>
              {needsGrant ? 'No access' : 'Access granted'}
            </span>
          </div>
          <div className="folder-status-dropdown-actions">
            {needsGrant && (
              <button type="button" className="btn btn-primary btn-sm" onClick={handleGrant} disabled={granting}>
                {granting ? 'Granting...' : 'Grant File Access'}
              </button>
            )}
            {isReady && (
              <button type="button" className="btn btn-primary btn-sm" onClick={handleRescan} disabled={rescanning}>
                {rescanning ? 'Rescanning...' : 'Rescan'}
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleChooseFolder}>
              Choose New Folder
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
