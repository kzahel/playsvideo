import { Link } from 'react-router-dom';
import type { LibraryEntry, SeriesMetadataEntry } from '../db';

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
  entry: LibraryEntry;
  seriesMetadata?: SeriesMetadataEntry;
  showMetadataDebug?: boolean;
}

function formatEpisodeLabel(entry: LibraryEntry): string | null {
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

export function LibraryEntryCard({ entry, seriesMetadata, showMetadataDebug = false }: Props) {
  const isInProgress =
    entry.watchState === 'in-progress' && entry.durationSec > 0;
  const progressPct = isInProgress
    ? (entry.playbackPositionSec / entry.durationSec) * 100
    : 0;
  const displayTitle = seriesMetadata?.name ?? entry.parsedTitle ?? entry.name;
  const episodeLabel = formatEpisodeLabel(entry);
  const posterUrl = seriesMetadata?.posterUrl ?? seriesMetadata?.backdropUrl;
  const artLabel = seriesMetadata?.name ?? entry.parsedTitle ?? entry.name;

  const isVirtual = entry.hasLocalFile === false;

  return (
    <Link to={`/play/${entry.id}`} className={`library-entry${isVirtual ? ' library-entry-virtual' : ''}`}>
      <div className="library-entry-thumb">
        {posterUrl ? (
          <img src={posterUrl} alt={artLabel} loading="lazy" />
        ) : (
          <div className="library-entry-thumb-fallback">{buildInitials(artLabel)}</div>
        )}
      </div>
      <div className="library-entry-info">
        <div className="library-entry-title">
          {episodeLabel ? <span className="library-entry-episode">{episodeLabel}</span> : null}
          {displayTitle}
        </div>
        <div className="library-entry-meta">
          {isVirtual
            ? (entry.torrentComplete ? 'Available via torrent' : 'Not downloaded')
            : <>
                {formatSize(entry.size)}
                {entry.durationSec > 0 ? ` \u00b7 ${formatTime(entry.durationSec)}` : ''}
                {isInProgress ? ` \u00b7 ${formatTime(entry.playbackPositionSec)}` : ''}
              </>
          }
        </div>
      </div>
      {!isInProgress && entry.watchState !== 'none' ? (
        <span className={`watch-badge ${entry.watchState}`}>
          {BADGE_LABEL[entry.watchState]}
        </span>
      ) : null}
      {isInProgress ? (
        <div className="library-entry-progress">
          <div className="library-entry-progress-bar">
            <div className="library-entry-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      ) : null}
      {showMetadataDebug ? (
        <div className="library-entry-debug">
          <div>type: {entry.detectedMediaType}</div>
          <div>parsed: {entry.parsedTitle ?? '(none)'}</div>
          <div>
            episode:{' '}
            {entry.seasonNumber != null && entry.episodeNumber != null
              ? `S${entry.seasonNumber}E${entry.episodeNumber}`
              : '(none)'}
          </div>
          <div>metadata key: {entry.seriesMetadataKey ?? '(none)'}</div>
          <div>match status: {formatMatchStatus(seriesMetadata)}</div>
          {seriesMetadata?.query ? <div>query: {seriesMetadata.query}</div> : null}
          {seriesMetadata?.debugSelectedScore != null ? (
            <div>selected score: {seriesMetadata.debugSelectedScore}</div>
          ) : null}
          {seriesMetadata?.debugReason ? <div>reason: {seriesMetadata.debugReason}</div> : null}
          {seriesMetadata?.debugError ? <div>error: {seriesMetadata.debugError}</div> : null}
          {seriesMetadata?.debugSearchCandidates?.length ? (
            <div>
              candidates:{' '}
              {seriesMetadata.debugSearchCandidates
                .map((candidate) => {
                  const year = candidate.firstAirDate?.slice(0, 4);
                  return `${candidate.name}${year ? ` (${year})` : ''} [${candidate.score}]`;
                })
                .join(' | ')}
            </div>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
}
