import { useState } from 'react';
import { useSetting } from '../hooks/useSetting.js';
import { refreshLibraryMetadata } from '../scan.js';
import { TMDB_READ_ACCESS_TOKEN_KEY } from '../metadata/client.js';

interface MetadataSettingsProps {
  hasEntries: boolean;
}

export const SHOW_METADATA_DEBUG_KEY = 'show-metadata-debug';

export function MetadataSettings({ hasEntries }: MetadataSettingsProps) {
  const [token, setToken] = useSetting<string>(TMDB_READ_ACCESS_TOKEN_KEY, '');
  const [showDebug, setShowDebug] = useSetting<boolean>(SHOW_METADATA_DEBUG_KEY, false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');
  const envConfigured = Boolean(import.meta.env.VITE_TMDB_READ_ACCESS_TOKEN?.trim());
  const hasToken = token.trim().length > 0 || envConfigured;

  const handleRefresh = async () => {
    setRefreshing(true);
    setStatus('');
    try {
      await refreshLibraryMetadata({ force: true });
      setStatus('Metadata refreshed.');
    } catch (error) {
      console.error('Failed to refresh TMDB metadata:', error);
      setStatus('Metadata refresh failed.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <details className="metadata-settings">
      <summary>Metadata Enrichment</summary>
      <div className="metadata-settings-body">
        <p className="metadata-settings-copy">
          Parses TV episode names like "Yellowstone S01E07" and can enrich them with TMDB series
          artwork and metadata. For local config, put `VITE_TMDB_READ_ACCESS_TOKEN` in
          `app/.env.local`.
        </p>
        <label className="metadata-settings-label" htmlFor="tmdb-token">
          TMDB API Read Access Token
        </label>
        <input
          id="tmdb-token"
          className="metadata-settings-input"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={envConfigured ? 'Configured via app/.env.local' : 'Paste token'}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="metadata-settings-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleRefresh}
            disabled={!hasEntries || !hasToken || refreshing}
          >
            {refreshing ? 'Refreshing...' : 'Refresh Metadata'}
          </button>
          {status ? <span className="metadata-settings-status">{status}</span> : null}
        </div>
        <label className="metadata-settings-checkbox">
          <input
            type="checkbox"
            checked={showDebug}
            onChange={(event) => setShowDebug(event.target.checked)}
          />
          Show metadata debug details on library cards
        </label>
        <p className="metadata-settings-note">
          `app/.env.local` takes precedence over the value stored in IndexedDB. For this
          client-only prototype, the token is visible to the browser runtime. After changing the
          token, click "Refresh Metadata" or rescan the folder.
        </p>
      </div>
    </details>
  );
}
