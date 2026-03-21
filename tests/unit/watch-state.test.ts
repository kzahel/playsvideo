import { describe, expect, it } from 'vitest';
import { deriveWatchState, type SaveReason } from '../../app/src/watch-state.js';
import type { WatchState } from '../../app/src/db.js';

function derive(
  currentTime: number,
  duration: number,
  reason: SaveReason = 'passive',
  previousWatchState: WatchState = 'unwatched',
): WatchState {
  return deriveWatchState({ currentTime, duration, previousWatchState, reason });
}

describe('deriveWatchState', () => {
  describe('passive saves (periodic / pause / unmount)', () => {
    it('marks watched when within 30s of end', () => {
      expect(derive(3570, 3600)).toBe('watched');
      expect(derive(3590, 3600)).toBe('watched');
      expect(derive(3600, 3600)).toBe('watched');
    });

    it('does not mark watched at 31s remaining', () => {
      expect(derive(3569, 3600)).toBe('in-progress');
    });

    it('marks in-progress after 10s of playback', () => {
      expect(derive(11, 3600)).toBe('in-progress');
      expect(derive(60, 3600)).toBe('in-progress');
    });

    it('keeps previous state when under 10s played', () => {
      expect(derive(5, 3600, 'passive', 'unwatched')).toBe('unwatched');
      expect(derive(5, 3600, 'passive', 'watched')).toBe('watched');
    });

    it('does not mark watched at 5min remaining', () => {
      // 55 min into a 60 min video — still 5 min left
      expect(derive(3300, 3600)).toBe('in-progress');
    });
  });

  describe('next-episode (user clicks next)', () => {
    it('marks watched when within 5min of end', () => {
      // 56 min into a 60 min video
      expect(derive(3360, 3600, 'next-episode')).toBe('watched');
      // 58 min into a 60 min video
      expect(derive(3480, 3600, 'next-episode')).toBe('watched');
    });

    it('marks watched at exactly 5min remaining', () => {
      // 55 min into 60 min = 300s remaining = threshold
      expect(derive(3300, 3600, 'next-episode')).toBe('watched');
    });

    it('does not mark watched at 5min01s remaining', () => {
      expect(derive(3299, 3600, 'next-episode')).toBe('in-progress');
    });

    it('marks watched for short episodes near end', () => {
      // 22 min episode, 3 min remaining
      expect(derive(1140, 1320, 'next-episode')).toBe('watched');
    });

    it('does not mark watched early in the episode', () => {
      // Only 10 min into a 60 min episode
      expect(derive(600, 3600, 'next-episode')).toBe('in-progress');
    });

    it('keeps unwatched if barely started and next-episode clicked', () => {
      expect(derive(3, 3600, 'next-episode', 'unwatched')).toBe('unwatched');
    });
  });

  describe('edge cases', () => {
    it('handles very short videos', () => {
      // 2 min video, 20s remaining, passive
      expect(derive(100, 120)).toBe('watched');
      // 2 min video, 1min remaining, next-episode
      expect(derive(60, 120, 'next-episode')).toBe('watched');
    });

    it('handles zero currentTime', () => {
      expect(derive(0, 3600, 'passive', 'unwatched')).toBe('unwatched');
    });

    it('never downgrades from watched', () => {
      // Even at 0s played, if previously watched, stays watched
      expect(derive(0, 3600, 'passive', 'watched')).toBe('watched');
    });
  });
});
