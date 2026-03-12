import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { LibraryEntryCard } from '../components/LibraryEntry.js';
import { FolderPicker } from '../components/FolderPicker.js';
import { useSetting } from '../hooks/useSetting.js';
import { useFilesystemRescan } from '../hooks/useFilesystemRescan.js';
import { removeFolder } from '../scan.js';
import { folderProvider } from '../folder-provider.js';
import { isExtension } from '../context.js';
import { SHOW_METADATA_DEBUG_KEY } from '../metadata/settings.js';

export function Library() {
  const entries = useLiveQuery(() => db.library.orderBy('name').toArray());
  const directories = useLiveQuery(() => db.directories.toArray());
  const seriesMetadata = useLiveQuery(() => db.seriesMetadata.toArray());
  const [showMetadataDebug] = useSetting<boolean>(SHOW_METADATA_DEBUG_KEY, false);
  const filesystemRescan = useFilesystemRescan();

  const handleRemoveFolder = async (directoryId: number) => {
    try {
      await removeFolder(directoryId);
    } catch (err) {
      console.error('Failed to remove folder:', err);
    }
  };

  if (entries === undefined || directories === undefined || seriesMetadata === undefined) {
    return <div className="empty-state">Loading...</div>;
  }

  const hasDirectories = directories.length > 0;
  const multiFolder = isExtension();
  const stale = hasDirectories && entries.length > 0 && !folderProvider.hasLiveAccess();
  const metadataByKey = new Map(seriesMetadata.map((entry) => [entry.key, entry]));
  const hasTmdbMetadata = seriesMetadata.some((entry) => entry.status === 'resolved');

  return (
    <div>
      <div className="library-header">
        <FolderPicker />
        {filesystemRescan.showManualButton && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void filesystemRescan.rescan()}
            disabled={filesystemRescan.isRescanning}
          >
            {filesystemRescan.isRescanning ? 'Rescanning...' : filesystemRescan.buttonLabel}
          </button>
        )}
      </div>
      {filesystemRescan.statusMessage ? (
        <div className="page-toolbar-status" aria-live="polite">
          {filesystemRescan.statusMessage}
        </div>
      ) : null}
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
            <LibraryEntryCard
              key={entry.id}
              entry={entry}
              seriesMetadata={entry.seriesMetadataKey ? metadataByKey.get(entry.seriesMetadataKey) : undefined}
              showMetadataDebug={showMetadataDebug}
            />
          ))}
        </div>
      )}

      {hasTmdbMetadata && (
        <p className="tmdb-attribution">
          Metadata and artwork use{' '}
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
            TMDB
          </a>
          . This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      )}
    </div>
  );
}
