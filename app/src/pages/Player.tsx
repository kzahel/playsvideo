import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type LibraryEntry } from '../db';
import { useEngine } from '../hooks/useEngine';
import { folderProvider, type SiblingSubtitleFile } from '../folder-provider.js';
import { useSetting } from '../hooks/useSetting';
import { useCustomControls } from '../hooks/useCustomControls';
import { useFullscreen } from '../hooks/useFullscreen';
import { AUTOPLAY_NEXT_EPISODE_KEY, PLAYER_CONTROLS_TYPE_KEY } from '../settings.js';

function buildSeriesIdentity(entry: LibraryEntry): string | null {
  if (entry.detectedMediaType !== 'tv' || !entry.parsedTitle) {
    return null;
  }

  if (entry.seriesMetadataKey) {
    return entry.seriesMetadataKey;
  }

  return `tv-local:${entry.parsedTitle}:${entry.parsedYear ?? ''}`;
}

function compareEpisodeEntries(left: LibraryEntry, right: LibraryEntry): number {
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

function formatEpisodeCode(entry: LibraryEntry): string {
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

export function Player() {
  const { id } = useParams<{ id: string }>();
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

  const entry = useLiveQuery(() => db.library.get(entryId), [entryId]);
  const entries = useLiveQuery(() => db.library.toArray());
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
    useEngine(entry ? { kind: 'entry', entry } : null);
  useCustomControls(videoRef, containerEl, controlsType === 'custom');
  useFullscreen(videoRef, containerEl);

  const { previousEpisode, nextEpisode } = useMemo(() => {
    if (!entry || entries === undefined) {
      return { previousEpisode: null, nextEpisode: null };
    }

    const seriesIdentity = buildSeriesIdentity(entry);
    if (!seriesIdentity || entry.seasonNumber == null || entry.episodeNumber == null) {
      return { previousEpisode: null, nextEpisode: null };
    }

    const siblings = entries
      .filter((candidate) => candidate.id !== entry.id)
      .filter((candidate) => buildSeriesIdentity(candidate) === seriesIdentity)
      .filter(
        (candidate) => candidate.seasonNumber != null && candidate.episodeNumber != null,
      )
      .concat(entry)
      .sort(compareEpisodeEntries);

    const currentIndex = siblings.findIndex((candidate) => candidate.id === entry.id);
    if (currentIndex === -1) {
      return { previousEpisode: null, nextEpisode: null };
    }

    return {
      previousEpisode: siblings[currentIndex - 1] ?? null,
      nextEpisode: siblings[currentIndex + 1] ?? null,
    };
  }, [entries, entry]);

  useEffect(() => {
    if (!hasEnded || !autoplayNextEpisode || !nextEpisode) {
      return;
    }

    navigate(`/play/${nextEpisode.id}`);
  }, [autoplayNextEpisode, hasEnded, navigate, nextEpisode]);

  const siblingSubtitleKey = entry ? `${entry.directoryId}:${entry.path}` : null;
  useEffect(() => {
    if (!entry || phase !== 'ready') {
      setSiblingSubtitles([]);
      setLoadingSiblingSubtitles(false);
      setSiblingSubtitleStatus('');
      return;
    }

    let cancelled = false;
    setLoadingSiblingSubtitles(true);
    setSiblingSubtitleStatus('');
    void folderProvider
      .listSiblingSubtitleFiles(entry)
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
  }, [siblingSubtitleKey, phase]);

  if (entry === undefined) {
    return <div className="player-page">Loading...</div>;
  }

  if (!entry) {
    return (
      <div className="player-page">
        <Link to="/" className="player-back">
          &larr; Back to Library
        </Link>
        <p>Video not found.</p>
      </div>
    );
  }

  return (
    <div className="player-page">
      <Link to="/" className="player-back">
        &larr; Back to Library
      </Link>
      <h2 className="player-filename">{entry.name}</h2>
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
            <Link to={`/play/${previousEpisode.id}`} className="btn btn-secondary">
              Previous Episode: {formatEpisodeCode(previousEpisode)}
            </Link>
          ) : (
            <span className="player-episode-nav-spacer" />
          )}
          {nextEpisode ? (
            <Link to={`/play/${nextEpisode.id}`} className="btn btn-secondary">
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
          <Link to={`/play/${nextEpisode.id}`} className="btn btn-primary">
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
