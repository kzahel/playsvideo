import { useRef, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PlaybackVideo } from '../components/PlaybackVideo.js';
import { useEngine } from '../hooks/useEngine';
import { useFullscreen } from '../hooks/useFullscreen';
import { useSessionPlayerControlsType } from '../hooks/useSessionPlayerControlsType.js';

export function FilePlayer() {
  const [file, setFile] = useState<File | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const controlsType = useSessionPlayerControlsType();
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  // File Handling API (launchQueue)
  useEffect(() => {
    if (!('launchQueue' in window)) return;
    (window as any).launchQueue.setConsumer(async (launchParams: any) => {
      if (!launchParams.files?.length) return;
      const handle = launchParams.files[0];
      const launched = await handle.getFile();
      setFile(launched);
    });
  }, []);

  // Drag-and-drop
  useEffect(() => {
    let dragCounter = 0;
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter++;
    };
    const onDragLeave = () => {
      dragCounter--;
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter = 0;
      const dropped = e.dataTransfer?.files[0];
      if (dropped) setFile(dropped);
    };
    document.addEventListener('dragenter', onDragEnter);
    document.addEventListener('dragleave', onDragLeave);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragenter', onDragEnter);
      document.removeEventListener('dragleave', onDragLeave);
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, []);

  const {
    status,
    phase,
    subtitleStatus,
    loadSubtitleFile,
    clearExternalSubtitles,
    copyDiagnostics,
    diagnosticsStatus,
  } = useEngine(
    file && controlsType ? { kind: 'file', file } : null,
    controlsType ?? '',
    videoElement,
  );
  useFullscreen(controlsType === 'stock' ? videoElement : null, containerEl);

  if (controlsType === null) {
    return <div className="player-page">Loading...</div>;
  }

  return (
    <div className="player-page">
      <Link to="/" className="player-back">
        &larr; Back to Catalog
      </Link>
      {!file && (
        <div className="empty-state">
          <p>Drop a video file here, or select one below.</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            style={{ marginTop: '1rem' }}
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) setFile(picked);
            }}
          />
        </div>
      )}
      <input
        ref={subtitleInputRef}
        type="file"
        accept=".srt,.vtt"
        className="player-subtitle-input"
        onChange={async (e) => {
          const sub = e.target.files?.[0];
          e.target.value = '';
          if (!sub) return;
          try {
            await loadSubtitleFile(sub);
          } catch {}
        }}
      />
      <div
        className={`pv-video-container${controlsType === 'videojs' ? ' pv-videojs10-container' : ''}`}
        ref={setContainerEl}
      >
        <PlaybackVideo
          controlsType={controlsType}
          onVideoElementChange={setVideoElement}
        />
      </div>
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
