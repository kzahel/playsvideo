import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { useFilesystemRescan } from '../hooks/useFilesystemRescan.js';
import { groupMovies } from '../library-groups.js';

export function Movie() {
  const { movieId } = useParams<{ movieId: string }>();
  const decodedId = decodeURIComponent(movieId ?? '');
  const entries = useLiveQuery(() => db.library.toArray());
  const filesystemRescan = useFilesystemRescan({ autoOnMount: true, autoKey: decodedId });

  if (entries === undefined || !filesystemRescan.directoriesReady) {
    return <div className="empty-state">Loading...</div>;
  }

  const movie = groupMovies(entries).find(
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
      <div className="detail-hero">
        <div className="detail-poster detail-poster-fallback">
          {movie.title
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? '')
            .join('')}
        </div>
        <div className="detail-copy">
          <h1>{movie.title}</h1>
          <div className="detail-meta">
            {movie.year ?? 'Unknown year'} · {movie.entries.length} version
            {movie.entries.length === 1 ? '' : 's'}
          </div>
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
