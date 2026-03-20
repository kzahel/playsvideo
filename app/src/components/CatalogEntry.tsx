import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { SeriesMetadataEntry } from '../db';
import type { CatalogPlaybackView } from '../local-playback-views.js';

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatTime(sec: number): string {
  if (sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const BADGE_LABEL: Record<string, string> = {
  unwatched: 'New',
  watched: 'Watched',
};

interface Props {
  entry: CatalogPlaybackView;
  seriesMetadata?: SeriesMetadataEntry;
  showMetadataDebug?: boolean;
}

function formatEpisodeLabel(entry: CatalogPlaybackView): string | null {
  if (entry.detectedMediaType !== 'tv' || entry.seasonNumber == null || entry.episodeNumber == null) {
    return null;
  }

  const ending = entry.endingEpisodeNumber != null ? `-E${String(entry.endingEpisodeNumber).padStart(2, '0')}` : '';
  return `S${String(entry.seasonNumber).padStart(2, '0')}E${String(entry.episodeNumber).padStart(2, '0')}${ending}`;
}

function buildInitials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function formatMatchStatus(seriesMetadata?: SeriesMetadataEntry): string {
  if (!seriesMetadata) return 'no metadata record';
  if (seriesMetadata.status === 'resolved') return 'resolved';
  if (seriesMetadata.status === 'not-found') return 'not found';
  return 'error';
}

function DebugModal({
  entry,
  seriesMetadata,
  onClose,
}: {
  entry: CatalogPlaybackView;
  seriesMetadata?: SeriesMetadataEntry;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const onClickBackdrop = (e: MouseEvent) => {
      if (e.target === dialog) onClose();
    };
    dialog.addEventListener('click', onClickBackdrop);
    return () => dialog.removeEventListener('click', onClickBackdrop);
  }, [onClose]);

  return (
    <dialog ref={dialogRef} className="debug-modal" onClose={onClose}>
      <div className="debug-modal-content">
        <div className="debug-modal-header">
          <h3>Metadata Debug</h3>
          <button type="button" className="debug-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>
        <div className="debug-modal-body">
          <div><strong>File:</strong> {entry.name}</div>
          <div><strong>Path:</strong> {entry.path}</div>
          <div><strong>Type:</strong> {entry.detectedMediaType}</div>
          <div><strong>Parsed title:</strong> {entry.parsedTitle ?? '(none)'}</div>
          <div>
            <strong>Episode:</strong>{' '}
            {entry.seasonNumber != null && entry.episodeNumber != null
              ? `S${entry.seasonNumber}E${entry.episodeNumber}`
              : '(none)'}
          </div>
          <div><strong>Metadata key:</strong> {entry.seriesMetadataKey ?? '(none)'}</div>
          <div><strong>Match status:</strong> {formatMatchStatus(seriesMetadata)}</div>
          {seriesMetadata?.query ? <div><strong>Query:</strong> {seriesMetadata.query}</div> : null}
          {seriesMetadata?.debugSelectedScore != null ? (
            <div><strong>Score:</strong> {seriesMetadata.debugSelectedScore}</div>
          ) : null}
          {seriesMetadata?.debugReason ? (
            <div><strong>Reason:</strong> {seriesMetadata.debugReason}</div>
          ) : null}
          {seriesMetadata?.debugError ? (
            <div><strong>Error:</strong> {seriesMetadata.debugError}</div>
          ) : null}
          {seriesMetadata?.debugSearchCandidates?.length ? (
            <div>
              <strong>Candidates:</strong>{' '}
              {seriesMetadata.debugSearchCandidates
                .map((candidate) => {
                  const year = candidate.firstAirDate?.slice(0, 4);
                  return `${candidate.name}${year ? ` (${year})` : ''} [${candidate.score}]`;
                })
                .join(' | ')}
            </div>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}

export function CatalogEntryCard({ entry, seriesMetadata, showMetadataDebug = false }: Props) {
  const [debugOpen, setDebugOpen] = useState(false);
  const isInProgress =
    entry.watchState === 'in-progress' && entry.durationSec > 0;
  const progressPct = isInProgress
    ? (entry.playbackPositionSec / entry.durationSec) * 100
    : 0;
  const displayTitle = seriesMetadata?.name ?? entry.parsedTitle ?? entry.name;
  const episodeLabel = formatEpisodeLabel(entry);
  const posterUrl = seriesMetadata?.posterUrl ?? seriesMetadata?.backdropUrl;
  const artLabel = seriesMetadata?.name ?? entry.parsedTitle ?? entry.name;
  const showFilename = displayTitle !== entry.name;

  const isVirtual = entry.hasLocalFile === false;

  return (
    <>
      <Link
        to={`/play/${entry.id}`}
        state={{ entry }}
        className={`catalog-entry${isVirtual ? ' catalog-entry-virtual' : ''}`}
      >
        <div className="catalog-entry-thumb">
          {posterUrl ? (
            <img src={posterUrl} alt={artLabel} loading="lazy" />
          ) : (
            <div className="catalog-entry-thumb-fallback">{buildInitials(artLabel)}</div>
          )}
        </div>
        <div className="catalog-entry-info">
          <div className="catalog-entry-title">
            {episodeLabel ? <span className="catalog-entry-episode">{episodeLabel}</span> : null}
            {displayTitle}
          </div>
          <div className="catalog-entry-meta">
            {isVirtual
              ? (entry.torrentComplete ? 'Available via torrent' : 'Not downloaded')
              : <>
                  {showFilename ? <>{entry.name}{' \u00b7 '}</> : null}
                  {formatSize(entry.size)}
                  {entry.durationSec > 0 ? ` \u00b7 ${formatTime(entry.durationSec)}` : ''}
                  {isInProgress ? ` \u00b7 ${formatTime(entry.playbackPositionSec)}` : ''}
                </>
            }
          </div>
        </div>
        {!isInProgress && entry.watchState !== 'unwatched' ? (
          <span className={`watch-badge ${entry.watchState}`}>
            {BADGE_LABEL[entry.watchState]}
          </span>
        ) : null}
        {isInProgress ? (
          <div className="catalog-entry-progress">
            <div className="catalog-entry-progress-bar">
              <div className="catalog-entry-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        ) : null}
        {showMetadataDebug ? (
          <button
            type="button"
            className="catalog-entry-debug-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDebugOpen(true);
            }}
            title="Show metadata debug info"
          >
            i
          </button>
        ) : null}
      </Link>
      {debugOpen ? (
        <DebugModal
          entry={entry}
          seriesMetadata={seriesMetadata}
          onClose={() => setDebugOpen(false)}
        />
      ) : null}
    </>
  );
}
