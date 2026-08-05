import { useEffect, useMemo, useState } from 'react';
import {
  applyLogicalDevicePresentation,
  activityFactsFromDeviceDocs,
  activityFactsFromRemotePlayback,
  buildActivityGroups,
  listActivityDevices,
  summarizeActivityProjection,
  type ActivityDeviceOption,
  type ActivityFact,
  type ActivityGroup,
  type ActivityItem,
} from '../activity/activity-view.js';
import { PlaybackHandoffActions } from '../components/PlaybackHandoffActions.js';
import { db } from '../db.js';
import { getDeviceId, getDeviceLabel } from '../device.js';
import type { DeviceRegistryState } from '../device-groups.js';
import { pullAndCacheDeviceSyncState } from '../firebase.js';
import { useAuth } from '../hooks/useAuth.js';
import {
  cleanupExpiredPendingHandoffs,
  reconcilePendingHandoffs,
} from '../handoff/pending-handoffs.js';
import {
  loadLocalPlaybackTargetIndex,
  type LocalPlaybackTargetIndex,
} from '../playback-identity-resolver.js';

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

function formatEpisodeLabel(item: ActivityItem): string | null {
  if (item.seasonNumber == null || item.episodeLabel == null) return null;
  return `S${String(item.seasonNumber).padStart(2, '0')}E${item.episodeLabel}`;
}

function ActivityItemRow({ item }: { item: ActivityItem }) {
  const { fact, localTarget } = item;
  const progress = fact.durationSec > 0 ? fact.positionSec / fact.durationSec : 0;
  const remaining = fact.durationSec > 0 ? fact.durationSec - fact.positionSec : 0;
  const episodeLabel = formatEpisodeLabel(item);
  const content = (
    <>
      {episodeLabel && <span className="episode-code">{episodeLabel}</span>}
      <span className="episode-body">
        <span className="episode-name">{fact.title ?? fact.playbackKey}</span>
        <span className="episode-file-meta">
          {fact.watchState === 'in-progress' && remaining > 0 && (
            <>{formatDuration(remaining)} remaining</>
          )}
          {fact.watchState === 'watched' && 'Watched'}
          {fact.lastPlayedAt > 0 && <> &middot; {formatTimeAgo(fact.lastPlayedAt)}</>}
          {fact.deviceLabel && <> &middot; {fact.deviceLabel}</>}
        </span>
        {fact.watchState === 'in-progress' && fact.durationSec > 0 && (
          <span className="episode-progress-block">
            <span className="episode-progress-bar">
              <span
                className="episode-progress-fill"
                style={{ width: `${Math.min(100, progress * 100)}%` }}
              />
            </span>
            <span className="episode-progress-time">
              {formatDuration(fact.positionSec)} / {formatDuration(fact.durationSec)}
            </span>
          </span>
        )}
        {fact.watchState !== 'in-progress' && (
          <span className={`episode-watch-badge ${fact.watchState}`}>
            {fact.watchState === 'watched' ? 'Watched' : 'New'}
          </span>
        )}
        <PlaybackHandoffActions
          fact={fact}
          localTarget={localTarget}
          ambiguous={item.localResolutionStatus === 'ambiguous'}
        />
      </span>
    </>
  );
  return (
    <div className={`episode-row${localTarget?.hasLocalFile ? '' : ' episode-row-missing'}`}>
      {content}
    </div>
  );
}

function chronologicalItems(items: ActivityItem[]): ActivityItem[] {
  return [...items].sort((left, right) => {
    const seasonDiff =
      (left.seasonNumber ?? Number.MAX_SAFE_INTEGER) -
      (right.seasonNumber ?? Number.MAX_SAFE_INTEGER);
    if (seasonDiff !== 0) return seasonDiff;
    return (
      Number(left.episodeLabel ?? Number.MAX_SAFE_INTEGER) -
      Number(right.episodeLabel ?? Number.MAX_SAFE_INTEGER)
    );
  });
}

function ActivityGroupCard({ group }: { group: ActivityGroup }) {
  const [expanded, setExpanded] = useState(false);
  const inProgress = group.items.filter((item) => item.fact.watchState === 'in-progress');
  const watched = group.items.filter((item) => item.fact.watchState === 'watched');
  const preview = inProgress.length > 0 ? inProgress.slice(0, 5) : watched.slice(0, 5);
  const displayItems = expanded ? chronologicalItems(group.items) : preview;
  const hasMore = !expanded && displayItems.length < group.items.length;

  return (
    <section className="season-section">
      <div className="season-heading">
        <h2>{group.title}</h2>
        <span className="season-count">
          {group.type === 'movie' && 'Movie'}
          {group.type === 'other' && 'Other media'}
          {group.type === 'tv' && (
            <>
              {inProgress.length > 0 && `${inProgress.length} in progress`}
              {inProgress.length > 0 && watched.length > 0 && ', '}
              {watched.length > 0 && `${watched.length} watched`}
              {' · '}
              {group.items.length} total
            </>
          )}
        </span>
      </div>
      <div className="episode-list">
        {displayItems.map((item) => (
          <ActivityItemRow key={item.id} item={item} />
        ))}
        {hasMore && (
          <button type="button" className="device-card-more" onClick={() => setExpanded(true)}>
            Show all {group.items.length} episodes
          </button>
        )}
      </div>
    </section>
  );
}

