import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.js';
import {
  pullAllDeviceDocs,
  buildLocalSyncKeyIndex,
  type RemoteDeviceState,
  type SyncEntry,
} from '../firebase.js';
import { getDeviceId } from '../device.js';

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

function DeviceCard({
  device,
  isCurrentDevice,
  expanded,
  onToggle,
  localEntryBySyncKey,
}: {
  device: RemoteDeviceState;
  isCurrentDevice: boolean;
  expanded: boolean;
  onToggle: () => void;
  localEntryBySyncKey: Map<string, number>;
}) {
  const entries = Object.entries(device.doc.entries).sort(
    ([, a], [, b]) => b.watchedAt - a.watchedAt,
  );
  const inProgress = entries.filter(([, e]) => e.watchState === 'in-progress');
  const watched = entries.filter(([, e]) => e.watchState === 'watched');

  return (
    <div className={`device-card${isCurrentDevice ? ' device-card-current' : ''}`}>
      <button type="button" className="device-card-header" onClick={onToggle}>
        <div className="device-card-label">
          {device.doc.label}
          {isCurrentDevice && <span className="device-card-badge">This device</span>}
        </div>
        <div className="device-card-meta">
          <span>{entries.length} videos</span>
          <span className="device-card-dot" />
          <span>Synced {formatTimeAgo(device.doc.lastSyncedAt)}</span>
        </div>
        <span className={`device-card-chevron${expanded ? ' expanded' : ''}`} />
      </button>

      {!expanded && inProgress.length > 0 && (
        <div className="device-card-preview">
          {inProgress.slice(0, 3).map(([key, entry]) => (
            <DeviceEntryRow key={key} syncKey={key} entry={entry} localEntryId={localEntryBySyncKey.get(key)} compact />
          ))}
          {inProgress.length > 3 && (
            <div className="device-card-more">+{inProgress.length - 3} more in progress</div>
          )}
        </div>
      )}

      {expanded && (
        <div className="device-card-entries">
          {inProgress.length > 0 && (
            <div className="device-entries-section">
              <div className="device-entries-section-label">In Progress ({inProgress.length})</div>
              {inProgress.map(([key, entry]) => (
                <DeviceEntryRow key={key} syncKey={key} entry={entry} localEntryId={localEntryBySyncKey.get(key)} />
              ))}
            </div>
          )}
          {watched.length > 0 && (
            <div className="device-entries-section">
              <div className="device-entries-section-label">Watched ({watched.length})</div>
              {watched.map(([key, entry]) => (
                <DeviceEntryRow key={key} syncKey={key} entry={entry} localEntryId={localEntryBySyncKey.get(key)} />
              ))}
            </div>
          )}
          {entries.length === 0 && (
            <div className="device-card-empty">No watch history on this device.</div>
          )}
        </div>
      )}
    </div>
  );
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
  syncKey,
  entry,
  compact,
  localEntryId,
}: {
  syncKey: string;
  entry: SyncEntry;
  compact?: boolean;
  localEntryId?: number;
}) {
  const title = formatEntryTitle(syncKey, entry);
  const progress =
    entry.durationSec > 0 ? (entry.position) / entry.durationSec : 0;
  const remaining =
    entry.durationSec > 0 ? entry.durationSec - (entry.position) : 0;

  const content = (
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
  );

  const className = `device-entry${compact ? ' device-entry-compact' : ''}`;

  if (localEntryId != null) {
    return (
      <Link to={`/play/${localEntryId}`} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}

export function Devices() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<RemoteDeviceState[] | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [localEntryBySyncKey, setLocalEntryBySyncKey] = useState<Map<string, number>>(new Map());
  const [expandedDevice, setExpandedDevice] = useState<string | null>(null);
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
        const [devId, docs, keyIndex] = await Promise.all([getDeviceId(), pullAllDeviceDocs(user!.uid), buildLocalSyncKeyIndex()]);
        if (cancelled) return;
        setCurrentDeviceId(devId);
        setLocalEntryBySyncKey(keyIndex);
        // Sort: current device first, then by lastSyncedAt descending
        docs.sort((a, b) => {
          if (a.deviceId === devId) return -1;
          if (b.deviceId === devId) return 1;
          return b.doc.lastSyncedAt - a.doc.lastSyncedAt;
        });
        setDevices(docs);
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

  if (error) {
    return (
      <div className="devices-page">
        <div className="devices-error">Failed to load devices: {error}</div>
      </div>
    );
  }

  if (!devices || devices.length === 0) {
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
      <h2 className="devices-title">Devices</h2>
      <div className="devices-list">
        {devices.map((device) => (
          <DeviceCard
            key={device.deviceId}
            device={device}
            isCurrentDevice={device.deviceId === currentDeviceId}
            expanded={expandedDevice === device.deviceId}
            onToggle={() =>
              setExpandedDevice((prev) => (prev === device.deviceId ? null : device.deviceId))
            }
            localEntryBySyncKey={localEntryBySyncKey}
          />
        ))}
      </div>
    </div>
  );
}
