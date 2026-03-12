import { NavLink } from 'react-router-dom';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
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
          <NavLink to="/settings" onClick={onClose}>
            Settings
          </NavLink>
        </nav>
      </aside>
    </>
  );
}
