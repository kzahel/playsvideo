import { VIDEOJS_CONTROLS_ENABLED } from '../../src/feature-flags.js';

export type ThemePreference = 'system' | 'light' | 'dark';
export type EmbeddedSubtitlePolicy = 'auto' | 'off';
export type PlayerControlsType = 'stock' | 'videojs';

export { VIDEOJS_CONTROLS_ENABLED };

export const THEME_PREFERENCE_KEY = 'ui-theme-preference';
export const THEME_PREFERENCE_STORAGE_KEY = 'pv-theme-preference';
export const RESOLVED_THEME_STORAGE_KEY = 'pv-theme';
export const PLAYER_CONTROLS_TYPE_KEY = 'pv-controls-type';
export const AUTOPLAY_NEXT_EPISODE_KEY = 'playback-autoplay-next-episode';
export const AUTO_RESCAN_DETAIL_PAGES_KEY = 'scan-auto-rescan-detail-pages';
export const EMBEDDED_SUBTITLE_POLICY_KEY = 'subtitle-embedded-policy';
export const CATALOG_VIEW_MODE_KEY = 'catalog-view-mode';
export type CatalogViewMode = 'card' | 'compact' | 'list';

export function normalizeCatalogViewMode(value: unknown): CatalogViewMode {
  if (value === 'compact' || value === 'list') {
    return value;
  }

  return 'card';
}

export function normalizePlayerControlsType(value: unknown): PlayerControlsType {
  if (VIDEOJS_CONTROLS_ENABLED && (value === 'videojs' || value === 'custom')) {
    return 'videojs';
  }

  return 'stock';
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function getStoredThemePreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'system';
  }

  const storedPreference = window.localStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
  if (isThemePreference(storedPreference)) {
    return storedPreference;
  }

  const legacyTheme = window.localStorage.getItem(RESOLVED_THEME_STORAGE_KEY);
  if (legacyTheme === 'light' || legacyTheme === 'dark') {
    return legacyTheme;
  }

  return 'system';
}

export function getSystemPrefersDark(): boolean {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): 'light' | 'dark' {
  if (preference === 'light' || preference === 'dark') {
    return preference;
  }

  return systemPrefersDark ? 'dark' : 'light';
}
