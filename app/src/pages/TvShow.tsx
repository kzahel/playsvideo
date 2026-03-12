import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type LibraryEntry } from '../db.js';
import { useFilesystemRescan } from '../hooks/useFilesystemRescan.js';
import { groupTvShows } from '../library-groups.js';

function seasonLabel(seasonNumber?: number): string {
  if (seasonNumber == null) return 'Other Files';
  if (seasonNumber === 0) return 'Specials';
  return `Season ${seasonNumber}`;
}

function episodeLabel(entry: LibraryEntry): string {
  if (entry.seasonNumber == null || entry.episodeNumber == null) {
    return entry.name;
  }
  return `S${String(entry.seasonNumber).padStart(2, '0')}E${String(entry.episodeNumber).padStart(2, '0')}`;
}

function formatTime(sec: number): string {
  if (sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function watchLabel(entry: LibraryEntry): string {
  if (entry.watchState === 'watched') return 'Watched';
  if (entry.watchState === 'in-progress') return 'In Progress';
  return 'New';
}

export function TvShow() {
  const { showId } = useParams<{ showId: string }>();
  const decodedId = decodeURIComponent(showId ?? '');
  const entries = useLiveQuery(() => db.library.toArray());
  const seriesMetadata = useLiveQuery(() => db.seriesMetadata.toArray());
  const filesystemRescan = useFilesystemRescan({ autoOnMount: true, autoKey: decodedId });

  if (entries === undefined || seriesMetadata === undefined || !filesystemRescan.directoriesReady) {
    return <div className="empty-state">Loading...</div>;
  }

  const metadataByKey = new Map(seriesMetadata.map((entry) => [entry.key, entry]));
  const show = groupTvShows(entries, metadataByKey).find(
    (group) => group.slug === decodedId || group.id === decodedId,
  );

  if (!show) {
    const waitingForRescan = filesystemRescan.willAutoRescan || filesystemRescan.isAutoRescanning;
    return (
      <div className="detail-page">
        <div className="page-toolbar">
          <Link to="/shows" className="player-back">
            &larr; Back to Shows
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
        <p>{waitingForRescan ? 'Refreshing files...' : 'Show not found.'}</p>
      </div>
    );
  }

  const seasons = new Map<number | 'other', LibraryEntry[]>();
  for (const entry of show.entries) {
    const key = entry.seasonNumber ?? 'other';
    const bucket = seasons.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      seasons.set(key, [entry]);
    }
  }

  const orderedSeasons = [...seasons.entries()].sort(([left], [right]) => {
    if (left === 'other' && right === 'other') return 0;
    if (left === 'other') return 1;
    if (right === 'other') return -1;
    return left - right;
  });

  return (
    <div className="detail-page">
      <div className="page-toolbar">
        <Link to="/shows" className="player-back">
          &larr; Back to Shows
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
        {show.seriesMetadata?.posterUrl ? (
          <img
            className="detail-poster"
            src={show.seriesMetadata.posterUrl}
            alt={show.title}
            loading="lazy"
          />
        ) : null}
        <div className="detail-copy">
          <h1>{show.title}</h1>
          <div className="detail-meta">
            {show.year ?? 'Unknown year'} · {show.entries.length} episode
            {show.entries.length === 1 ? '' : 's'}
          </div>
          {show.seriesMetadata?.overview ? (
            <p className="detail-overview">{show.seriesMetadata.overview}</p>
          ) : null}
        </div>
      </div>

      <div className="season-list">
        {orderedSeasons.map(([seasonNumber, seasonEntries]) => (
          <section key={String(seasonNumber)} className="season-section">
            <h2>{seasonLabel(seasonNumber === 'other' ? undefined : seasonNumber)}</h2>
            <div className="episode-list">
              {seasonEntries.map((entry) => (
                <Link key={entry.id} to={`/play/${entry.id}`} className="episode-row">
                  <span className="episode-code">{episodeLabel(entry)}</span>
                  <span className="episode-body">
                    <span className="episode-name">{entry.name}</span>
                    {entry.watchState === 'in-progress' && entry.durationSec > 0 ? (
                      <span className="episode-progress-block">
                        <span className="episode-progress-bar">
                          <span
                            className="episode-progress-fill"
                            style={{
                              width: `${Math.min(
                                100,
                                (entry.playbackPositionSec / entry.durationSec) * 100,
                              )}%`,
                            }}
                          />
                        </span>
                        <span className="episode-progress-time">
                          {formatTime(entry.playbackPositionSec)} / {formatTime(entry.durationSec)}
                        </span>
                      </span>
                    ) : (
                      <span className={`episode-watch-badge ${entry.watchState}`}>
                        {watchLabel(entry)}
                      </span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
