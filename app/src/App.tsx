import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('pv-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pv-theme', theme);
  }, [theme]);

  return (
    <div className="app-layout">
      <header className="app-header">
        <button
          className="hamburger"
          onClick={() => setSidebarOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          &#9776;
        </button>
        <a href="/" className="app-logo">
          <svg width="200" height="32" viewBox="0 0 340 48">
            <polygon points="2,4 2,44 32,24" fill="currentColor" />
            <text
              x="44"
              y="38"
              fontFamily="'Inter', sans-serif"
              fontWeight="700"
              fontSize="38"
              fill="currentColor"
              letterSpacing="-2"
            >
              plays
            </text>
            <text
              x="164"
              y="38"
              fontFamily="'Inter', sans-serif"
              fontWeight="300"
              fontSize="38"
              fill="currentColor"
              letterSpacing="-2"
            >
              video
            </text>
          </svg>
        </a>
        <button
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '\u2600' : '\u263E'}
        </button>
      </header>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
