import { useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useEngine } from '../hooks/useEngine';

export function Player() {
  const { id } = useParams<{ id: string }>();
  const entryId = Number(id);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);

  const entry = useLiveQuery(() => db.library.get(entryId), [entryId]);
  const { videoRef, status, phase, subtitleStatus, loadSubtitleFile, clearExternalSubtitles } =
    useEngine(entry ?? null);

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
      <video ref={videoRef} controls autoPlay />
      <div className="player-actions">
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
      </div>
      <div className="player-status">{status}</div>
      <div className="player-subtitle-status">
        {subtitleStatus || (phase === 'ready' ? 'External subtitles: none' : '')}
      </div>
    </div>
  );
}
