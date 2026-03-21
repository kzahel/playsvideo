import type { WatchState } from './db.js';

/**
 * Thresholds (in seconds) for determining watch state.
 *
 * PASSIVE: used during regular periodic saves (every 5s, on pause, on unmount).
 * Credits typically start 30s before the end — if you're past that point,
 * you've effectively finished.
 *
 * NEXT_EPISODE: used when the user explicitly clicks "next episode".
 * This is a strong signal they consider the current episode done.
 * Credits for TV episodes can run 1–3+ minutes, so we use a generous 5-minute
 * threshold — if you're within 5 minutes of the end and chose to skip ahead,
 * you watched it.
 */
const WATCHED_THRESHOLD_PASSIVE = 30;
const WATCHED_THRESHOLD_NEXT_EPISODE = 300;

/** Minimum seconds watched before marking as in-progress. */
const IN_PROGRESS_THRESHOLD = 10;

export type SaveReason = 'passive' | 'next-episode';

export function deriveWatchState(opts: {
  currentTime: number;
  duration: number;
  previousWatchState: WatchState;
  reason: SaveReason;
}): WatchState {
  const { currentTime, duration, previousWatchState, reason } = opts;

  const remaining = duration - currentTime;
  const threshold =
    reason === 'next-episode'
      ? WATCHED_THRESHOLD_NEXT_EPISODE
      : WATCHED_THRESHOLD_PASSIVE;

  if (remaining <= threshold) {
    return 'watched';
  }

  if (currentTime > IN_PROGRESS_THRESHOLD) {
    return 'in-progress';
  }

  return previousWatchState;
}
