import { NavLink } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { getDeviceId } from '../device.js';
import { getNowPlayingView } from '../local-playback-views.js';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const deviceId = useLiveQuery(() => getDeviceId(), []);
  const nowPlaying = useLiveQuery(
    async () => {
      if (!deviceId) return null;
      const [catalogEntries, playbackEntries] = await Promise.all([
        db.catalog.toArray(),
        db.playback.where('deviceId').equals(deviceId).toArray(),
      ]);
      return getNowPlayingView({
        catalogEntries,
        playbackEntries,
      });
    },
    [deviceId],
  );

  return (
    <>
      <div className={`sidebar-overlay${open ? '' : ' hidden'}`} onClick={onClose} />
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <nav>
          <NavLink to="/" end onClick={onClose}>
            Catalog
          </NavLink>
          <NavLink to="/shows" onClick={onClose}>
            Shows
          </NavLink>
          <NavLink to="/movies" onClick={onClose}>
            Movies
          </NavLink>
          <NavLink to="/devices" onClick={onClose}>
            Devices
          </NavLink>
          <NavLink to="/settings" onClick={onClose}>
            Settings
          </NavLink>
        </nav>
        {nowPlaying && (
          <div className="sidebar-now-playing">
            <div className="sidebar-section-label">Now Playing</div>
            <NavLink to={`/play/${nowPlaying.id}`} onClick={onClose} className="sidebar-now-playing-link">
              <span className="sidebar-now-playing-name">{nowPlaying.name}</span>
              {nowPlaying.watchState === 'in-progress' && nowPlaying.durationSec > 0 && (
                <div className="sidebar-now-playing-progress">
                  <div
                    className="sidebar-now-playing-progress-bar"
                    style={{
                      width: `${Math.min(100, (nowPlaying.playbackPositionSec / nowPlaying.durationSec) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </NavLink>
          </div>
        )}
      </aside>
    </>
  );
}
