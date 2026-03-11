import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { LibraryEntryCard } from '../components/LibraryEntry.js';
import { FolderPicker } from '../components/FolderPicker.js';
import { rescanFolder, rescanAllFolders, removeFolder } from '../scan.js';
import { folderProvider } from '../folder-provider.js';
import { isExtension } from '../context.js';

export function Library() {
  const entries = useLiveQuery(() => db.library.orderBy('name').toArray());
  const directories = useLiveQuery(() => db.directories.toArray());

  const handleRescan = async () => {
    try {
      await rescanFolder();
    } catch (err) {
      console.error('Failed to rescan:', err);
    }
  };

  const handleRescanAll = async () => {
    try {
      await rescanAllFolders();
    } catch (err) {
      console.error('Failed to rescan:', err);
    }
  };

  const handleRemoveFolder = async (directoryId: number) => {
    try {
      await removeFolder(directoryId);
    } catch (err) {
      console.error('Failed to remove folder:', err);
    }
  };

  if (entries === undefined || directories === undefined) {
    return <div className="empty-state">Loading...</div>;
  }

  const hasDirectories = directories.length > 0;
  const multiFolder = isExtension();
  const stale = hasDirectories && entries.length > 0 && !folderProvider.hasLiveAccess();

  return (
    <div>
      <div className="library-header">
        <FolderPicker />
        {hasDirectories && !multiFolder && (
          <button type="button" className="btn btn-secondary" onClick={handleRescan}>
            Rescan
          </button>
        )}
        {hasDirectories && multiFolder && (
          <button type="button" className="btn btn-secondary" onClick={handleRescanAll}>
            Rescan All
          </button>
        )}
      </div>

      {stale && (
        <div className="stale-banner">
          Select folder again to enable playback. Files shown from last scan.
        </div>
      )}

      {multiFolder && hasDirectories && (
        <div className="directory-chips">
          {directories.map((dir) => (
            <span key={dir.id} className="directory-chip">
              {dir.name}
              <button
                type="button"
                className="directory-chip-remove"
                onClick={() => handleRemoveFolder(dir.id)}
                aria-label={`Remove ${dir.name}`}
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {!hasDirectories && (
        <div className="empty-state">
          <p>No folder selected.</p>
          <p style={{ marginTop: '0.5rem' }}>
            Click "{multiFolder ? 'Add Folder' : 'Select Folder'}" to scan a directory for video
            files.
          </p>
        </div>
      )}

      {hasDirectories && entries.length === 0 && (
        <div className="empty-state">No video files found.</div>
      )}

      {entries.length > 0 && (
        <div className="library-grid">
          {entries.map((entry) => (
            <LibraryEntryCard key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
