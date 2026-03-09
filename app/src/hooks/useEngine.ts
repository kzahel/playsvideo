import { useRef, useState, useEffect, useCallback } from 'react';
import { PlaysVideoEngine } from 'playsvideo';
import type { LibraryEntry } from '../db';
import { db } from '../db';
import { getFileFromLibraryEntry } from '../scan';

interface UseEngineResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: string;
  phase: string;
  needsPermission: boolean;
  retryPermission: () => void;
  subtitleStatus: string;
  loadSubtitleFile: (file: File) => Promise<void>;
  clearExternalSubtitles: () => void;
}

export function useEngine(entry: LibraryEntry | null): UseEngineResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<PlaysVideoEngine | null>(null);
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState('idle');
  const [subtitleStatus, setSubtitleStatus] = useState('');
  const [needsPermission, setNeedsPermission] = useState(false);
  const [retryCounter, setRetryCounter] = useState(0);

  const savePosition = useCallback(async () => {
    const currentEntry = entryRef.current;
    if (!currentEntry || !videoRef.current) return;
    const video = videoRef.current;
    const currentTime = video.currentTime;
    const duration = video.duration;

    if (Number.isNaN(duration) || duration <= 0) return;

    const nearEnd = duration - currentTime < 30;
    const watchState = nearEnd
      ? ('watched' as const)
      : currentTime > 10
        ? ('in-progress' as const)
        : currentEntry.watchState;

    await db.library.update(currentEntry.id, {
      playbackPositionSec: currentTime,
      durationSec: duration,
      watchState,
    });
  }, []);

  useEffect(() => {
    if (!entry || !videoRef.current) return;

    const video = videoRef.current;
    const engine = new PlaysVideoEngine(video);
    engineRef.current = engine;

    engine.addEventListener('loading', ((e: CustomEvent) => {
      setStatus(`Opening ${e.detail.file?.name ?? ''}...`);
      setPhase('demuxing');
      setSubtitleStatus('');
    }) as EventListener);

    engine.addEventListener('ready', ((e: CustomEvent) => {
      const mode = e.detail.passthrough ? 'direct playback' : `${e.detail.totalSegments} segments`;
      setStatus(`Ready \u2014 ${mode}`);
      setPhase('ready');

      if (entry.playbackPositionSec > 0 && entry.watchState === 'in-progress') {
        video.currentTime = entry.playbackPositionSec;
      }

      db.library.update(entry.id, { durationSec: e.detail.durationSec });
    }) as EventListener);

    engine.addEventListener('error', ((e: CustomEvent) => {
      setStatus(`Error: ${e.detail.message}`);
      setPhase('error');
    }) as EventListener);

    const interval = setInterval(savePosition, 5000);

    (async () => {
      try {
        setStatus('Getting file access...');
        setNeedsPermission(false);
        const file = await getFileFromLibraryEntry(entry);
        engine.loadFile(file);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('User activation is required')) {
          setStatus('File access permission needed');
          setNeedsPermission(true);
        } else {
          setStatus(`Error: ${message}`);
          setPhase('error');
        }
      }
    })();

    return () => {
      savePosition();
      clearInterval(interval);
      engine.destroy();
      engineRef.current = null;
    };
  }, [entry?.id, retryCounter]);

  const retryPermission = useCallback(() => {
    setNeedsPermission(false);
    setRetryCounter((c) => c + 1);
  }, []);

  const loadSubtitleFile = useCallback(async (file: File) => {
    const engine = engineRef.current;
    if (!engine) {
      const error = new Error('Player is not ready');
      setSubtitleStatus(`Subtitle error: ${error.message}`);
      throw error;
    }
    try {
      await engine.loadExternalSubtitle(file);
      setSubtitleStatus(`Subtitles: ${file.name}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setSubtitleStatus(`Subtitle error: ${message}`);
      throw err;
    }
  }, []);

  const clearExternalSubtitles = useCallback(() => {
    engineRef.current?.clearExternalSubtitles();
    setSubtitleStatus('');
  }, []);

  return { videoRef, status, phase, needsPermission, retryPermission, subtitleStatus, loadSubtitleFile, clearExternalSubtitles };
}
