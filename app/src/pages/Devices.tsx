import { useEffect, useMemo, useState } from 'react';
import type { ActivityFact } from '../activity/activity-view.js';
import { PlaybackHandoffActions } from '../components/PlaybackHandoffActions.js';
import { getDeviceId, getDeviceLabel } from '../device.js';
import {
  projectLogicalDevices,
  type DeviceClient,
  type LogicalDevice,
} from '../device-groups.js';
import { useAuth } from '../hooks/useAuth.js';
import {
  forgetDeviceClient,
  pullAndCacheDeviceSyncState,
  saveLogicalDeviceGroup,
  setDeviceClientStatus,
  type RemoteDeviceSyncState,
  type RemoteDeviceState,
  type SyncEntry,
} from '../firebase.js';
import { reconcilePendingHandoffs } from '../handoff/pending-handoffs.js';
import {
  loadLocalPlaybackTargetIndex,
  resolveLocalPlaybackTarget,
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

function watchStateBadge(state: string): string {
  switch (state) {
    case 'watched':
      return 'Watched';
    case 'in-progress':
      return 'In Progress';
    default:
      return '';
  }
}

function formatEpisodeTag(seasonNumber?: number, episodeNumber?: number): string {
  if (seasonNumber == null && episodeNumber == null) return '';
  const s = seasonNumber != null ? `S${String(seasonNumber).padStart(2, '0')}` : '';
  const e = episodeNumber != null ? `E${String(episodeNumber).padStart(2, '0')}` : '';
  return ` ${s}${e}`;
}

function formatEntryTitle(syncKey: string, entry: SyncEntry): string {
  const base = entry.title ?? syncKey;
  // Extract episode info from sync key like "tmdb:tv:73586:s01:e03"
  const tvMatch = syncKey.match(/^tmdb:tv:\d+:s(\d+):e(\d+(?:-\d+)?)$/);
  if (tvMatch) {
    const season = Number(tvMatch[1]);
    const episode = tvMatch[2];
    return `${base} S${String(season).padStart(2, '0')}E${episode.includes('-') ? episode : String(Number(episode)).padStart(2, '0')}`;
  }
  // Use synced season/episode fields
  if (entry.seasonNumber != null || entry.episodeNumber != null) {
    return `${base}${formatEpisodeTag(entry.seasonNumber, entry.episodeNumber)}`;
  }
  // For file-based keys, show the filename
  const fileMatch = syncKey.match(/^file:(.+)\|/);
  if (fileMatch && !entry.title) {
    return fileMatch[1];
  }
  return base;
}

function DeviceEntryRow({
  device,
  syncKey,
  entry,
  compact,
  localTargetIndex,
}: {
  device: RemoteDeviceState;
  syncKey: string;
  entry: SyncEntry;
  compact?: boolean;
  localTargetIndex: LocalPlaybackTargetIndex;
}) {
  const title = formatEntryTitle(syncKey, entry);
  const progress =
    entry.durationSec > 0 ? (entry.position) / entry.durationSec : 0;
  const remaining =
    entry.durationSec > 0 ? entry.durationSec - (entry.position) : 0;

  const fact: ActivityFact = {
    deviceId: device.deviceId,
    deviceLabel: device.doc.label,
    deviceLastSyncedAt: device.doc.lastSyncedAt,
    playbackKey: syncKey,
    positionSec: entry.position,
    durationSec: entry.durationSec,
    watchState: entry.watchState,
    lastPlayedAt: entry.watchedAt,
    title: entry.title,
    seasonNumber: entry.seasonNumber,
    episodeNumber: entry.episodeNumber,
    contentHash: entry.contentHash,
    torrentInfoHash: entry.torrentInfoHash,
    torrentFileIndex: entry.torrentFileIndex,
    torrentMagnetUrl: entry.torrentMagnetUrl,
    torrentComplete: entry.torrentComplete,
    tmdbId: entry.tmdbId,
    tmdbMediaType: entry.tmdbMediaType,
  };
  const resolution = resolveLocalPlaybackTarget(localTargetIndex, fact);
  const localTarget = resolution.status === 'resolved' ? resolution.target : undefined;

  return (
    <div className={`device-entry${compact ? ' device-entry-compact' : ''}`}>
      <>
      <div className="device-entry-info">
        <span className="device-entry-title">{title}</span>
        <span className="device-entry-meta">
          {entry.watchState === 'in-progress' && remaining > 0 && (
            <>{formatDuration(remaining)} remaining</>
          )}
          {entry.watchState === 'watched' && watchStateBadge(entry.watchState)}
          {entry.watchedAt > 0 && (
            <>
              {' '}
              &middot; {formatTimeAgo(entry.watchedAt)}
            </>
          )}
        </span>
      </div>
      {entry.watchState === 'in-progress' && entry.durationSec > 0 && (
        <div className="device-entry-progress">
          <div
            className="device-entry-progress-bar"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
      )}
      {entry.torrentInfoHash && (
        <span className="device-entry-torrent" title={`Torrent: ${entry.torrentInfoHash}`}>
          T
        </span>
      )}
      </>
      <PlaybackHandoffActions
        fact={fact}
        localTarget={localTarget}
        ambiguous={resolution.status === 'ambiguous'}
        compact={compact}
      />
    </div>
  );
}

function shortClientId(deviceId: string): string {
  return deviceId.slice(0, 8);
}

function clientContextLabel(client: DeviceClient): string {
  if (client.kind === 'extension') return 'Chrome extension';
  return client.origin ?? 'Origin unknown';
}

function ClientPlaybackEntries({
  client,
  localTargetIndex,
}: {
  client: DeviceClient;
  localTargetIndex: LocalPlaybackTargetIndex;
}) {
  if (!client.syncDoc) {
    return <div className="device-card-empty">No synced playback snapshot.</div>;
  }

  const device: RemoteDeviceState = { deviceId: client.deviceId, doc: client.syncDoc };
  const entries = Object.entries(client.syncDoc.entries).sort(
    ([, left], [, right]) => right.watchedAt - left.watchedAt,
  );
  const inProgress = entries.filter(([, entry]) => entry.watchState === 'in-progress');
  const watched = entries.filter(([, entry]) => entry.watchState === 'watched');

  if (entries.length === 0) {
    return <div className="device-card-empty">No watch history from this client.</div>;
  }

  return (
    <div className="device-client-playback">
      {inProgress.length > 0 && (
        <div className="device-entries-section">
          <div className="device-entries-section-label">In Progress ({inProgress.length})</div>
          {inProgress.map(([key, entry]) => (
            <DeviceEntryRow
              key={key}
              device={device}
              syncKey={key}
              entry={entry}
              localTargetIndex={localTargetIndex}
            />
          ))}
        </div>
      )}
      {watched.length > 0 && (
        <div className="device-entries-section">
          <div className="device-entries-section-label">Watched ({watched.length})</div>
          {watched.map(([key, entry]) => (
            <DeviceEntryRow
              key={key}
              device={device}
              syncKey={key}
              entry={entry}
              localTargetIndex={localTargetIndex}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DeviceClientPanel({
  client,
  canSplit,
  busy,
  localTargetIndex,
  onSplit,
  onSetStatus,
  onForget,
}: {
  client: DeviceClient;
  canSplit: boolean;
  busy: boolean;
  localTargetIndex: LocalPlaybackTargetIndex;
  onSplit: (client: DeviceClient) => Promise<void>;
  onSetStatus: (client: DeviceClient, status: 'active' | 'archived') => Promise<void>;
  onForget: (client: DeviceClient) => Promise<void>;
}) {
  const [confirmingForget, setConfirmingForget] = useState(false);
  const entryCount = Object.keys(client.syncDoc?.entries ?? {}).length;

  return (
    <section className={`device-client device-client-${client.status}`}>
      <div className="device-client-heading">
        <div>
          <div className="device-client-title">
            {client.generatedLabel}
            {client.isCurrent && <span className="device-card-badge">Current client</span>}
            {client.status !== 'active' && (
              <span className="device-client-status">{client.status}</span>
            )}
          </div>
          <div className="device-client-context">
            <span>{clientContextLabel(client)}</span>
            {client.channel === 'development' && <span>Development</span>}
            {client.isLegacy && <span>Legacy</span>}
            <span title={client.deviceId}>ID {shortClientId(client.deviceId)}</span>
            {client.lastSeenAt > 0 && <span>Seen {formatTimeAgo(client.lastSeenAt)}</span>}
          </div>
        </div>
        <div className="device-client-actions">
          {canSplit && client.status !== 'forgotten' && (
            <button type="button" disabled={busy} onClick={() => void onSplit(client)}>
              Split
            </button>
          )}
          {client.status === 'active' && !client.isCurrent && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onSetStatus(client, 'archived')}
            >
              Archive
            </button>
          )}
          {client.status !== 'active' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onSetStatus(client, 'active')}
            >
              Restore
            </button>
          )}
          {!client.isCurrent && client.status !== 'forgotten' && !confirmingForget && (
            <button
              type="button"
              className="device-client-danger"
              disabled={busy}
              onClick={() => setConfirmingForget(true)}
            >
              Forget
            </button>
          )}
        </div>
      </div>
      {confirmingForget && (
        <div className="device-client-confirm">
          <span>Remove this client’s synced playback history?</span>
          <button
            type="button"
            className="device-client-danger"
            disabled={busy}
            onClick={() => {
              void onForget(client).then(() => setConfirmingForget(false));
            }}
          >
            Confirm forget
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirmingForget(false)}>
            Cancel
          </button>
        </div>
      )}
      <details className="device-client-details">
        <summary>{entryCount} synced {entryCount === 1 ? 'video' : 'videos'}</summary>
        <ClientPlaybackEntries client={client} localTargetIndex={localTargetIndex} />
      </details>
    </section>
  );
}

function LogicalDeviceCard({
  device,
  allDevices,
  expanded,
  busy,
  localTargetIndex,
  onToggle,
  onRename,
  onMerge,
  onSplit,
  onSetStatus,
  onForget,
}: {
  device: LogicalDevice;
  allDevices: LogicalDevice[];
  expanded: boolean;
  busy: boolean;
  localTargetIndex: LocalPlaybackTargetIndex;
  onToggle: () => void;
  onRename: (device: LogicalDevice, name: string) => Promise<void>;
  onMerge: (source: LogicalDevice, target: LogicalDevice) => Promise<void>;
  onSplit: (client: DeviceClient) => Promise<void>;
  onSetStatus: (client: DeviceClient, status: 'active' | 'archived') => Promise<void>;
  onForget: (client: DeviceClient) => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(device.name);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const entryCount = device.clients.reduce(
    (count, client) => count + Object.keys(client.syncDoc?.entries ?? {}).length,
    0,
  );
  const mergeTargets = allDevices.filter((candidate) => candidate.id !== device.id);

  return (
    <div className={`device-card${device.isCurrent ? ' device-card-current' : ''}`}>
      <button type="button" className="device-card-header" onClick={onToggle}>
        <div className="device-card-label">
          {device.name}
          {device.isCurrent && <span className="device-card-badge">This device</span>}
        </div>
        <div className="device-card-meta">
          <span>
            {device.clients.length} {device.clients.length === 1 ? 'client' : 'clients'}
          </span>
          <span className="device-card-dot" />
          <span>{entryCount} videos</span>
          {device.lastSeenAt > 0 && (
            <>
              <span className="device-card-dot" />
              <span>Seen {formatTimeAgo(device.lastSeenAt)}</span>
            </>
          )}
        </div>
        <span className={`device-card-chevron${expanded ? ' expanded' : ''}`} />
      </button>

      {expanded && (
        <div className="device-card-entries">
          <div className="device-group-actions">
            {renaming ? (
              <form
                className="device-group-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void onRename(device, draftName);
                }}
              >
                <input
                  aria-label={`Name for ${device.name}`}
                  value={draftName}
                  disabled={busy}
                  onChange={(event) => setDraftName(event.target.value)}
                />
                <button type="submit" disabled={busy || !draftName.trim()}>
                  Save
                </button>
                <button type="button" disabled={busy} onClick={() => setRenaming(false)}>
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDraftName(device.name);
                  setRenaming(true);
                }}
              >
                Rename device
              </button>
            )}
            {mergeTargets.length > 0 && (
              <form
                className="device-group-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const target = mergeTargets.find((candidate) => candidate.id === mergeTargetId);
                  if (target) void onMerge(device, target);
                }}
              >
                <select
                  aria-label={`Merge ${device.name} into another device`}
                  value={mergeTargetId}
                  disabled={busy}
                  onChange={(event) => setMergeTargetId(event.target.value)}
                >
                  <option value="">Merge into…</option>
                  {mergeTargets.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                </select>
                <button type="submit" disabled={busy || !mergeTargetId}>
                  Merge
                </button>
              </form>
            )}
          </div>
          <div className="device-clients-list">
            {device.clients.map((client) => (
              <DeviceClientPanel
                key={client.deviceId}
                client={client}
                canSplit={device.clients.length > 1}
                busy={busy}
                localTargetIndex={localTargetIndex}
                onSplit={onSplit}
                onSetStatus={onSetStatus}
                onForget={onForget}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Devices() {
  const { user } = useAuth();
  const [syncState, setSyncState] = useState<RemoteDeviceSyncState | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [currentDeviceLabel, setCurrentDeviceLabel] = useState<string | null>(null);
  const [localTargetIndex, setLocalTargetIndex] = useState<LocalPlaybackTargetIndex | null>(null);
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [managing, setManaging] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const activeDevices = useMemo(
    () =>
      syncState
        ? projectLogicalDevices({
            devices: syncState.devices,
            registry: syncState.registry,
            currentDeviceId: currentDeviceId ?? undefined,
            currentDeviceLabel: currentDeviceLabel ?? undefined,
          })
        : [],
    [currentDeviceId, currentDeviceLabel, syncState],
  );
  const allDevices = useMemo(
    () =>
      syncState
        ? projectLogicalDevices({
            devices: syncState.devices,
            registry: syncState.registry,
            currentDeviceId: currentDeviceId ?? undefined,
            currentDeviceLabel: currentDeviceLabel ?? undefined,
            includeHidden: true,
          })
        : [],
    [currentDeviceId, currentDeviceLabel, syncState],
  );
  const hiddenClientCount = allDevices
    .flatMap((device) => device.clients)
    .filter((client) => client.status !== 'active').length;
  const displayedDevices = showHidden ? allDevices : activeDevices;

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function load() {
      setError(null);
      setRefreshing(true);
      try {
        const [devId, devLabel, state, targetIndex] = await Promise.all([
          getDeviceId(),
          getDeviceLabel(),
          pullAndCacheDeviceSyncState(user!.uid),
          loadLocalPlaybackTargetIndex(),
        ]);
        if (cancelled) return;
        await reconcilePendingHandoffs(targetIndex);
        if (cancelled) return;
        setCurrentDeviceId(devId);
        setCurrentDeviceLabel(devLabel);
        setLocalTargetIndex(targetIndex);
        setSyncState(state);
        setLastRefreshedAt(Date.now());
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user, refreshNonce]);

  async function runManagement(action: () => Promise<void>): Promise<void> {
    setManaging(true);
    setError(null);
    try {
      await action();
      setRefreshNonce((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setManaging(false);
    }
  }

  async function renameDevice(device: LogicalDevice, name: string): Promise<void> {
    if (!user) return;
    const completeDevice = allDevices.find((candidate) => candidate.id === device.id) ?? device;
    await runManagement(async () => {
      await saveLogicalDeviceGroup({
        uid: user.uid,
        groupId: completeDevice.groupId ?? completeDevice.id,
        name,
        clients: completeDevice.clients,
      });
    });
  }

  async function mergeDevices(source: LogicalDevice, target: LogicalDevice): Promise<void> {
    if (!user) return;
    const completeSource = allDevices.find((candidate) => candidate.id === source.id) ?? source;
    const completeTarget = allDevices.find((candidate) => candidate.id === target.id) ?? target;
    await runManagement(async () => {
      await saveLogicalDeviceGroup({
        uid: user.uid,
        groupId: completeTarget.groupId ?? completeTarget.id,
        name: completeTarget.name,
        clients: [...completeTarget.clients, ...completeSource.clients],
        deleteGroupIds: completeSource.groupId ? [completeSource.groupId] : undefined,
      });
    });
  }

  async function splitClient(client: DeviceClient): Promise<void> {
    if (!user) return;
    await runManagement(async () => {
      await saveLogicalDeviceGroup({
        uid: user.uid,
        name: `${client.generatedLabel} · ${client.origin ?? shortClientId(client.deviceId)}`,
        clients: [client],
      });
    });
  }

  async function updateClientStatus(
    client: DeviceClient,
    status: 'active' | 'archived',
  ): Promise<void> {
    if (!user) return;
    await runManagement(async () => {
      await setDeviceClientStatus({ uid: user.uid, client, status });
    });
  }

  async function forgetClient(client: DeviceClient): Promise<void> {
    if (!user) return;
    await runManagement(async () => {
      await forgetDeviceClient({ uid: user.uid, client });
    });
  }

  if (!user) {
    return (
      <div className="devices-page">
        <div className="devices-sign-in">Sign in to see your synced devices.</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="devices-page">
        <div className="devices-loading">Loading devices...</div>
      </div>
    );
  }

  if (error && !syncState) {
    return (
      <div className="devices-page">
        <div className="devices-error">Failed to load devices: {error}</div>
      </div>
    );
  }

  if (!syncState || allDevices.length === 0 || !localTargetIndex) {
    return (
      <div className="devices-page">
        <div className="devices-empty">
          No device sync data yet. Play a video and your watch history will appear here.
        </div>
      </div>
    );
  }

  return (
    <div className="devices-page">
      <div className="devices-heading">
        <div>
          <h2 className="devices-title">Devices</h2>
          <p className="devices-description">
            Browser clients are grouped into devices without merging their playback data.
          </p>
        </div>
        <div className="activity-refresh-status" aria-live="polite">
          <span>
            {refreshing
              ? 'Refreshing…'
              : lastRefreshedAt
                ? `Updated ${formatTimeAgo(lastRefreshedAt)}`
                : ''}
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
      {error && <div className="devices-error">Could not refresh devices: {error}</div>}
      {hiddenClientCount > 0 && (
        <button
          type="button"
          className="devices-hidden-toggle"
          onClick={() => setShowHidden((value) => !value)}
        >
          {showHidden ? 'Hide archived clients' : `Show hidden clients (${hiddenClientCount})`}
        </button>
      )}
      <div className="devices-list">
        {displayedDevices.map((device) => (
          <LogicalDeviceCard
            key={device.id}
            device={device}
            allDevices={displayedDevices}
            expanded={expandedDevice === device.id}
            busy={managing}
            onToggle={() =>
              setExpandedDevice((previous) => (previous === device.id ? null : device.id))
            }
            localTargetIndex={localTargetIndex}
            onRename={renameDevice}
            onMerge={mergeDevices}
            onSplit={splitClient}
            onSetStatus={updateClientStatus}
            onForget={forgetClient}
          />
        ))}
      </div>
    </div>
  );
}
