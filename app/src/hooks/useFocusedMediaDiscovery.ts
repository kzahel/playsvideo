import { useEffect, useRef } from 'react';
import type { CatalogEntry } from '../db.js';
import { discoverFocusedMediaForEntry } from '../scan.js';
import {
  catalogSeriesIdentity,
  FOCUSED_DISCOVERY_INTERVAL_MS,
  shouldRunFocusedDiscovery,
  type FocusedDiscoveryTrigger,
  type FocusedDiscoveryTriggerState,
} from '../scanning/focused-discovery.js';

interface FocusedMediaDiscoveryOptions {
  nextEpisodeKnown: boolean;
  videoElement: HTMLVideoElement | null;
}

function isFullscreen(videoElement: HTMLVideoElement | null): boolean {
  const webkitVideo = videoElement as (HTMLVideoElement & {
    webkitDisplayingFullscreen?: boolean;
  }) | null;
  return Boolean(
    document.fullscreenElement ||
      document.documentElement.classList.contains('vjs-full-window') ||
      document.body?.classList.contains('vjs-full-window') ||
      webkitVideo?.webkitDisplayingFullscreen,
  );
}

function triggerState(
  options: FocusedMediaDiscoveryOptions,
): FocusedDiscoveryTriggerState {
  const video = options.videoElement;
  return {
    hasNextEpisode: options.nextEpisodeKnown,
    pageVisible: document.visibilityState === 'visible',
    fullscreen: isFullscreen(video),
    playbackActive: Boolean(video && !video.paused && !video.ended),
    currentTimeSec: video?.currentTime,
    durationSec: video?.duration,
  };
}

export function useFocusedMediaDiscovery(
  entry: CatalogEntry | null | undefined,
  options: FocusedMediaDiscoveryOptions,
): void {
  const nearEndAttemptedForEntryRef = useRef<number | null>(null);

  useEffect(() => {
    if (!entry || entry.directoryId == null || !catalogSeriesIdentity(entry)) return;
    if (!shouldRunFocusedDiscovery('mount', triggerState(options))) return;
    void discoverFocusedMediaForEntry(entry).catch(() => {
      // Focused discovery is opportunistic and must never disrupt playback.
    });
  }, [
    entry?.id,
    entry?.directoryId,
    entry?.path,
    entry?.detectedMediaType,
    entry?.parsedTitle,
    entry?.parsedYear,
    entry?.seriesMetadataKey,
    options.nextEpisodeKnown,
  ]);

  useEffect(() => {
    if (
      !entry ||
      entry.directoryId == null ||
      !catalogSeriesIdentity(entry) ||
      options.nextEpisodeKnown
    ) {
      return;
    }
    if (nearEndAttemptedForEntryRef.current !== entry.id) {
      nearEndAttemptedForEntryRef.current = null;
    }

    const requestDiscovery = (trigger: FocusedDiscoveryTrigger) => {
      const state = triggerState(options);
      if (!shouldRunFocusedDiscovery(trigger, state)) return;
      if (trigger === 'near-end') {
        if (nearEndAttemptedForEntryRef.current === entry.id) return;
        nearEndAttemptedForEntryRef.current = entry.id;
      }
      void discoverFocusedMediaForEntry(entry).catch(() => {
        // Focused discovery is opportunistic and must never disrupt playback.
      });
    };
    const onWindowFocus = () => requestDiscovery('window-focus');
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestDiscovery('page-visible');
    };
    const onFullscreenChange = () => {
      if (!isFullscreen(options.videoElement)) requestDiscovery('fullscreen-exit');
    };
    const onTimeUpdate = () => requestDiscovery('near-end');

    window.addEventListener('focus', onWindowFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    options.videoElement?.addEventListener('timeupdate', onTimeUpdate);
    const interval = window.setInterval(
      () => requestDiscovery('periodic-playback'),
      FOCUSED_DISCOVERY_INTERVAL_MS,
    );

    return () => {
      window.removeEventListener('focus', onWindowFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      options.videoElement?.removeEventListener('timeupdate', onTimeUpdate);
      window.clearInterval(interval);
    };
  }, [
    entry?.id,
    entry?.directoryId,
    entry?.path,
    entry?.detectedMediaType,
    entry?.parsedTitle,
    entry?.parsedYear,
    entry?.seriesMetadataKey,
    options.nextEpisodeKnown,
    options.videoElement,
  ]);
}
