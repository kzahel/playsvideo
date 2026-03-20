import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db.js';
import { getDeviceId } from '../device.js';
import { useSetting } from '../hooks/useSetting.js';
import { useFilesystemRescan } from '../hooks/useFilesystemRescan.js';
import { groupTvShows } from '../catalog-groups.js';
import {
  applyLocalPlaybackToCatalogEntries,
  type CatalogPlaybackView,
} from '../local-playback-views.js';
import {
  invalidateMetadata,
  refreshCatalogMetadata,
  refreshSeriesSeasons,
} from '../metadata/client.js';
import {
  METADATA_REQUEST_TIER_KEY,
  TMDB_REQUESTS_ENABLED_KEY,
} from '../metadata/settings.js';
import type { MetadataRequestTier } from '../metadata/types.js';
import { AUTO_RESCAN_DETAIL_PAGES_KEY } from '../settings.js';

function seasonLabel(seasonNumber?: number): string {
  if (seasonNumber == null) return 'Other Files';
  if (seasonNumber === 0) return 'Specials';
  return `Season ${seasonNumber}`;
}

function localEpisodeLabel(entry: CatalogPlaybackView): string {
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

function watchLabel(entry: CatalogPlaybackView): string {
  if (entry.watchState === 'watched') return 'Watched';
  if (entry.watchState === 'in-progress') return 'In Progress';
  return 'New';
}

export function TvShow() {
  const { showId } = useParams<{ showId: string }>();
  const decodedId = decodeURIComponent(showId ?? '');
  const deviceId = useLiveQuery(() => getDeviceId(), []);
  const entries = useLiveQuery(async () => {
    const [catalogEntries, playbackEntries] = await Promise.all([
      db.catalog.toArray(),
      deviceId
        ? db.playback.where('deviceId').equals(deviceId).toArray()
        : Promise.resolve([]),
    ]);
    return applyLocalPlaybackToCatalogEntries({
      catalogEntries,
      playbackEntries,
    });
  }, [deviceId]);
  const seriesMetadata = useLiveQuery(() => db.seriesMetadata.toArray());
  const seasonCacheEntries = useLiveQuery(() => db.metadataSeasonCache.toArray());
  const [autoRescanDetailPages] = useSetting<boolean>(AUTO_RESCAN_DETAIL_PAGES_KEY, true);
  const filesystemRescan = useFilesystemRescan({
    autoOnMount: autoRescanDetailPages,
    autoKey: decodedId,
  });
  const [requestTier] = useSetting<MetadataRequestTier>(METADATA_REQUEST_TIER_KEY, 'essential');
  const [tmdbRequestsEnabled] = useSetting<boolean>(TMDB_REQUESTS_ENABLED_KEY, true);
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
  const entriesBySeasonAndEpisode = new Map<number, Map<number, CatalogPlaybackView>>();
  const otherEntries: CatalogPlaybackView[] = [];
  for (const entry of show?.entries ?? []) {
    if (entry.seasonNumber == null || entry.episodeNumber == null) {
      otherEntries.push(entry);
      continue;
    }

    const seasonEntries =
      entriesBySeasonAndEpisode.get(entry.seasonNumber) ??
      new Map<number, CatalogPlaybackView>();
    const endingEpisode = entry.endingEpisodeNumber ?? entry.episodeNumber;
    for (let episode = entry.episodeNumber; episode <= endingEpisode; episode += 1) {
      if (!seasonEntries.has(episode)) {
        seasonEntries.set(episode, entry);
      }
    }
    entriesBySeasonAndEpisode.set(entry.seasonNumber, seasonEntries);
  }

  otherEntries.sort((left, right) => left.name.localeCompare(right.name));
  const localSeasonNumbers = [...entriesBySeasonAndEpisode.keys()].sort((left, right) => left - right);
  const shouldAutoFetchSeasonMetadata =
    tmdbRequestsEnabled && requestTier === 'nice-to-have';

  useEffect(() => {
    if (!shouldAutoFetchSeasonMetadata) {
      return;
    }

    if (!show?.seriesMetadata?.key || show.seriesMetadata.status !== 'resolved') {
      return;
    }

    if (expectedSeasonCount > 0 && resolvedSeasonCount >= expectedSeasonCount) {
      return;
    }

    let cancelled = false;
    setIsRefreshingSeasonMetadata(true);
    setSeasonMetadataStatusMessage(null);

    void refreshSeriesSeasons({
      seriesKey: show.seriesMetadata.key,
      seasonNumbers: localSeasonNumbers,
    })
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
  }, [
    expectedSeasonCount,
    localSeasonNumbers.join(','),
    resolvedSeasonCount,
    shouldAutoFetchSeasonMetadata,
    show?.seriesMetadata?.key,
    show?.seriesMetadata?.status,
  ]);

  if (
    entries === undefined ||
    seriesMetadata === undefined ||
    seasonCacheEntries === undefined ||
    deviceId === undefined ||
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
        </div>
        <p>{waitingForRescan ? 'Refreshing files...' : 'Show not found.'}</p>
      </div>
    );
  }

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
      await refreshCatalogMetadata({ entries: show.entries, force: true });
      if (shouldAutoFetchSeasonMetadata) {
        await Promise.all(
          metadataKeys.map((seriesKey) =>
            refreshSeriesSeasons({
              seriesKey,
              force: true,
              seasonNumbers: localSeasonNumbers,
            }),
          ),
        );
      }
      setMetadataStatusMessage('Metadata refreshed.');
    } catch (error) {
      setMetadataStatusMessage(error instanceof Error ? error.message : 'Metadata refresh failed.');
    } finally {
      setIsRefreshingMetadata(false);
    }
  };

  const handleLoadEpisodeMetadata = async () => {
    if (!show.seriesMetadata?.key) {
      return;
    }

    setIsRefreshingSeasonMetadata(true);
    setSeasonMetadataStatusMessage(null);
    try {
      await refreshSeriesSeasons({
        seriesKey: show.seriesMetadata.key,
        force: true,
        seasonNumbers: localSeasonNumbers,
      });
      setSeasonMetadataStatusMessage('Episode metadata loaded.');
    } catch (error) {
      setSeasonMetadataStatusMessage(
        error instanceof Error ? error.message : 'Episode metadata refresh failed.',
      );
    } finally {
      setIsRefreshingSeasonMetadata(false);
    }
  };

  const seasonSections =
    show.seriesMetadata?.status === 'resolved' && metadataSeasons.length > 0
      ? [
          ...metadataSeasons.map((metadataSeason) => {
            const seasonNumber = metadataSeason.seasonNumber;
            const cachedSeason = seasonCacheByNumber.get(seasonNumber);
            const localSeasonEntries = entriesBySeasonAndEpisode.get(seasonNumber);
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
              seasonNumber,
              title: seasonLabel(seasonNumber),
              episodeCount: metadataSeason.episodeCount,
              localEpisodeCount: localSeasonEntries?.size ?? 0,
              episodes,
              status: cachedSeason?.status ?? (localSeasonEntries ? ('resolved' as const) : undefined),
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
              localEpisodeCount: seasonEntries.size,
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
            localEpisodeCount: seasonEntries.size,
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
            disabled={isRefreshingMetadata || !tmdbRequestsEnabled}
          >
            {isRefreshingMetadata ? 'Refreshing Metadata...' : 'Refresh Metadata'}
          </button>
          {!shouldAutoFetchSeasonMetadata && localSeasonNumbers.length > 0 ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleLoadEpisodeMetadata()}
              disabled={isRefreshingSeasonMetadata || !tmdbRequestsEnabled}
            >
              {isRefreshingSeasonMetadata ? 'Loading Episode Metadata...' : 'Load Episode Metadata'}
            </button>
          ) : null}
        </div>
      </div>
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
      {isRefreshingSeasonMetadata && shouldAutoFetchSeasonMetadata ? (
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
          {!shouldAutoFetchSeasonMetadata ? (
            <p className="detail-overview">
              {tmdbRequestsEnabled
                ? 'Request tier is set to `Essential`, so only show-level matching and metadata are fetched automatically. Use `Load Episode Metadata` here or switch the tier to `Nice to Have`.'
                : 'TMDB requests are disabled in Settings, so only local filename parsing is used on this page.'}
            </p>
          ) : null}
        </div>
      </div>

      <div className="season-list">
        {seasonSections.map((season) => (
          <section key={season.seasonNumber} className="season-section">
            <div className="season-heading">
              <h2>{season.title}</h2>
              <span className="season-count">
                {season.localEpisodeCount}/{season.episodeCount} present
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

                  if (fileEntry.hasLocalFile === false) {
                    return (
                      <Link
                        key={`${season.seasonNumber}-${episode.episodeNumber}`}
                        to={`/play/${fileEntry.id}`}
                        state={{ entry: fileEntry }}
                        className="episode-row episode-row-virtual"
                      >
                        <span className="episode-code">
                          {metadataEpisodeLabel(season.seasonNumber, episode.episodeNumber)}
                        </span>
                        <span className="episode-body">
                          <span className="episode-name">{episode.name}</span>
                          <span className="episode-file-state">
                            {fileEntry.torrentComplete ? 'Available via torrent' : 'Not downloaded'}
                          </span>
                        </span>
                      </Link>
                    );
                  }

                  return (
                    <Link
                      key={`${season.seasonNumber}-${episode.episodeNumber}`}
                      to={`/play/${fileEntry.id}`}
                      state={{ entry: fileEntry }}
                      className="episode-row"
                    >
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
              ) : season.localEpisodeCount === 0 ? (
                <div className="episode-row episode-row-missing">
                  <span className="episode-code">{seasonLabel(season.seasonNumber)}</span>
                  <span className="episode-body">
                    <span className="episode-name">No files found for this season</span>
                    <span className="episode-file-state">
                      {season.hasResolvedEpisodeMetadata
                        ? 'Episode metadata is available, but no local files matched this season.'
                        : 'Episode list has not been loaded for this season.'}
                    </span>
                  </span>
                </div>
              ) : (
                <div className="episode-row episode-row-missing">
                  <span className="episode-code">{seasonLabel(season.seasonNumber)}</span>
                  <span className="episode-body">
                    <span className="episode-name">Loading season episodes...</span>
                    <span className="episode-file-state">
                      {tmdbRequestsEnabled ? 'Checking TMDB.' : 'Episode metadata is disabled in Settings.'}
                    </span>
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
                <Link key={entry.id} to={`/play/${entry.id}`} state={{ entry }} className="episode-row">
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
