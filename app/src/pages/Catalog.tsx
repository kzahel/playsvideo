import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { CatalogEntryCard } from '../components/CatalogEntry.js';
import { CatalogListView } from '../components/CatalogListView.js';
import { useSetting } from '../hooks/useSetting.js';
import { removeFolder } from '../scan.js';
import { isExtension } from '../context.js';
import { getDeviceId } from '../device.js';
import { applyLocalPlaybackToCatalogEntries } from '../local-playback-views.js';
import { SHOW_METADATA_DEBUG_KEY } from '../metadata/settings.js';
import { CATALOG_VIEW_MODE_KEY, type CatalogViewMode } from '../settings.js';

export function Catalog() {
  const deviceId = useLiveQuery(() => getDeviceId(), []);
  const entries = useLiveQuery(async () => {
    const [catalogEntries, playbackEntries] = await Promise.all([
      db.catalog.orderBy('name').toArray(),
      deviceId
        ? db.playback.where('deviceId').equals(deviceId).toArray()
        : Promise.resolve([]),
    ]);
    return applyLocalPlaybackToCatalogEntries({
      catalogEntries,
      playbackEntries,
    });
  }, [deviceId]);
  const directories = useLiveQuery(() => db.directories.toArray());
  const seriesMetadata = useLiveQuery(() => db.seriesMetadata.toArray());
  const [showMetadataDebug] = useSetting<boolean>(SHOW_METADATA_DEBUG_KEY, false);
  const [viewMode, setViewMode] = useSetting<CatalogViewMode>(CATALOG_VIEW_MODE_KEY, 'card');

  const handleRemoveFolder = async (directoryId: number) => {
    try {
      await removeFolder(directoryId);
    } catch (err) {
      console.error('Failed to remove folder:', err);
    }
  };

  if (entries === undefined || directories === undefined || seriesMetadata === undefined || deviceId === undefined) {
    return <div className="empty-state">Loading...</div>;
  }

  const hasDirectories = directories.length > 0;
  const multiFolder = isExtension();
  const metadataByKey = new Map(seriesMetadata.map((entry) => [entry.key, entry]));
  const hasTmdbMetadata = seriesMetadata.some((entry) => entry.status === 'resolved');

  return (
    <div>
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
        <>
          <div className="catalog-view-toggle">
            <button
              type="button"
              className={`view-toggle-btn${viewMode === 'card' ? ' active' : ''}`}
              onClick={() => setViewMode('card')}
              title="Card view"
              aria-label="Card view"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1" width="6" height="4" rx="1" />
                <rect x="9" y="1" width="6" height="4" rx="1" />
                <rect x="1" y="7" width="6" height="4" rx="1" />
                <rect x="9" y="7" width="6" height="4" rx="1" />
                <rect x="1" y="13" width="6" height="2" rx="1" />
                <rect x="9" y="13" width="6" height="2" rx="1" />
              </svg>
            </button>
            <button
              type="button"
              className={`view-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List view"
              aria-label="List view"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="2" width="14" height="1.5" rx="0.5" />
                <rect x="1" y="5.5" width="14" height="1.5" rx="0.5" />
                <rect x="1" y="9" width="14" height="1.5" rx="0.5" />
                <rect x="1" y="12.5" width="14" height="1.5" rx="0.5" />
              </svg>
            </button>
          </div>

          {viewMode === 'list' ? (
            <CatalogListView entries={entries} metadataByKey={metadataByKey} />
          ) : (
            <div className="catalog-grid">
              {entries.map((entry) => (
                <CatalogEntryCard
                  key={entry.id}
                  entry={entry}
                  seriesMetadata={entry.seriesMetadataKey ? metadataByKey.get(entry.seriesMetadataKey) : undefined}
                  showMetadataDebug={showMetadataDebug}
                />
              ))}
            </div>
          )}
        </>
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
