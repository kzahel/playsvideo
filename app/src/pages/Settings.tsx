import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { MetadataSettings } from '../components/MetadataSettings.js';
import { db } from '../db.js';
import { useSetting } from '../hooks/useSetting.js';
import {
  METADATA_REQUEST_TIER_KEY,
  TMDB_REQUESTS_ENABLED_KEY,
} from '../metadata/settings.js';
import { invalidateMetadata } from '../metadata/client.js';
import type { MetadataRequestTier } from '../metadata/types.js';
import {
  AUTO_RESCAN_DETAIL_PAGES_KEY,
  EMBEDDED_SUBTITLE_POLICY_KEY,
  getStoredThemePreference,
  type EmbeddedSubtitlePolicy,
  PLAYER_CONTROLS_TYPE_KEY,
  type ThemePreference,
  THEME_PREFERENCE_KEY,
} from '../settings.js';

export function Settings() {
  const entryCount = useLiveQuery(() => db.library.count());
  const [themePreference, setThemePreference] = useSetting<ThemePreference>(
    THEME_PREFERENCE_KEY,
    getStoredThemePreference(),
  );
  const [controlsType, setControlsType] = useSetting<'stock' | 'custom'>(
    PLAYER_CONTROLS_TYPE_KEY,
    'stock',
  );
  const [embeddedSubtitlePolicy, setEmbeddedSubtitlePolicy] = useSetting<EmbeddedSubtitlePolicy>(
    EMBEDDED_SUBTITLE_POLICY_KEY,
    'auto',
  );
  const [autoRescanDetailPages, setAutoRescanDetailPages] = useSetting<boolean>(
    AUTO_RESCAN_DETAIL_PAGES_KEY,
    true,
  );
  const [tmdbRequestsEnabled, setTmdbRequestsEnabled] = useSetting<boolean>(
    TMDB_REQUESTS_ENABLED_KEY,
    true,
  );
  const [requestTier] = useSetting<MetadataRequestTier>(METADATA_REQUEST_TIER_KEY, 'essential');
  const [clearingMetadataCache, setClearingMetadataCache] = useState(false);
  const [cacheStatus, setCacheStatus] = useState('');

  const handleClearMetadataCache = async () => {
    setClearingMetadataCache(true);
    setCacheStatus('');
    try {
      await invalidateMetadata();
      setCacheStatus('Metadata cache cleared.');
    } catch (error) {
      setCacheStatus(error instanceof Error ? error.message : 'Failed to clear metadata cache.');
    } finally {
      setClearingMetadataCache(false);
    }
  };

  return (
    <div className="settings-page">
      <div className="settings-hero">
        <h1>Settings</h1>
        <p>
          Control the app&apos;s appearance, playback UI, and whether filename-derived metadata
          lookups are allowed to leave the browser.
        </p>
      </div>

      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h2>Appearance</h2>
            <p className="settings-card-copy">Choose how the app theme should be resolved.</p>
          </div>
        </div>
        <label className="metadata-settings-label" htmlFor="theme-preference">
          Theme
        </label>
        <select
          id="theme-preference"
          className="metadata-settings-input"
          value={themePreference}
          onChange={(event) => setThemePreference(event.target.value as ThemePreference)}
        >
          <option value="system">Default to System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h2>Playback</h2>
            <p className="settings-card-copy">Set which control overlay the player should use.</p>
          </div>
        </div>
        <label className="metadata-settings-label" htmlFor="player-controls-preference">
          Player controls
        </label>
        <select
          id="player-controls-preference"
          className="metadata-settings-input"
          value={controlsType}
          onChange={(event) => setControlsType(event.target.value as 'stock' | 'custom')}
        >
          <option value="stock">Native browser controls</option>
          <option value="custom">Custom controls</option>
        </select>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h2>Subtitles</h2>
            <p className="settings-card-copy">
              Choose whether embedded subtitle tracks should be shown automatically.
            </p>
          </div>
        </div>
        <label className="metadata-settings-label" htmlFor="embedded-subtitle-policy">
          Embedded subtitle default
        </label>
        <select
          id="embedded-subtitle-policy"
          className="metadata-settings-input"
          value={embeddedSubtitlePolicy}
          onChange={(event) =>
            setEmbeddedSubtitlePolicy(event.target.value as EmbeddedSubtitlePolicy)
          }
        >
          <option value="auto">Auto-show first embedded track</option>
          <option value="off">Keep embedded subtitles off by default</option>
        </select>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h2>Scanning</h2>
            <p className="settings-card-copy">
              Control whether show and movie pages automatically refresh local folder contents.
            </p>
          </div>
        </div>
        <label className="metadata-settings-checkbox">
          <input
            type="checkbox"
            checked={autoRescanDetailPages}
            onChange={(event) => setAutoRescanDetailPages(event.target.checked)}
          />
          Automatically rescan folders when opening show and movie pages
        </label>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h2>Privacy</h2>
            <p className="settings-card-copy">
              Decide whether parsed titles from your local files can be sent to TMDB.
            </p>
          </div>
        </div>
        <label className="metadata-settings-checkbox">
          <input
            type="checkbox"
            checked={tmdbRequestsEnabled}
            onChange={(event) => setTmdbRequestsEnabled(event.target.checked)}
          />
          Allow TMDB metadata requests
        </label>
        <p className="metadata-settings-note">
          When disabled, scans and metadata refreshes stay local and do not send filename-derived
          lookups to TMDB. Existing cached metadata remains on this device.
        </p>
        <p className="metadata-settings-note">
          Request tier is currently set to `{requestTier === 'nice-to-have' ? 'Nice to Have' : 'Essential'}`.
        </p>
      </section>

      <section className="settings-card">
        <div className="settings-card-header">
          <div>
            <h2>Cache</h2>
            <p className="settings-card-copy">
              Clear cached TMDB metadata and derived metadata state without removing your library.
            </p>
          </div>
        </div>
        <div className="settings-card-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleClearMetadataCache()}
            disabled={clearingMetadataCache}
          >
            {clearingMetadataCache ? 'Clearing Cache...' : 'Clear Metadata Cache'}
          </button>
          {cacheStatus ? <span className="metadata-settings-status">{cacheStatus}</span> : null}
        </div>
        <p className="metadata-settings-note">
          This clears cached TMDB show/movie matches, season data, transport state, and parsed
          filename cache. It does not remove watched progress or scanned library entries.
        </p>
      </section>

      <MetadataSettings
        hasEntries={(entryCount ?? 0) > 0}
        requestsEnabled={tmdbRequestsEnabled}
      />
    </div>
  );
}
