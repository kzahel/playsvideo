import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { useSetting } from '../hooks/useSetting.js';
import { useFilesystemRescan } from '../hooks/useFilesystemRescan.js';
import { groupMovies } from '../library-groups.js';
import { invalidateMetadata, refreshLibraryMetadata } from '../metadata/client.js';
import { TMDB_REQUESTS_ENABLED_KEY } from '../metadata/settings.js';
import { AUTO_RESCAN_DETAIL_PAGES_KEY } from '../settings.js';

export function Movie() {
  const { movieId } = useParams<{ movieId: string }>();
  const decodedId = decodeURIComponent(movieId ?? '');
  const entries = useLiveQuery(() => db.library.toArray());
  const movieMetadata = useLiveQuery(() => db.movieMetadata.toArray());
  const [autoRescanDetailPages] = useSetting<boolean>(AUTO_RESCAN_DETAIL_PAGES_KEY, true);
  const filesystemRescan = useFilesystemRescan({
    autoOnMount: autoRescanDetailPages,
    autoKey: decodedId,
  });
  const [tmdbRequestsEnabled] = useSetting<boolean>(TMDB_REQUESTS_ENABLED_KEY, true);
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [metadataStatusMessage, setMetadataStatusMessage] = useState<string | null>(null);

  if (entries === undefined || movieMetadata === undefined || !filesystemRescan.directoriesReady) {
    return <div className="empty-state">Loading...</div>;
  }

  const movieMetadataByKey = new Map(movieMetadata.map((entry) => [entry.key, entry]));
  const movie = groupMovies(entries, movieMetadataByKey).find(
    (group) => group.slug === decodedId || group.id === decodedId,
  );

  if (!movie) {
    const waitingForRescan = filesystemRescan.willAutoRescan || filesystemRescan.isAutoRescanning;
    return (
      <div className="detail-page">
        <div className="page-toolbar">
          <Link to="/movies" className="player-back">
            &larr; Back to Movies
          </Link>
          {filesystemRescan.showManualButton ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void filesystemRescan.rescan()}
              disabled={filesystemRescan.isRescanning}
            >
              {filesystemRescan.isRescanning ? 'Rescanning...' : filesystemRescan.buttonLabel}
            </button>
          ) : null}
        </div>
        {filesystemRescan.statusMessage ? (
          <div className="page-toolbar-status" aria-live="polite">
            {filesystemRescan.statusMessage}
          </div>
        ) : null}
        <p>{waitingForRescan ? 'Refreshing files...' : 'Movie not found.'}</p>
      </div>
    );
  }

  const metadataKeys = [
    ...new Set(
      movie.entries
        .map((entry) => entry.movieMetadataKey)
        .filter((key): key is string => typeof key === 'string' && key.length > 0),
    ),
  ];

  const handleRefreshMetadata = async () => {
    setIsRefreshingMetadata(true);
    setMetadataStatusMessage(null);
    try {
      if (metadataKeys.length > 0) {
        await invalidateMetadata(metadataKeys);
      }
      await refreshLibraryMetadata({ entries: movie.entries, force: true });
      setMetadataStatusMessage('Metadata refreshed.');
    } catch (error) {
      setMetadataStatusMessage(error instanceof Error ? error.message : 'Metadata refresh failed.');
    } finally {
      setIsRefreshingMetadata(false);
    }
  };

  return (
    <div className="detail-page">
      <div className="page-toolbar">
        <Link to="/movies" className="player-back">
          &larr; Back to Movies
        </Link>
        <div className="page-toolbar-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleRefreshMetadata()}
            disabled={isRefreshingMetadata || !tmdbRequestsEnabled}
          >
            {isRefreshingMetadata ? 'Refreshing Metadata...' : 'Refresh Metadata'}
          </button>
          {filesystemRescan.showManualButton ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void filesystemRescan.rescan()}
              disabled={filesystemRescan.isRescanning}
            >
              {filesystemRescan.isRescanning ? 'Rescanning...' : filesystemRescan.buttonLabel}
            </button>
          ) : null}
        </div>
      </div>
      {filesystemRescan.statusMessage ? (
        <div className="page-toolbar-status" aria-live="polite">
          {filesystemRescan.statusMessage}
        </div>
      ) : null}
      {metadataStatusMessage ? (
        <div className="page-toolbar-status" aria-live="polite">
          {metadataStatusMessage}
        </div>
      ) : null}
      {!tmdbRequestsEnabled ? (
        <div className="page-toolbar-status" aria-live="polite">
          Metadata requests are disabled in Settings.
        </div>
      ) : null}
      <div className="detail-hero">
        {movie.movieMetadata?.posterUrl ? (
          <img
            className="detail-poster"
            src={movie.movieMetadata.posterUrl}
            alt={movie.title}
            loading="lazy"
          />
        ) : (
          <div className="detail-poster detail-poster-fallback">
            {movie.title
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase() ?? '')
              .join('')}
          </div>
        )}
        <div className="detail-copy">
          <h1>{movie.title}</h1>
          <div className="detail-meta">
            {movie.movieMetadata?.releaseDate?.slice(0, 4) ?? movie.year ?? 'Unknown year'} ·{' '}
            {movie.entries.length} version
            {movie.entries.length === 1 ? '' : 's'}
          </div>
          {movie.movieMetadata?.overview ? (
            <p className="detail-overview">{movie.movieMetadata.overview}</p>
          ) : null}
        </div>
      </div>

      <section className="season-section">
        <h2>Files</h2>
        <div className="episode-list">
          {movie.entries.map((entry) => (
            <Link key={entry.id} to={`/play/${entry.id}`} className="episode-row">
              <span className="episode-code">Play</span>
              <span className="episode-name">{entry.name}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
