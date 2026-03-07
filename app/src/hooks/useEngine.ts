import { useRef, useState, useEffect, useCallback } from 'react';
import { PlaysVideoEngine } from 'playsvideo';
import type { LibraryEntry } from '../db';
import { db } from '../db';
import { getFileFromLibraryEntry } from '../scan';

interface UseEngineResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: string;
  phase: string;
}

export function useEngine(entry: LibraryEntry | null): UseEngineResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<PlaysVideoEngine | null>(null);
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState('idle');

  const savePosition = useCallback(async () => {
    if (!entry || !videoRef.current) return;
    const video = videoRef.current;
    const currentTime = video.currentTime;
    const duration = video.duration;

    if (Number.isNaN(duration) || duration <= 0) return;

    const nearEnd = duration - currentTime < 30;
    const watchState = nearEnd
      ? ('watched' as const)
      : currentTime > 10
        ? ('in-progress' as const)
        : entry.watchState;

    await db.library.update(entry.id, {
      playbackPositionSec: currentTime,
      durationSec: duration,
      watchState,
    });
  }, [entry]);

  useEffect(() => {
    if (!entry || !videoRef.current) return;

    const video = videoRef.current;
    const engine = new PlaysVideoEngine(video);
    engineRef.current = engine;

    engine.addEventListener('loading', ((e: CustomEvent) => {
      setStatus(`Opening ${e.detail.file?.name ?? ''}...`);
      setPhase('demuxing');
    }) as EventListener);

    engine.addEventListener('ready', ((e: CustomEvent) => {
      setStatus(`Ready \u2014 ${e.detail.totalSegments} segments`);
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
        const file = await getFileFromLibraryEntry(entry);
        engine.loadFile(file);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus(`Error: ${message}`);
        setPhase('error');
      }
    })();

    return () => {
      savePosition();
      clearInterval(interval);
      engine.destroy();
      engineRef.current = null;
    };
  }, [entry?.id, savePosition]);

  return { videoRef, status, phase };
}
