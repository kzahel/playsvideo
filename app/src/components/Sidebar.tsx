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
        </nav>
      </aside>
    </>
  );
}
