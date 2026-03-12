export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCE_KEY = 'ui-theme-preference';
export const THEME_PREFERENCE_STORAGE_KEY = 'pv-theme-preference';
export const RESOLVED_THEME_STORAGE_KEY = 'pv-theme';
export const PLAYER_CONTROLS_TYPE_KEY = 'pv-controls-type';

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
