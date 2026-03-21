import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import {
  pullAllDeviceDocs,
  buildLocalSyncKeyIndex,
  mergeDeviceDocs,
} from '../firebase.js';
import type { MergedRemotePlaybackEntry } from '../sync-device-doc.js';

interface TmdbTvKey {
  type: 'tv';
  tmdbId: number;
  season: number;
  episode: string; // "03" or "01-02" for ranges
}

interface TmdbMovieKey {
  type: 'movie';
  tmdbId: number;
}

function parseTmdbKey(syncKey: string): TmdbTvKey | TmdbMovieKey | null {
  const tvMatch = syncKey.match(/^tmdb:tv:(\d+):s(\d+):e(\d+(?:-\d+)?)$/);
  if (tvMatch) {
    return {
      type: 'tv',
      tmdbId: Number(tvMatch[1]),
      season: Number(tvMatch[2]),
      episode: tvMatch[3],
    };
  }
  const movieMatch = syncKey.match(/^tmdb:movie:(\d+)$/);
  if (movieMatch) {
    return { type: 'movie', tmdbId: Number(movieMatch[1]) };
  }
  return null;
}

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

interface ShowGroup {
  tmdbId: number;
  title: string;
  type: 'tv' | 'movie';
  mostRecentAt: number;
  episodes: EpisodeEntry[];
}

interface EpisodeEntry {
  syncKey: string;
  season: number;
  episode: string;
  entry: MergedRemotePlaybackEntry;
  localEntryId?: number;
}

