import { Link } from 'react-router-dom';
import type { LibraryEntry } from '../db';

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
  'in-progress': 'In Progress',
  watched: 'Watched',
};

interface Props {
  entry: LibraryEntry;
}

export function LibraryEntryCard({ entry }: Props) {
  const progress =
    entry.watchState === 'in-progress' && entry.durationSec > 0
      ? ` (${formatTime(entry.playbackPositionSec)} / ${formatTime(entry.durationSec)})`
      : '';

  return (
    <Link to={`/play/${entry.id}`} className="library-entry">
      <div className="name">{entry.name}</div>
      <div className="meta">
        {formatSize(entry.size)}
        {entry.durationSec > 0 ? ` \u00b7 ${formatTime(entry.durationSec)}` : ''}
      </div>
      <span className={`watch-badge ${entry.watchState}`}>
        {BADGE_LABEL[entry.watchState]}
        {progress}
      </span>
    </Link>
  );
}
