import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { SeriesMetadataEntry } from '../db.js';
import type { CatalogPlaybackView } from '../local-playback-views.js';

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(sec: number): string {
  if (sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type SortField = 'name' | 'episode' | 'size' | 'duration' | 'status';
type SortDirection = 'asc' | 'desc';

function getDisplayTitle(
  entry: CatalogPlaybackView,
  metadataByKey: Map<string, SeriesMetadataEntry>,
): string {
  const meta = entry.seriesMetadataKey ? metadataByKey.get(entry.seriesMetadataKey) : undefined;
  return meta?.name ?? entry.parsedTitle ?? entry.name;
}

function getEpisodeSort(entry: CatalogPlaybackView): number {
  if (entry.seasonNumber == null || entry.episodeNumber == null) return -1;
  return entry.seasonNumber * 10000 + entry.episodeNumber;
}

function getStatusSort(entry: CatalogPlaybackView): number {
  if (entry.watchState === 'in-progress') return 1;
  if (entry.watchState === 'unwatched') return 0;
  if (entry.watchState === 'watched') return 2;
  return 3;
}

function formatEpisodeLabel(entry: CatalogPlaybackView): string {
  if (entry.seasonNumber == null || entry.episodeNumber == null) return '';
  const ending =
    entry.endingEpisodeNumber != null
      ? `-E${String(entry.endingEpisodeNumber).padStart(2, '0')}`
      : '';
  return `S${String(entry.seasonNumber).padStart(2, '0')}E${String(entry.episodeNumber).padStart(2, '0')}${ending}`;
}

function statusLabel(entry: CatalogPlaybackView): string {
  if (entry.hasLocalFile === false) {
    return entry.torrentComplete ? 'Available' : 'Missing';
  }
  if (entry.watchState === 'unwatched') return 'New';
  if (entry.watchState === 'watched') return 'Watched';
  if (entry.watchState === 'in-progress') {
    const pct = entry.durationSec > 0 ? Math.round((entry.playbackPositionSec / entry.durationSec) * 100) : 0;
    return `${pct}%`;
  }
  return '';
}

interface Props {
  entries: CatalogPlaybackView[];
  metadataByKey: Map<string, SeriesMetadataEntry>;
}

export function CatalogListView({ entries, metadataByKey }: Props) {
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sorted = [...entries].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'name':
        cmp = getDisplayTitle(a, metadataByKey).localeCompare(getDisplayTitle(b, metadataByKey));
        break;
      case 'episode':
        cmp = getEpisodeSort(a) - getEpisodeSort(b);
        break;
      case 'size':
        cmp = a.size - b.size;
        break;
      case 'duration':
        cmp = a.durationSec - b.durationSec;
        break;
      case 'status':
        cmp = getStatusSort(a) - getStatusSort(b);
        break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const sortIndicator = (field: SortField) => {
    if (field !== sortField) return null;
    return <span className="catalog-list-sort-arrow">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>;
  };

  const hasEpisodes = entries.some((e) => e.seasonNumber != null);

  return (
    <div className="catalog-list">
      <div className="catalog-list-header">
        <button type="button" className="catalog-list-col col-name" onClick={() => handleSort('name')}>
          Name {sortIndicator('name')}
        </button>
        {hasEpisodes && (
          <button type="button" className="catalog-list-col col-episode" onClick={() => handleSort('episode')}>
            Episode {sortIndicator('episode')}
          </button>
        )}
        <button type="button" className="catalog-list-col col-size" onClick={() => handleSort('size')}>
          Size {sortIndicator('size')}
        </button>
        <button type="button" className="catalog-list-col col-duration" onClick={() => handleSort('duration')}>
          Duration {sortIndicator('duration')}
        </button>
        <button type="button" className="catalog-list-col col-status" onClick={() => handleSort('status')}>
          Status {sortIndicator('status')}
        </button>
      </div>
      {sorted.map((entry) => {
        const title = getDisplayTitle(entry, metadataByKey);
        const isVirtual = entry.hasLocalFile === false;
        return (
          <Link
            key={entry.id}
            to={`/play/${entry.id}`}
            state={{ entry }}
            className={`catalog-list-row${isVirtual ? ' catalog-entry-virtual' : ''}`}
          >
            <span className="catalog-list-col col-name" title={entry.name}>
              {title}
            </span>
            {hasEpisodes && (
              <span className="catalog-list-col col-episode">{formatEpisodeLabel(entry)}</span>
            )}
            <span className="catalog-list-col col-size">{formatSize(entry.size)}</span>
            <span className="catalog-list-col col-duration">{formatDuration(entry.durationSec)}</span>
            <span className={`catalog-list-col col-status status-${entry.watchState}`}>
              {statusLabel(entry)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
