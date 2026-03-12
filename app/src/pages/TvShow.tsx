import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type LibraryEntry } from '../db.js';
import { useFilesystemRescan } from '../hooks/useFilesystemRescan.js';
import { groupTvShows } from '../library-groups.js';
import {
  invalidateMetadata,
  refreshLibraryMetadata,
  refreshSeriesSeasons,
} from '../metadata/client.js';

function seasonLabel(seasonNumber?: number): string {
  if (seasonNumber == null) return 'Other Files';
  if (seasonNumber === 0) return 'Specials';
  return `Season ${seasonNumber}`;
}

function localEpisodeLabel(entry: LibraryEntry): string {
  if (entry.seasonNumber == null || entry.episodeNumber == null) {
    return entry.name;
  }

  if (
    entry.endingEpisodeNumber != null &&
    entry.endingEpisodeNumber > entry.episodeNumber
  ) {
    return `S${String(entry.seasonNumber).padStart(2, '0')}E${String(entry.episodeNumber).padStart(
      2,
      '0',
    )}-E${String(entry.endingEpisodeNumber).padStart(2, '0')}`;
  }

  return `S${String(entry.seasonNumber).padStart(2, '0')}E${String(entry.episodeNumber).padStart(2, '0')}`;
}

function metadataEpisodeLabel(seasonNumber: number, episodeNumber: number): string {
  return `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
}

function formatTime(sec: number): string {
  if (sec <= 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
  const seasonCacheEntries = useLiveQuery(() => db.metadataSeasonCache.toArray());
  const filesystemRescan = useFilesystemRescan({ autoOnMount: true, autoKey: decodedId });
  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [metadataStatusMessage, setMetadataStatusMessage] = useState<string | null>(null);
  const [seasonMetadataStatusMessage, setSeasonMetadataStatusMessage] = useState<string | null>(null);
  const [isRefreshingSeasonMetadata, setIsRefreshingSeasonMetadata] = useState(false);

  const allEntries = entries ?? [];
  const allSeriesMetadata = seriesMetadata ?? [];
  const allSeasonCacheEntries = seasonCacheEntries ?? [];
  const metadataByKey = new Map(allSeriesMetadata.map((entry) => [entry.key, entry]));
  const show = groupTvShows(allEntries, metadataByKey).find(
    (group) => group.slug === decodedId || group.id === decodedId,
  );
  const showSeasonCacheEntries =
    show?.seriesMetadata?.tmdbId == null
      ? []
      : allSeasonCacheEntries.filter(
          (entry) =>
            entry.tmdbSeriesId === show.seriesMetadata?.tmdbId ||
            entry.seriesMetadataKey === show.seriesMetadata?.key,
        );

  const seasonCacheByNumber = new Map<number, (typeof showSeasonCacheEntries)[number]>();
  for (const entry of showSeasonCacheEntries) {
    const existing = seasonCacheByNumber.get(entry.seasonNumber);
    if (!existing || existing.fetchedAt < entry.fetchedAt) {
      seasonCacheByNumber.set(entry.seasonNumber, entry);
    }
  }

  const expectedSeasonCount = show?.seriesMetadata?.seasons?.length ?? 0;
  const resolvedSeasonCount = [...seasonCacheByNumber.values()].filter(
    (entry) => entry.status === 'resolved',
  ).length;

  useEffect(() => {
    if (!show?.seriesMetadata?.key || show.seriesMetadata.status !== 'resolved') {
      return;
    }

    if (expectedSeasonCount > 0 && resolvedSeasonCount >= expectedSeasonCount) {
      return;
    }

    let cancelled = false;
    setIsRefreshingSeasonMetadata(true);
    setSeasonMetadataStatusMessage(null);

    void refreshSeriesSeasons({ seriesKey: show.seriesMetadata.key })
      .catch((error) => {
        if (!cancelled) {
          setSeasonMetadataStatusMessage(
            error instanceof Error ? error.message : 'Episode metadata refresh failed.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsRefreshingSeasonMetadata(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [expectedSeasonCount, resolvedSeasonCount, show?.seriesMetadata?.key, show?.seriesMetadata?.status]);

  if (
    entries === undefined ||
    seriesMetadata === undefined ||
    seasonCacheEntries === undefined ||
    !filesystemRescan.directoriesReady
  ) {
    return <div className="empty-state">Loading...</div>;
  }

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

  const entriesBySeasonAndEpisode = new Map<number, Map<number, LibraryEntry>>();
  const otherEntries: LibraryEntry[] = [];
  for (const entry of show.entries) {
    if (entry.seasonNumber == null || entry.episodeNumber == null) {
      otherEntries.push(entry);
      continue;
    }

    const seasonEntries = entriesBySeasonAndEpisode.get(entry.seasonNumber) ?? new Map<number, LibraryEntry>();
    const endingEpisode = entry.endingEpisodeNumber ?? entry.episodeNumber;
    for (let episode = entry.episodeNumber; episode <= endingEpisode; episode += 1) {
      if (!seasonEntries.has(episode)) {
        seasonEntries.set(episode, entry);
      }
    }
    entriesBySeasonAndEpisode.set(entry.seasonNumber, seasonEntries);
  }

  otherEntries.sort((left, right) => left.name.localeCompare(right.name));

  const metadataKeys = [
    ...new Set(
      show.entries
        .map((entry) => entry.seriesMetadataKey)
        .filter((key): key is string => typeof key === 'string' && key.length > 0),
    ),
  ];
  const metadataSeasons = show.seriesMetadata?.seasons ?? [];

  const handleRefreshMetadata = async () => {
    setIsRefreshingMetadata(true);
    setMetadataStatusMessage(null);
    setSeasonMetadataStatusMessage(null);
    try {
      if (metadataKeys.length > 0) {
        await invalidateMetadata(metadataKeys);
      }
      await refreshLibraryMetadata({ entries: show.entries, force: true });
      await Promise.all(metadataKeys.map((seriesKey) => refreshSeriesSeasons({ seriesKey, force: true })));
      setMetadataStatusMessage('Metadata refreshed.');
    } catch (error) {
      setMetadataStatusMessage(error instanceof Error ? error.message : 'Metadata refresh failed.');
    } finally {
      setIsRefreshingMetadata(false);
    }
  };

  const seasonSections =
    show.seriesMetadata?.status === 'resolved' && metadataSeasons.length > 0
      ? [
          ...metadataSeasons.map((season) => {
            const cachedSeason = seasonCacheByNumber.get(season.seasonNumber);
            const localSeasonEntries = entriesBySeasonAndEpisode.get(season.seasonNumber);
            const episodes =
              cachedSeason?.status === 'resolved'
                ? (cachedSeason.payload?.episodes ?? [])
                : [...(localSeasonEntries?.entries() ?? [])]
                    .sort(([left], [right]) => left - right)
                    .map(([episodeNumber, entry]) => ({
                      episodeNumber,
                      name: entry.name,
                    }));
            return {
              seasonNumber: season.seasonNumber,
              title: seasonLabel(season.seasonNumber),
              episodeCount: season.episodeCount,
              episodes,
              status: cachedSeason?.status,
              hasResolvedEpisodeMetadata: cachedSeason?.status === 'resolved',
            };
          }),
          ...[...entriesBySeasonAndEpisode.entries()]
            .filter(
              ([seasonNumber]) =>
                !metadataSeasons.some((season) => season.seasonNumber === seasonNumber),
            )
            .sort(([left], [right]) => left - right)
            .map(([seasonNumber, seasonEntries]) => ({
              seasonNumber,
              title: seasonLabel(seasonNumber),
              episodeCount: seasonEntries.size,
              episodes: [...seasonEntries.entries()]
                .sort(([left], [right]) => left - right)
                .map(([episodeNumber, entry]) => ({
                  episodeNumber,
                  name: entry.name,
                })),
              status: 'resolved' as const,
              hasResolvedEpisodeMetadata: false,
            })),
        ]
      : [...entriesBySeasonAndEpisode.entries()]
          .sort(([left], [right]) => left - right)
          .map(([seasonNumber, seasonEntries]) => ({
            seasonNumber,
            title: seasonLabel(seasonNumber),
            episodeCount: seasonEntries.size,
            episodes: [...seasonEntries.entries()]
              .sort(([left], [right]) => left - right)
              .map(([episodeNumber, entry]) => ({
                episodeNumber,
                name: entry.name,
              })),
            status: 'resolved' as const,
            hasResolvedEpisodeMetadata: false,
          }));

  const totalEpisodeCount =
    show.seriesMetadata?.episodeCount ??
    seasonSections.reduce((count, season) => count + season.episodeCount, 0);
  const presentEpisodeCount = seasonSections.reduce((count, season) => {
    const seasonEntries = entriesBySeasonAndEpisode.get(season.seasonNumber);
    if (!seasonEntries) return count;
    return count + seasonEntries.size;
  }, 0);

  return (
    <div className="detail-page">
      <div className="page-toolbar">
        <Link to="/shows" className="player-back">
          &larr; Back to Shows
        </Link>
        <div className="page-toolbar-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleRefreshMetadata()}
            disabled={isRefreshingMetadata}
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
      {isRefreshingSeasonMetadata ? (
        <div className="page-toolbar-status" aria-live="polite">
          Loading episode metadata...
        </div>
      ) : null}
      {seasonMetadataStatusMessage ? (
        <div className="page-toolbar-status" aria-live="polite">
          {seasonMetadataStatusMessage}
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
            {show.year ?? 'Unknown year'}
            {totalEpisodeCount > 0 ? ` · ${presentEpisodeCount} of ${totalEpisodeCount} episodes present` : null}
          </div>
          {show.seriesMetadata?.overview ? (
            <p className="detail-overview">{show.seriesMetadata.overview}</p>
          ) : null}
        </div>
      </div>

      <div className="season-list">
        {seasonSections.map((season) => (
          <section key={season.seasonNumber} className="season-section">
            <div className="season-heading">
              <h2>{season.title}</h2>
              <span className="season-count">
                {(entriesBySeasonAndEpisode.get(season.seasonNumber)?.size ?? 0)}/{season.episodeCount} present
              </span>
            </div>
            <div className="episode-list">
              {season.episodes.length > 0 ? (
                season.episodes.map((episode) => {
                  const fileEntry = entriesBySeasonAndEpisode
                    .get(season.seasonNumber)
                    ?.get(episode.episodeNumber);

                  if (!fileEntry) {
                    return (
                      <div
                        key={`${season.seasonNumber}-${episode.episodeNumber}`}
                        className="episode-row episode-row-missing"
                      >
                        <span className="episode-code">
                          {metadataEpisodeLabel(season.seasonNumber, episode.episodeNumber)}
                        </span>
                        <span className="episode-body">
                          <span className="episode-name">{episode.name}</span>
                          <span className="episode-file-state">
                            {season.hasResolvedEpisodeMetadata ? 'File not present' : 'Checking for file'}
                          </span>
                        </span>
                      </div>
                    );
                  }

                  return (
                    <Link key={`${season.seasonNumber}-${episode.episodeNumber}`} to={`/play/${fileEntry.id}`} className="episode-row">
                      <span className="episode-code">
                        {metadataEpisodeLabel(season.seasonNumber, episode.episodeNumber)}
                      </span>
                      <span className="episode-body">
                        <span className="episode-name">{episode.name}</span>
                        <span className="episode-file-meta">
                          {formatSize(fileEntry.size)}
                          {fileEntry.durationSec > 0 ? ` · ${formatTime(fileEntry.durationSec)}` : ''}
                        </span>
                        {fileEntry.watchState === 'in-progress' && fileEntry.durationSec > 0 ? (
                          <span className="episode-progress-block">
                            <span className="episode-progress-bar">
                              <span
                                className="episode-progress-fill"
                                style={{
                                  width: `${Math.min(
                                    100,
                                    (fileEntry.playbackPositionSec / fileEntry.durationSec) * 100,
                                  )}%`,
                                }}
                              />
                            </span>
                            <span className="episode-progress-time">
                              {formatTime(fileEntry.playbackPositionSec)} / {formatTime(fileEntry.durationSec)}
                            </span>
                          </span>
                        ) : (
                          <span className={`episode-watch-badge ${fileEntry.watchState}`}>
                            {watchLabel(fileEntry)}
                          </span>
                        )}
                      </span>
                    </Link>
                  );
                })
              ) : season.status === 'error' ? (
                <div className="episode-row episode-row-missing">
                  <span className="episode-code">{seasonLabel(season.seasonNumber)}</span>
                  <span className="episode-body">
                    <span className="episode-name">Episode metadata unavailable</span>
                    <span className="episode-file-state">Refresh metadata to retry.</span>
                  </span>
                </div>
              ) : (
                <div className="episode-row episode-row-missing">
                  <span className="episode-code">{seasonLabel(season.seasonNumber)}</span>
                  <span className="episode-body">
                    <span className="episode-name">Loading season episodes...</span>
                    <span className="episode-file-state">Checking TMDB.</span>
                  </span>
                </div>
              )}
            </div>
          </section>
        ))}

        {otherEntries.length > 0 ? (
          <section className="season-section">
            <div className="season-heading">
              <h2>{seasonLabel(undefined)}</h2>
              <span className="season-count">{otherEntries.length} file{otherEntries.length === 1 ? '' : 's'}</span>
            </div>
            <div className="episode-list">
              {otherEntries.map((entry) => (
                <Link key={entry.id} to={`/play/${entry.id}`} className="episode-row">
                  <span className="episode-code">{localEpisodeLabel(entry)}</span>
                  <span className="episode-body">
                    <span className="episode-name">{entry.name}</span>
                    <span className="episode-file-meta">
                      {formatSize(entry.size)}
                      {entry.durationSec > 0 ? ` · ${formatTime(entry.durationSec)}` : ''}
                    </span>
                    {entry.watchState === 'in-progress' && entry.durationSec > 0 ? (
                      <span className="episode-progress-block">
                        <span className="episode-progress-bar">
                          <span
                            className="episode-progress-fill"
                            style={{
                              width: `${Math.min(100, (entry.playbackPositionSec / entry.durationSec) * 100)}%`,
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
        ) : null}
      </div>
    </div>
  );
}
