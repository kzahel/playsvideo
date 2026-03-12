import { useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useEngine } from '../hooks/useEngine';
import { folderProvider } from '../folder-provider.js';
import { useSetting } from '../hooks/useSetting';
import { useCustomControls } from '../hooks/useCustomControls';
import { useFullscreen } from '../hooks/useFullscreen';
import { PLAYER_CONTROLS_TYPE_KEY } from '../settings.js';

export function Player() {
  const { id } = useParams<{ id: string }>();
  const entryId = Number(id);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [controlsType, setControlsType] = useSetting<'stock' | 'custom'>(
    PLAYER_CONTROLS_TYPE_KEY,
    'stock',
  );

  const entry = useLiveQuery(() => db.library.get(entryId), [entryId]);
  const {
    videoRef,
    status,
    phase,
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
      <div className="player-diagnostics-status">
        {diagnosticsStatus || 'Copy diagnostics after a playback issue to share what happened.'}
      </div>
    </div>
  );
}
