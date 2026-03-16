import { useRef, useState, useEffect, useCallback, type MutableRefObject } from 'react';
import { PlaysVideoEngine } from 'playsvideo';
import type { LibraryEntry } from '../db';
import { db } from '../db';
import { useSetting } from './useSetting.js';
import { getFile, setFolder } from '../scan.js';
import { folderProvider, isFileAccessPermissionError } from '../folder-provider.js';
import { scheduleSyncIfLoggedIn } from '../firebase.js';
import {
  EMBEDDED_SUBTITLE_POLICY_KEY,
  type EmbeddedSubtitlePolicy,
} from '../settings.js';

export type EngineSource =
  | { kind: 'entry'; entry: LibraryEntry }
  | { kind: 'file'; file: File };

const MAX_DIAGNOSTIC_EVENTS = 60;

interface DiagnosticEvent {
  at: string;
  label: string;
  detail?: string;
}

interface UseEngineResult {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  status: string;
  phase: string;
  hasEnded: boolean;
  needsPermission: boolean;
  retryPermission: () => void;
  subtitleStatus: string;
  loadSubtitleFile: (file: File) => Promise<void>;
  clearExternalSubtitles: () => void;
  copyDiagnostics: () => Promise<void>;
  diagnosticsStatus: string;
}

function pushDiagnosticEvent(
  buffer: MutableRefObject<DiagnosticEvent[]>,
  label: string,
  detail?: string,
): void {
  buffer.current.push({
    at: new Date().toISOString(),
    label,
    detail,
  });
  if (buffer.current.length > MAX_DIAGNOSTIC_EVENTS) {
    buffer.current.splice(0, buffer.current.length - MAX_DIAGNOSTIC_EVENTS);
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatMediaError(error: MediaError | null): string | null {
  if (!error) {
    return null;
  }
  return `code=${error.code}${error.message ? ` message=${error.message}` : ''}`;
}

async function writeClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function useEngine(source: EngineSource | null): UseEngineResult {
  const entry = source?.kind === 'entry' ? source.entry : null;
  const file = source?.kind === 'file' ? source.file : null;
  const sourceKey = source
    ? source.kind === 'entry'
      ? `entry-${source.entry.id}`
      : `file-${source.file.name}-${source.file.size}-${source.file.lastModified}`
    : null;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<PlaysVideoEngine | null>(null);
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const diagnosticsRef = useRef<DiagnosticEvent[]>([]);
  const playbackDecisionRef = useRef<unknown>(null);
  const workerStatesRef = useRef<unknown>(null);
  const segmentStatesRef = useRef<unknown>(null);
  const readyDetailRef = useRef<unknown>(null);
  const [status, setStatus] = useState('');
  const [phase, setPhase] = useState('idle');
  const [hasEnded, setHasEnded] = useState(false);
  const [subtitleStatus, setSubtitleStatus] = useState('');
  const [diagnosticsStatus, setDiagnosticsStatus] = useState('');
  const [needsPermission, setNeedsPermission] = useState(false);
  const [retryCounter, setRetryCounter] = useState(0);
  const [embeddedSubtitlePolicy] = useSetting<EmbeddedSubtitlePolicy>(
    EMBEDDED_SUBTITLE_POLICY_KEY,
    'auto',
  );

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

  const copyDiagnostics = useCallback(async () => {
    const entry = entryRef.current;
    const video = videoRef.current;
    const lines = [
      'playsvideo diagnostics',
      `copied_at: ${new Date().toISOString()}`,
      `entry_id: ${entry?.id ?? 'unknown'}`,
      `entry_name: ${entry?.name ?? 'unknown'}`,
      `entry_path: ${entry?.path ?? 'unknown'}`,
      `entry_size: ${entry?.size ?? 'unknown'}`,
      `phase: ${phase}`,
      `status: ${status}`,
      `subtitle_status: ${subtitleStatus || 'none'}`,
      `location: ${window.location.href}`,
      `user_agent: ${navigator.userAgent}`,
      `video_current_time: ${video ? video.currentTime.toFixed(3) : 'n/a'}`,
      `video_duration: ${video && Number.isFinite(video.duration) ? video.duration.toFixed(3) : 'n/a'}`,
      `video_paused: ${video ? String(video.paused) : 'n/a'}`,
      `video_ended: ${video ? String(video.ended) : 'n/a'}`,
      `video_ready_state: ${video ? String(video.readyState) : 'n/a'}`,
      `video_network_state: ${video ? String(video.networkState) : 'n/a'}`,
      `video_error: ${video ? formatMediaError(video.error) ?? 'none' : 'n/a'}`,
      '',
      'ready_detail:',
      safeJson(readyDetailRef.current),
      '',
      'playback_decision:',
      safeJson(playbackDecisionRef.current),
      '',
      'worker_states:',
      safeJson(workerStatesRef.current),
      '',
      'segment_states:',
      safeJson(segmentStatesRef.current),
      '',
      'recent_events:',
      ...diagnosticsRef.current.map((event) =>
        `${event.at} ${event.label}${event.detail ? ` :: ${event.detail}` : ''}`,
      ),
    ];

    try {
      await writeClipboard(lines.join('\n'));
      setDiagnosticsStatus('Diagnostics copied');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setDiagnosticsStatus(`Copy failed: ${message}`);
    }
  }, [phase, status, subtitleStatus]);

  useEffect(() => {
    if (!source || !videoRef.current) return;

    const video = videoRef.current;
    video.currentTime = 0;
    const engine = new PlaysVideoEngine(video, {
      embeddedSubtitlePolicy,
    });
    engineRef.current = engine;
    diagnosticsRef.current = [];
    playbackDecisionRef.current = null;
    workerStatesRef.current = null;
    segmentStatesRef.current = null;
    readyDetailRef.current = null;
    setDiagnosticsStatus('');

    const label = entry ? `${entry.name} (${entry.path})` : file!.name;
    pushDiagnosticEvent(diagnosticsRef, 'session:start', label);

    engine.addEventListener('loading', ((e: CustomEvent) => {
      setStatus(`Opening ${e.detail.file?.name ?? ''}...`);
      setPhase('demuxing');
      setHasEnded(false);
      setSubtitleStatus('');
      pushDiagnosticEvent(
        diagnosticsRef,
        'engine:loading',
        e.detail.file?.name ?? e.detail.url ?? 'unknown',
      );
    }) as EventListener);

    engine.addEventListener('ready', ((e: CustomEvent) => {
      const mode = e.detail.passthrough ? 'direct playback' : `${e.detail.totalSegments} segments`;
      setStatus(`Ready \u2014 ${mode}`);
      setPhase('ready');
      setHasEnded(false);
      readyDetailRef.current = e.detail;
      pushDiagnosticEvent(
        diagnosticsRef,
        'engine:ready',
        `${mode}; duration=${Number(e.detail.durationSec).toFixed(3)}`,
      );

      if (entry) {
        if (entry.playbackPositionSec > 0 && entry.watchState === 'in-progress') {
          video.currentTime = entry.playbackPositionSec;
          pushDiagnosticEvent(
            diagnosticsRef,
            'video:resume-position',
            `currentTime=${entry.playbackPositionSec.toFixed(3)}`,
          );
        }
        db.library.update(entry.id, { durationSec: e.detail.durationSec, lastPlayedAt: Date.now() });
      }
    }) as EventListener);

    engine.addEventListener('subtitle-status', ((e: CustomEvent) => {
      setSubtitleStatus(e.detail.message);
      pushDiagnosticEvent(diagnosticsRef, 'subtitle:status', e.detail.message);
    }) as EventListener);

    engine.addEventListener('error', ((e: CustomEvent) => {
      setStatus(`Error: ${e.detail.message}`);
      setPhase('error');
      pushDiagnosticEvent(diagnosticsRef, 'engine:error', e.detail.message);
    }) as EventListener);

    engine.addEventListener('playbackdecision', ((e: CustomEvent) => {
      playbackDecisionRef.current = e.detail;
      pushDiagnosticEvent(
        diagnosticsRef,
        'engine:playbackdecision',
        safeJson({
          playbackPolicy: e.detail.playbackPolicy,
          recommended: e.detail.evaluation?.recommended?.option?.mode ?? null,
          statuses: e.detail.evaluation?.evaluations?.map((entry: any) => ({
            mode: entry.option.mode,
            status: entry.status,
          })),
        }),
      );
    }) as EventListener);

    engine.addEventListener('workerstatechange', ((e: CustomEvent) => {
      workerStatesRef.current = e.detail.workers;
      const failedWorker = e.detail.workers.find((worker: any) => worker.phase === 'error');
      if (failedWorker) {
        pushDiagnosticEvent(
          diagnosticsRef,
          'worker:error',
          `id=${failedWorker.id} ${failedWorker.lastError ?? 'unknown'}`,
        );
      }
    }) as EventListener);

    engine.addEventListener('segmentstatechange', ((e: CustomEvent) => {
      segmentStatesRef.current = e.detail.segments;
      const failedSegment = [...e.detail.segments]
        .reverse()
        .find((segment: any) => segment.phase === 'error');
      if (failedSegment) {
        pushDiagnosticEvent(
          diagnosticsRef,
          'segment:error',
          `index=${failedSegment.index} ${failedSegment.error ?? 'unknown'}`,
        );
      }
    }) as EventListener);

    const logVideoEvent = (label: string) => {
      pushDiagnosticEvent(
        diagnosticsRef,
        label,
        `t=${video.currentTime.toFixed(3)} paused=${video.paused} readyState=${video.readyState}`,
      );
    };
    const onPlaying = () => logVideoEvent('video:playing');
    const onWaiting = () => logVideoEvent('video:waiting');
    const onStalled = () => logVideoEvent('video:stalled');
    const onSeeking = () => logVideoEvent('video:seeking');
    const onSeeked = () => logVideoEvent('video:seeked');
    const onPause = () => {
      logVideoEvent('video:pause');
      if (entry) {
        savePosition().then(() => scheduleSyncIfLoggedIn());
      }
    };
    const onEnded = () => {
      logVideoEvent('video:ended');
      setHasEnded(true);
      if (entry) {
        savePosition().then(() => scheduleSyncIfLoggedIn());
      }
    };
    const onPlay = () => setHasEnded(false);
    const onVideoError = () =>
      pushDiagnosticEvent(diagnosticsRef, 'video:error', formatMediaError(video.error) ?? 'unknown');

    video.addEventListener('playing', onPlaying);
    video.addEventListener('play', onPlay);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('stalled', onStalled);
    video.addEventListener('seeking', onSeeking);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onVideoError);

    const interval = entry ? setInterval(savePosition, 5000) : null;

    (async () => {
      if (file) {
        pushDiagnosticEvent(
          diagnosticsRef,
          'file-access:ready',
          `${file.name}; size=${file.size}; type=${file.type || 'unknown'}`,
        );
        engine.loadFile(file);
        return;
      }
      try {
        setStatus('Getting file access...');
        setNeedsPermission(false);
        pushDiagnosticEvent(diagnosticsRef, 'file-access:start');
        const resolved = await getFile(entry!, { requestPermission: false });
        pushDiagnosticEvent(
          diagnosticsRef,
          'file-access:ready',
          `${resolved.name}; size=${resolved.size}; type=${resolved.type || 'unknown'}`,
        );
        engine.loadFile(resolved);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (isFileAccessPermissionError(err) || message.includes('not available')) {
          setStatus(
            folderProvider.requiresPermissionGrant
              ? 'File access permission needed'
              : 'Please select the folder to play this file',
          );
          setNeedsPermission(true);
          pushDiagnosticEvent(diagnosticsRef, 'file-access:permission-required', message);
        } else {
          setStatus(`Error: ${message}`);
          setPhase('error');
          pushDiagnosticEvent(diagnosticsRef, 'file-access:error', message);
        }
      }
    })();

    return () => {
      if (entry) {
        savePosition().then(() => scheduleSyncIfLoggedIn());
      }
      if (interval) clearInterval(interval);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('stalled', onStalled);
      video.removeEventListener('seeking', onSeeking);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('error', onVideoError);
      engine.destroy();
      engineRef.current = null;
    };
  }, [embeddedSubtitlePolicy, sourceKey, retryCounter]);

  const retryPermission = useCallback(async () => {
    if (!folderProvider.requiresPermissionGrant) {
      try {
        await setFolder();
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.error('Failed to select folder:', err);
        return;
      }
    } else if (entryRef.current) {
      try {
        await getFile(entryRef.current, { requestPermission: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (isFileAccessPermissionError(err)) {
          setStatus('File access permission needed');
          setNeedsPermission(true);
          pushDiagnosticEvent(diagnosticsRef, 'file-access:permission-required', message);
          return;
        }
        setStatus(`Error: ${message}`);
        setPhase('error');
        pushDiagnosticEvent(diagnosticsRef, 'file-access:error', message);
        return;
      }
    }
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

  return {
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
  };
}
