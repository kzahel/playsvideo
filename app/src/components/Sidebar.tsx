import { NavLink } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const nowPlaying = useLiveQuery(
    () =>
      db.library
        .where('lastPlayedAt')
        .above(0)
        .reverse()
        .sortBy('lastPlayedAt')
        .then((entries) => entries[0] ?? null),
  );

  return (
    <>
      <div className={`sidebar-overlay${open ? '' : ' hidden'}`} onClick={onClose} />
      <aside className={`sidebar${open ? ' open' : ''}`}>
        <nav>
          <NavLink to="/" end onClick={onClose}>
            Library
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