function buildShowGroups(
  merged: Map<string, MergedRemotePlaybackEntry>,
  localEntryBySyncKey: Map<string, number>,
): ShowGroup[] {
  const groups = new Map<string, ShowGroup>();

  for (const [syncKey, entry] of merged) {
    const parsed = parseTmdbKey(syncKey);
    if (!parsed) continue;

    const groupKey = `${parsed.type}:${parsed.tmdbId}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        tmdbId: parsed.tmdbId,
        title: entry.title ?? syncKey,
        type: parsed.type,
        mostRecentAt: 0,
        episodes: [],
      };
      groups.set(groupKey, group);
    }

    if (entry.watchedAt > group.mostRecentAt) {
      group.mostRecentAt = entry.watchedAt;
      // Use the most recent entry's title as the group title
      if (entry.title) group.title = entry.title;
    }

    const ep: EpisodeEntry = {
      syncKey,
      season: parsed.type === 'tv' ? parsed.season : 0,
      episode: parsed.type === 'tv' ? parsed.episode : '0',
      entry,
      localEntryId: localEntryBySyncKey.get(syncKey),
    };
    group.episodes.push(ep);
  }

  // Sort groups by most recent activity
  const sorted = [...groups.values()].sort((a, b) => b.mostRecentAt - a.mostRecentAt);

  // Sort episodes within each group by season, then episode
  for (const group of sorted) {
    group.episodes.sort((a, b) => {
      if (a.season !== b.season) return a.season - b.season;
      const aEp = Number(a.episode.split('-')[0]);
      const bEp = Number(b.episode.split('-')[0]);
      return aEp - bEp;
    });
  }

  return sorted;
}

function EpisodeRow({ ep }: { ep: EpisodeEntry }) {
  const { entry, localEntryId } = ep;
  const progress = entry.durationSec > 0 ? entry.position / entry.durationSec : 0;
  const remaining = entry.durationSec > 0 ? entry.durationSec - entry.position : 0;

  const episodeLabel = ep.episode.includes('-')
    ? `S${String(ep.season).padStart(2, '0')}E${ep.episode}`
    : `S${String(ep.season).padStart(2, '0')}E${String(Number(ep.episode)).padStart(2, '0')}`;

  const content = (
    <>
      <span className="episode-code">{episodeLabel}</span>
      <span className="episode-body">
        <span className="episode-name">
          {entry.title ?? ep.syncKey}
        </span>
        <span className="episode-file-meta">
          {entry.watchState === 'in-progress' && remaining > 0 && (
            <>{formatDuration(remaining)} remaining</>
          )}
          {entry.watchState === 'watched' && 'Watched'}
          {entry.watchedAt > 0 && (
            <> &middot; {formatTimeAgo(entry.watchedAt)}</>
          )}
          {entry.sourceDeviceLabel && (
            <> &middot; {entry.sourceDeviceLabel}</>
          )}
        </span>
        {entry.watchState === 'in-progress' && entry.durationSec > 0 && (
          <span className="episode-progress-block">
            <span className="episode-progress-bar">
              <span
                className="episode-progress-fill"
                style={{ width: `${Math.min(100, progress * 100)}%` }}
              />
            </span>
            <span className="episode-progress-time">
              {formatDuration(entry.position)} / {formatDuration(entry.durationSec)}
            </span>
          </span>
        )}
        {entry.watchState !== 'in-progress' && (
          <span className={`episode-watch-badge ${entry.watchState}`}>
            {entry.watchState === 'watched' ? 'Watched' : 'New'}
          </span>
        )}
      </span>
    </>
  );

  if (localEntryId != null) {
    return (
      <Link to={`/play/${localEntryId}`} className="episode-row">
        {content}
      </Link>
    );
  }

  return <div className="episode-row episode-row-missing">{content}</div>;
}

function MovieRow({ group }: { group: ShowGroup }) {
  const ep = group.episodes[0];
  if (!ep) return null;
  const { entry, localEntryId } = ep;
  const progress = entry.durationSec > 0 ? entry.position / entry.durationSec : 0;
  const remaining = entry.durationSec > 0 ? entry.durationSec - entry.position : 0;

  const content = (
    <span className="episode-body">
      <span className="episode-name">{group.title}</span>
      <span className="episode-file-meta">
        {entry.watchState === 'in-progress' && remaining > 0 && (
          <>{formatDuration(remaining)} remaining</>
        )}
        {entry.watchState === 'watched' && 'Watched'}
        {entry.watchedAt > 0 && (
          <> &middot; {formatTimeAgo(entry.watchedAt)}</>
        )}
        {entry.sourceDeviceLabel && (
          <> &middot; {entry.sourceDeviceLabel}</>
        )}
      </span>
      {entry.watchState === 'in-progress' && entry.durationSec > 0 && (
        <span className="episode-progress-block">
          <span className="episode-progress-bar">
            <span
              className="episode-progress-fill"
              style={{ width: `${Math.min(100, progress * 100)}%` }}
            />
          </span>
          <span className="episode-progress-time">
            {formatDuration(entry.position)} / {formatDuration(entry.durationSec)}
          </span>
        </span>
      )}
      {entry.watchState !== 'in-progress' && (
        <span className={`episode-watch-badge ${entry.watchState}`}>
          {entry.watchState === 'watched' ? 'Watched' : 'New'}
        </span>
      )}
    </span>
  );

  if (localEntryId != null) {
    return (
      <Link to={`/play/${localEntryId}`} className="episode-row">
        {content}
      </Link>
    );
  }

  return <div className="episode-row episode-row-missing">{content}</div>;
}

function ShowGroupCard({ group }: { group: ShowGroup }) {
  const [expanded, setExpanded] = useState(false);

  if (group.type === 'movie') {
    return (
      <section className="season-section">
        <div className="season-heading">
          <h2>{group.title}</h2>
          <span className="season-count">Movie</span>
        </div>
        <div className="episode-list">
          <MovieRow group={group} />
        </div>
      </section>
    );
  }

  const inProgress = group.episodes.filter((ep) => ep.entry.watchState === 'in-progress');
  const watched = group.episodes.filter((ep) => ep.entry.watchState === 'watched');
  const unwatched = group.episodes.filter(
    (ep) => ep.entry.watchState !== 'in-progress' && ep.entry.watchState !== 'watched',
  );

  // Show in-progress episodes by default, full list when expanded
  const previewEpisodes = expanded ? group.episodes : inProgress.slice(0, 5);
  const hasMore = !expanded && (inProgress.length > 5 || watched.length > 0 || unwatched.length > 0);

  return (
    <section className="season-section">
      <div className="season-heading">
        <h2>{group.title}</h2>
        <span className="season-count">
          {inProgress.length > 0 && `${inProgress.length} in progress`}
          {inProgress.length > 0 && watched.length > 0 && ', '}
          {watched.length > 0 && `${watched.length} watched`}
          {' '}
          &middot; {group.episodes.length} total
        </span>
      </div>
      <div className="episode-list">
        {previewEpisodes.map((ep) => (
          <EpisodeRow key={ep.syncKey} ep={ep} />
        ))}
        {hasMore && (
          <button
            type="button"
            className="device-card-more"
            onClick={() => setExpanded(true)}
            style={{ cursor: 'pointer', background: 'none', border: 'none', padding: '0.5rem', color: 'inherit', textAlign: 'left' }}
          >
            Show all {group.episodes.length} episodes
          </button>
        )}
      </div>
    </section>
  );
}

export function Activity() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<ShowGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      try {
        const [docs, keyIndex] = await Promise.all([
          pullAllDeviceDocs(user!.uid),
          buildLocalSyncKeyIndex(),
        ]);
        if (cancelled) return;

        // Merge all devices (including current) — most recent wins
        const merged = mergeDeviceDocs(docs);
        const showGroups = buildShowGroups(merged, keyIndex);
        setGroups(showGroups);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) {
    return (
      <div className="devices-page">
        <div className="devices-sign-in">Sign in to see your activity across devices.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="devices-page">
        <div className="devices-loading">Loading activity...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="devices-page">
        <div className="devices-error">Failed to load activity: {error}</div>
      </div>
    );
  }

  if (!groups || groups.length === 0) {
    return (
      <div className="devices-page">
        <div className="devices-empty">
          No watch activity yet. Play a video and your history will appear here.
        </div>
      </div>
    );
  }

  const inProgressGroups = groups.filter((g) =>
    g.episodes.some((ep) => ep.entry.watchState === 'in-progress'),
  );
  const watchedOnlyGroups = groups.filter(
    (g) => !g.episodes.some((ep) => ep.entry.watchState === 'in-progress'),
  );

  return (
    <div className="detail-page">
      {inProgressGroups.length > 0 && (
        <>
          <h2 className="devices-title">Continue Watching</h2>
          <div className="season-list">
            {inProgressGroups.map((group) => (
              <ShowGroupCard key={`${group.type}:${group.tmdbId}`} group={group} />
            ))}
          </div>
        </>
      )}

      {watchedOnlyGroups.length > 0 && (
        <>
          <h2 className="devices-title" style={{ marginTop: inProgressGroups.length > 0 ? '2rem' : 0 }}>
            Recently Watched
          </h2>
          <div className="season-list">
            {watchedOnlyGroups.map((group) => (
              <ShowGroupCard key={`${group.type}:${group.tmdbId}`} group={group} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
