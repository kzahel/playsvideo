import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type CatalogEntry } from '../db';
import { getDeviceId } from '../device.js';
import { useEngine } from '../hooks/useEngine';
import { folderProvider, type SiblingSubtitleFile } from '../folder-provider.js';
import { useSetting } from '../hooks/useSetting';
import { useCustomControls } from '../hooks/useCustomControls';
import { useFullscreen } from '../hooks/useFullscreen';
import { getLocalPlayback } from '../local-playback.js';
import { AUTOPLAY_NEXT_EPISODE_KEY, PLAYER_CONTROLS_TYPE_KEY } from '../settings.js';

const PLAYER_QUERY_PENDING = Symbol('player-query-pending');

function buildSeriesIdentity(entry: CatalogEntry): string | null {
  if (entry.detectedMediaType !== 'tv' || !entry.parsedTitle) {
    return null;
  }

  if (entry.seriesMetadataKey) {
    return entry.seriesMetadataKey;
  }

  return `tv-local:${entry.parsedTitle}:${entry.parsedYear ?? ''}`;
}

function compareEpisodeEntries(left: CatalogEntry, right: CatalogEntry): number {
  const leftSeason = left.seasonNumber ?? Number.MAX_SAFE_INTEGER;
  const rightSeason = right.seasonNumber ?? Number.MAX_SAFE_INTEGER;
  if (leftSeason !== rightSeason) {
    return leftSeason - rightSeason;
  }

  const leftEpisode = left.episodeNumber ?? Number.MAX_SAFE_INTEGER;
  const rightEpisode = right.episodeNumber ?? Number.MAX_SAFE_INTEGER;
  if (leftEpisode !== rightEpisode) {
    return leftEpisode - rightEpisode;
  }

  const leftEnding = left.endingEpisodeNumber ?? left.episodeNumber ?? Number.MAX_SAFE_INTEGER;
  const rightEnding = right.endingEpisodeNumber ?? right.episodeNumber ?? Number.MAX_SAFE_INTEGER;
  if (leftEnding !== rightEnding) {
    return leftEnding - rightEnding;
  }

  return left.id - right.id;
}

function formatEpisodeCode(entry: CatalogEntry): string {
  if (entry.seasonNumber == null || entry.episodeNumber == null) {
    return entry.name;
  }

  const prefix = `S${String(entry.seasonNumber).padStart(2, '0')}E${String(
    entry.episodeNumber,
  ).padStart(2, '0')}`;
  if (
    entry.endingEpisodeNumber != null &&
    entry.endingEpisodeNumber > entry.episodeNumber
  ) {
    return `${prefix}-E${String(entry.endingEpisodeNumber).padStart(2, '0')}`;
  }

  return prefix;
}

function missingMessage(entry: CatalogEntry): string {
  if (entry.torrentComplete === false) {
    return 'Download is incomplete in JSTorrent.';
  }
  if (entry.torrentMagnetUrl) {
    return 'This item is in your catalog but is not currently available locally.';
  }
  return 'This item is in your catalog but the local file is currently missing.';
}