function DeviceFilters({
  devices,
  selectedDeviceId,
  onChange,
}: {
  devices: ActivityDeviceOption[];
  selectedDeviceId: string;
  onChange: (deviceId: string) => void;
}) {
  return (
    <div className="activity-device-filters" aria-label="Activity device filter">
      <button
        type="button"
        className={`activity-filter-btn${selectedDeviceId === 'all' ? ' active' : ''}`}
        aria-pressed={selectedDeviceId === 'all'}
        onClick={() => onChange('all')}
      >
        All devices
      </button>
      {devices.map((device) => {
        return (
          <button
            type="button"
            key={device.id}
            className={`activity-filter-btn${selectedDeviceId === device.id ? ' active' : ''}`}
            aria-pressed={selectedDeviceId === device.id}
            title={
              device.isCurrent
                ? device.label
                : device.lastSyncedAt
                  ? `Last synced ${formatTimeAgo(device.lastSyncedAt)}`
                  : undefined
            }
            onClick={() => onChange(device.id)}
          >
            {device.isCurrent ? 'This device' : device.label}
          </button>
        );
      })}
    </div>
  );
}

export function Activity() {
  const { user, loading: authLoading } = useAuth();
  const [facts, setFacts] = useState<ActivityFact[] | null>(null);
  const [localTargetIndex, setLocalTargetIndex] = useState<LocalPlaybackTargetIndex | null>(null);
  const [devices, setDevices] = useState<ActivityDeviceOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [
          targetIndex,
          localDeviceId,
          localDeviceLabel,
          localPlayback,
          catalogEntries,
          seriesMeta,
          movieMeta,
          cachedRemotePlayback,
        ] = await Promise.all([
          loadLocalPlaybackTargetIndex(),
          getDeviceId(),
          getDeviceLabel(),
          db.playback.toArray(),
          db.catalog.toArray(),
          db.seriesMetadata.toArray(),
          db.movieMetadata.toArray(),
          db.remotePlayback.toArray(),
        ]);
        if (cancelled) return;

        await reconcilePendingHandoffs(targetIndex);
        await cleanupExpiredPendingHandoffs();
        if (cancelled) return;

        const catalogByKey = new Map(
          catalogEntries
            .filter((entry) => entry.canonicalPlaybackKey)
            .map((entry) => [entry.canonicalPlaybackKey!, entry]),
        );
        const seriesMetaByKey = new Map(seriesMeta.map((entry) => [entry.key, entry]));
        const movieMetaByKey = new Map(movieMeta.map((entry) => [entry.key, entry]));
        const localFacts: ActivityFact[] = [];
        for (const playback of localPlayback) {
          if (playback.deviceId !== localDeviceId || playback.durationSec <= 0) continue;
          const catalogEntry = catalogByKey.get(playback.playbackKey);
          const series = catalogEntry?.seriesMetadataKey
            ? seriesMetaByKey.get(catalogEntry.seriesMetadataKey)
            : undefined;
          const movie = catalogEntry?.movieMetadataKey
            ? movieMetaByKey.get(catalogEntry.movieMetadataKey)
            : undefined;
          localFacts.push({
            deviceId: localDeviceId,
            deviceLabel: localDeviceLabel,
            playbackKey: playback.playbackKey,
            positionSec: playback.positionSec,
            durationSec: playback.durationSec,
            watchState: playback.watchState,
            lastPlayedAt: playback.lastPlayedAt,
            title: catalogEntry?.parsedTitle ?? catalogEntry?.name,
            seasonNumber: catalogEntry?.seasonNumber,
            episodeNumber: catalogEntry?.episodeNumber,
            contentHash: catalogEntry?.contentHash,
            torrentInfoHash: catalogEntry?.torrentInfoHash,
            torrentFileIndex: catalogEntry?.torrentFileIndex,
            torrentMagnetUrl: catalogEntry?.torrentMagnetUrl,
            torrentComplete: catalogEntry?.torrentComplete,
            tmdbId: series?.status === 'resolved' ? series.tmdbId : movie?.tmdbId,
            tmdbMediaType:
              series?.status === 'resolved'
                ? 'tv'
                : movie?.status === 'resolved'
                  ? 'movie'
                  : undefined,
          });
        }

        const applyFacts = (allFacts: ActivityFact[], registry?: DeviceRegistryState) => {
          const nextDevices = listActivityDevices(
            allFacts,
            localDeviceId,
            localDeviceLabel,
            registry,
          );
          setFacts(applyLogicalDevicePresentation(allFacts, nextDevices));
          setDevices(nextDevices);
          setSelectedDeviceId((selected) =>
            selected === 'all' || nextDevices.some((device) => device.id === selected)
              ? selected
              : 'all',
          );
        };

        applyFacts([...activityFactsFromRemotePlayback(cachedRemotePlayback), ...localFacts]);
        setLocalTargetIndex(targetIndex);
        setLoading(false);

        if (user) {
          setRefreshing(true);
          try {
            const state = await pullAndCacheDeviceSyncState(user.uid);
            if (cancelled) return;
            const remoteFacts = activityFactsFromDeviceDocs(
              state.devices.filter((device) => device.deviceId !== localDeviceId),
            );
            applyFacts([...remoteFacts, ...localFacts], state.registry);
            setLastRefreshedAt(Date.now());
          } catch (err) {
            if (!cancelled) setError(err instanceof Error ? err.message : String(err));
          } finally {
            if (!cancelled) setRefreshing(false);
          }
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [user, refreshNonce]);

  const projection = useMemo(() => {
    const selectedDevice =
      selectedDeviceId === 'all'
        ? undefined
        : devices.find((device) => device.id === selectedDeviceId);
    const selectedDeviceIds = selectedDevice ? new Set(selectedDevice.deviceIds) : undefined;
    const scopedFacts =
      facts?.filter(
        (fact) => selectedDeviceIds == null || selectedDeviceIds.has(fact.deviceId),
      ) ?? [];
    const groups = facts
      ? buildActivityGroups({
            facts,
            deviceIds: selectedDevice?.deviceIds,
            localTargetIndex: localTargetIndex ?? undefined,
          })
      : [];
    return { groups, diagnostics: summarizeActivityProjection(scopedFacts, groups) };
  }, [devices, facts, localTargetIndex, selectedDeviceId]);
  const { groups } = projection;

  if ((loading || authLoading) && facts == null) {
    return (
      <div className="devices-page">
        <div className="devices-loading">Loading activity...</div>
      </div>
    );
  }

  if (error && facts == null) {
    return (
      <div className="devices-page">
        <div className="devices-error">Failed to load activity: {error}</div>
      </div>
    );
  }

  const inProgressGroups = groups.filter((group) =>
    group.items.some((item) => item.fact.watchState === 'in-progress'),
  );
  const watchedOnlyGroups = groups.filter(
    (group) => !group.items.some((item) => item.fact.watchState === 'in-progress'),
  );

  return (
    <div
      className="detail-page activity-page"
      data-activity-input-facts={projection.diagnostics.inputFactCount}
      data-activity-displayed-items={projection.diagnostics.displayedItemCount}
      data-activity-unresolved-items={projection.diagnostics.unresolvedGroupingCount}
      data-activity-local-matches={projection.diagnostics.localMatchCount}
      data-activity-locators={projection.diagnostics.locatorCount}
    >
      {!user && !authLoading && (
        <div className="activity-local-notice">
          Showing activity from this device. Sign in to include other devices.
        </div>
      )}
      {user && (
        <div className="activity-toolbar">
          <DeviceFilters
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onChange={setSelectedDeviceId}
          />
          <div className="activity-refresh-status" aria-live="polite">
            <span>
              {refreshing
                ? 'Refreshing…'
                : lastRefreshedAt
                  ? `Updated ${formatTimeAgo(lastRefreshedAt)}`
                  : 'Showing cached activity'}
            </span>
            <button
              type="button"
              className="activity-refresh"
              disabled={refreshing}
              onClick={() => setRefreshNonce((value) => value + 1)}
            >
              Refresh
            </button>
          </div>
        </div>
      )}
      {error && <div className="devices-error">Could not refresh synced activity: {error}</div>}
      {groups.length === 0 ? (
        <div className="devices-empty">
          {selectedDeviceId === 'all'
            ? 'No watch activity yet. Play a video and your history will appear here.'
            : 'No watch activity for this device.'}
        </div>
      ) : (
        <>
          {inProgressGroups.length > 0 && (
            <>
              <h2 className="devices-title">Continue Watching</h2>
              <div className="season-list">
                {inProgressGroups.map((group) => (
                  <ActivityGroupCard key={group.id} group={group} />
                ))}
              </div>
            </>
          )}
          {watchedOnlyGroups.length > 0 && (
            <>
              <h2
                className="devices-title"
                style={{ marginTop: inProgressGroups.length > 0 ? '2rem' : 0 }}
              >
                Recently Watched
              </h2>
              <div className="season-list">
                {watchedOnlyGroups.map((group) => (
                  <ActivityGroupCard key={group.id} group={group} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
