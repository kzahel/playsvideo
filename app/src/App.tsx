import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { AuthButton } from './components/AuthButton.js';
import { useSetting } from './hooks/useSetting.js';
import {
  getStoredThemePreference,
  getSystemPrefersDark,
  resolveThemePreference,
  RESOLVED_THEME_STORAGE_KEY,
  THEME_PREFERENCE_KEY,
  THEME_PREFERENCE_STORAGE_KEY,
  type ThemePreference,
} from './settings.js';

export function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [themePreference] = useSetting<ThemePreference>(
    THEME_PREFERENCE_KEY,
    getStoredThemePreference(),
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };

    setSystemPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  useEffect(() => {
    const resolvedTheme = resolveThemePreference(themePreference, systemPrefersDark);
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, themePreference);
    window.localStorage.setItem(RESOLVED_THEME_STORAGE_KEY, resolvedTheme);
  }, [systemPrefersDark, themePreference]);

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
        <Link to="/" className="app-logo">
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
        </Link>
        <div className="header-actions">
          <a
            href="https://github.com/kzahel/playsvideo"
            className="github-link"
            aria-label="GitHub"
            title="GitHub"
            target="_blank"
            rel="noopener noreferrer"
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          </a>
          <AuthButton />
        </div>
      </header>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