export function Player() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const entryId = Number(id);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [siblingSubtitles, setSiblingSubtitles] = useState<SiblingSubtitleFile[]>([]);
  const [loadingSiblingSubtitles, setLoadingSiblingSubtitles] = useState(false);
  const [siblingSubtitleStatus, setSiblingSubtitleStatus] = useState('');
  const [controlsType, setControlsType] = useSetting<'stock' | 'custom'>(
    PLAYER_CONTROLS_TYPE_KEY,
    'stock',
  );
  const [autoplayNextEpisode] = useSetting<boolean>(AUTOPLAY_NEXT_EPISODE_KEY, false);
  const routeEntry =
    location.state &&
    typeof location.state === 'object' &&
    'entry' in location.state &&
    (location.state.entry as CatalogEntry | null)?.id === entryId
      ? (location.state.entry as CatalogEntry)
      : null;

  const entry = useLiveQuery(
    async () => (await db.catalog.get(entryId)) ?? null,
    [entryId],
    PLAYER_QUERY_PENDING,
  );
  const entries = useLiveQuery(() => db.catalog.toArray(), [], []);
  const deviceId = useLiveQuery(() => getDeviceId(), [], PLAYER_QUERY_PENDING);
  const resolvedEntry = entry === PLAYER_QUERY_PENDING ? routeEntry : entry;
  const resolvedDeviceId = deviceId === PLAYER_QUERY_PENDING ? null : deviceId;
  const playbackKey = resolvedEntry?.canonicalPlaybackKey ?? null;
  const localPlayback = useLiveQuery(
    () =>
      resolvedDeviceId && playbackKey
        ? getLocalPlayback(resolvedDeviceId, playbackKey)
        : Promise.resolve(null),
    [resolvedDeviceId, playbackKey],
    null,
  );
  const {
    videoRef,
    status,
    phase,
    hasEnded,
    needsPermission,
    retryPermission,
    subtitleStatus,
    loadSubtitleFile,
    clearExternalSubtitles,
    copyDiagnostics,
    diagnosticsStatus,
  } =
    useEngine(
      resolvedEntry &&
        resolvedEntry.hasLocalFile !== false
        ? {
            kind: 'entry',
            entry: resolvedEntry,
            playback: localPlayback ?? null,
            playbackTarget:
              resolvedDeviceId && playbackKey
                ? {
                    deviceId: resolvedDeviceId,
                    playbackKey,
                  }
                : null,
          }
        : null,
    );
  useCustomControls(videoRef, containerEl, controlsType === 'custom');
  useFullscreen(videoRef, containerEl);

  const { previousEpisode, nextEpisode } = useMemo(() => {
    if (!resolvedEntry || entries === undefined) {
      return { previousEpisode: null, nextEpisode: null };
    }

    const seriesIdentity = buildSeriesIdentity(resolvedEntry);
    if (!seriesIdentity || resolvedEntry.seasonNumber == null || resolvedEntry.episodeNumber == null) {
      return { previousEpisode: null, nextEpisode: null };
    }

    const siblings = entries
      .filter((candidate) => candidate.id !== resolvedEntry.id)
      .filter((candidate) => candidate.hasLocalFile !== false)
      .filter((candidate) => buildSeriesIdentity(candidate) === seriesIdentity)
      .filter(
        (candidate) => candidate.seasonNumber != null && candidate.episodeNumber != null,
      )
      .concat(resolvedEntry)
      .sort(compareEpisodeEntries);

    const currentIndex = siblings.findIndex((candidate) => candidate.id === resolvedEntry.id);
    if (currentIndex === -1) {
      return { previousEpisode: null, nextEpisode: null };
    }

    return {
      previousEpisode: siblings[currentIndex - 1] ?? null,
      nextEpisode: siblings[currentIndex + 1] ?? null,
    };
  }, [entries, resolvedEntry]);

  useEffect(() => {
    if (!hasEnded || !autoplayNextEpisode || !nextEpisode) {
      return;
    }

    navigate(`/play/${nextEpisode.id}`, { state: { entry: nextEpisode } });
  }, [autoplayNextEpisode, hasEnded, navigate, nextEpisode]);

  const siblingSubtitleKey =
    resolvedEntry && resolvedEntry.hasLocalFile !== false
      ? `${resolvedEntry.directoryId}:${resolvedEntry.path}`
      : null;
  useEffect(() => {
    if (!resolvedEntry || resolvedEntry.hasLocalFile === false || phase !== 'ready') {
      setSiblingSubtitles([]);
      setLoadingSiblingSubtitles(false);
      setSiblingSubtitleStatus('');
      return;
    }

    let cancelled = false;
    setLoadingSiblingSubtitles(true);
    setSiblingSubtitleStatus('');
    void folderProvider
      .listSiblingSubtitleFiles(resolvedEntry)
      .then((files) => {
        if (cancelled) {
          return;
        }
        setSiblingSubtitles(files);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setSiblingSubtitles([]);
        setSiblingSubtitleStatus(
          error instanceof Error ? error.message : 'Failed to load sibling subtitles.',
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingSiblingSubtitles(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedEntry, siblingSubtitleKey, phase]);

  if (entry === PLAYER_QUERY_PENDING && !routeEntry) {
    return <div className="player-page">Loading...</div>;
  }

  if (!resolvedEntry) {
    return (
      <div className="player-page">
        <Link to="/" className="player-back">
          &larr; Back to Catalog
        </Link>
        <p>Video not found.</p>
      </div>
    );
  }

  if (resolvedEntry.hasLocalFile === false) {
    return (
      <div className="player-page">
        <Link to="/" className="player-back">
          &larr; Back to Catalog
        </Link>
        <h2 className="player-filename">{resolvedEntry.name}</h2>
        <div className="player-virtual-notice">
          <p>{missingMessage(resolvedEntry)}</p>
          {resolvedEntry.torrentMagnetUrl ? (
            <div className="player-virtual-magnet">
              <a href={resolvedEntry.torrentMagnetUrl}>Open Magnet Link</a>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(resolvedEntry.torrentMagnetUrl!);
                }}
              >
                Copy Magnet
              </button>
            </div>
          ) : null}
        </div>
        {previousEpisode || nextEpisode ? (
          <div className="player-episode-nav">
            {previousEpisode ? (
              <Link to={`/play/${previousEpisode.id}`} state={{ entry: previousEpisode }}>
                &larr; Previous
              </Link>
            ) : null}
            {nextEpisode ? (
              <Link to={`/play/${nextEpisode.id}`} state={{ entry: nextEpisode }}>
                Next &rarr;
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="player-page">
      <Link to="/" className="player-back">
        &larr; Back to Catalog
      </Link>
      <h2 className="player-filename">{resolvedEntry.name}</h2>
      <input
        ref={subtitleInputRef}
        type="file"
        accept=".srt,.vtt"
        className="player-subtitle-input"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            await loadSubtitleFile(file);
          } catch {}
        }}
      />
      <div className="pv-video-container" ref={setContainerEl}>
        <video ref={videoRef} controls={controlsType === 'stock'} autoPlay />
      </div>
      {needsPermission && (
        <button className="btn btn-primary player-permission-btn" onClick={retryPermission}>
          {folderProvider.requiresPermissionGrant
            ? 'Tap to grant file access'
            : 'Select folder to play'}
        </button>
      )}
      {previousEpisode || nextEpisode ? (
        <div className="player-episode-nav">
        {previousEpisode ? (
          <Link
            to={`/play/${previousEpisode.id}`}
            state={{ entry: previousEpisode }}
            className="btn btn-secondary"
          >
            Previous Episode: {formatEpisodeCode(previousEpisode)}
          </Link>
        ) : (
          <span className="player-episode-nav-spacer" />
        )}
        {nextEpisode ? (
          <Link
            to={`/play/${nextEpisode.id}`}
            state={{ entry: nextEpisode }}
            className="btn btn-secondary"
          >
            Next Episode: {formatEpisodeCode(nextEpisode)}
          </Link>
        ) : null}
        </div>
      ) : null}
      <div className="player-actions">
        <button
          className="btn btn-secondary"
          onClick={() => setControlsType(controlsType === 'stock' ? 'custom' : 'stock')}
        >
          {controlsType === 'stock' ? 'Custom controls' : 'Stock controls'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => subtitleInputRef.current?.click()}
          disabled={phase !== 'ready'}
        >
          Load subtitles
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => clearExternalSubtitles()}
          disabled={phase !== 'ready' || !subtitleStatus.startsWith('Subtitles:')}
        >
          Clear subtitles
        </button>
        <button className="btn btn-secondary" onClick={() => void copyDiagnostics()}>
          Copy diagnostics
        </button>
      </div>
      <div className="player-status">{status}</div>
      <div className="player-subtitle-status">
        {subtitleStatus || (phase === 'ready' ? 'External subtitles: none' : '')}
      </div>
      {phase === 'ready' && (loadingSiblingSubtitles || siblingSubtitles.length > 0 || siblingSubtitleStatus) ? (
        <div className="player-sibling-subtitles">
          <div className="player-sibling-subtitles-title">Sibling subtitle files</div>
          {loadingSiblingSubtitles ? (
            <div className="player-sibling-subtitles-copy">Checking for subtitle files...</div>
          ) : null}
          {!loadingSiblingSubtitles && siblingSubtitles.length > 0 ? (
            <div className="player-sibling-subtitles-actions">
              {siblingSubtitles.map((subtitle) => (
                <button
                  key={subtitle.path}
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void loadSubtitleFile(subtitle.file)}
                >
                  {subtitle.name}
                </button>
              ))}
            </div>
          ) : null}
          {!loadingSiblingSubtitles && siblingSubtitles.length === 0 && siblingSubtitleStatus ? (
            <div className="player-sibling-subtitles-copy">{siblingSubtitleStatus}</div>
          ) : null}
        </div>
      ) : null}
      {!autoplayNextEpisode && hasEnded && nextEpisode ? (
        <div className="player-next-episode-banner">
          <span>Episode finished. Continue to {formatEpisodeCode(nextEpisode)}.</span>
          <Link to={`/play/${nextEpisode.id}`} state={{ entry: nextEpisode }} className="btn btn-primary">
            Play Next Episode
          </Link>
        </div>
      ) : null}
      <div className="player-diagnostics-status">
        {diagnosticsStatus || 'Copy diagnostics after a playback issue to share what happened.'}
      </div>
    </div>
  );
}
