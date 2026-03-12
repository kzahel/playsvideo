import { useEffect, useState } from 'react';
import type { MetadataTransportStateEntry } from '../db.js';
import { useSetting } from '../hooks/useSetting.js';
import { refreshLibraryMetadata } from '../scan.js';
import { getMetadataTransportState } from '../metadata/client.js';
import type { MetadataRequestTier } from '../metadata/types.js';
import {
  TMDB_READ_ACCESS_TOKEN_KEY,
  TMDB_STANDBY_READ_ACCESS_TOKEN_KEY,
} from '../metadata/repository.js';

interface MetadataSettingsProps {
  hasEntries: boolean;
}

export const SHOW_METADATA_DEBUG_KEY = 'show-metadata-debug';
export const METADATA_REQUEST_TIER_KEY = 'metadata-request-tier';

export function MetadataSettings({ hasEntries }: MetadataSettingsProps) {
  const [token, setToken] = useSetting<string>(TMDB_READ_ACCESS_TOKEN_KEY, '');
  const [standbyToken, setStandbyToken] = useSetting<string>(
    TMDB_STANDBY_READ_ACCESS_TOKEN_KEY,
    '',
  );
  const [requestTier, setRequestTier] = useSetting<MetadataRequestTier>(
    METADATA_REQUEST_TIER_KEY,
    'essential',
  );
  const [showDebug, setShowDebug] = useSetting<boolean>(SHOW_METADATA_DEBUG_KEY, false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const [transportState, setTransportState] = useState<MetadataTransportStateEntry[]>([]);
  const [loadingTransportState, setLoadingTransportState] = useState(false);
  const envConfigured = Boolean(import.meta.env.VITE_TMDB_READ_ACCESS_TOKEN?.trim());
  const standbyEnvConfigured = Boolean(
    import.meta.env.VITE_TMDB_READ_ACCESS_TOKEN_STANDBY?.trim(),
  );
  const hasToken =
    token.trim().length > 0 ||
    standbyToken.trim().length > 0 ||
    envConfigured ||
    standbyEnvConfigured;

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const loadTransportState = async () => {
      setLoadingTransportState(true);
      try {
        const entries = await getMetadataTransportState();
        if (!cancelled) {
          setTransportState(entries);
        }
      } catch (error) {
        console.warn('Failed to load metadata transport state:', error);
      } finally {
        if (!cancelled) {
          setLoadingTransportState(false);
        }
      }
    };

    void loadTransportState();
    const interval = window.setInterval(() => {
      void loadTransportState();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [open]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setStatus('');
    try {
      await refreshLibraryMetadata({ force: true });
      setStatus('Metadata refreshed.');
      setTransportState(await getMetadataTransportState());
    } catch (error) {
      console.error('Failed to refresh TMDB metadata:', error);
      setStatus('Metadata refresh failed.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <details
      className="metadata-settings"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
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
        <label className="metadata-settings-label" htmlFor="tmdb-token-standby">
          TMDB Standby Read Access Token
        </label>
        <input
          id="tmdb-token-standby"
          className="metadata-settings-input"
          type="password"
          value={standbyToken}
          onChange={(event) => setStandbyToken(event.target.value)}
          placeholder={
            standbyEnvConfigured ? 'Configured via app/.env.local' : 'Optional standby token'
          }
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
        <label className="metadata-settings-label" htmlFor="metadata-request-tier">
          Request Tier
        </label>
        <select
          id="metadata-request-tier"
          className="metadata-settings-input"
          value={requestTier}
          onChange={(event) => setRequestTier(event.target.value as MetadataRequestTier)}
        >
          <option value="essential">Essential</option>
          <option value="nice-to-have">Nice to Have</option>
        </select>
        <label className="metadata-settings-checkbox">
          <input
            type="checkbox"
            checked={showDebug}
            onChange={(event) => setShowDebug(event.target.checked)}
          />
          Show metadata debug details on library cards
        </label>
        <p className="metadata-settings-note">
          `Essential` only does title matching plus show/movie-level metadata. `Nice to Have`
          also loads per-season episode metadata when you open a show.
        </p>
        <p className="metadata-settings-note">
          `app/.env.local` takes precedence over IndexedDB values. Optional standby env var:
          `VITE_TMDB_READ_ACCESS_TOKEN_STANDBY`. The coordinator prefers `primary`, cools down
          only the rate-limited slot, and falls through to `standby` when available. After
          changing tokens, click "Refresh Metadata" or rescan the folder.
        </p>
        <div className="metadata-transport-state">
          <div className="metadata-transport-state-header">
            <strong>Transport Health</strong>
            {loadingTransportState ? (
              <span className="metadata-transport-loading">Checking...</span>
            ) : null}
          </div>
          {transportState.length > 0 ? (
            <div className="metadata-transport-list">
              {transportState
                .slice()
                .sort((left, right) => left.key.localeCompare(right.key))
                .map((entry) => (
                  <div key={entry.key} className="metadata-transport-card">
                    <div className="metadata-transport-topline">
                      <span className="metadata-transport-slot">
                        {entry.credentialSlot ?? 'default'}
                      </span>
                      <span className={`metadata-transport-badge ${entry.status}`}>
                        {entry.status}
                      </span>
                    </div>
                    <div className="metadata-transport-copy">transport: {entry.transport}</div>
                    {entry.cooldownUntil ? (
                      <div className="metadata-transport-copy">
                        cooldown until: {new Date(entry.cooldownUntil).toLocaleString()}
                      </div>
                    ) : null}
                    {entry.lastError ? (
                      <div className="metadata-transport-copy metadata-transport-error">
                        last error: {entry.lastError}
                      </div>
                    ) : null}
                    <div className="metadata-transport-copy">
                      updated: {new Date(entry.updatedAt).toLocaleString()}
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="metadata-transport-empty">
              No transport activity yet. Refresh metadata to initialize transport state.
            </div>
          )}
        </div>
      </div>
    </details>
  );
}
