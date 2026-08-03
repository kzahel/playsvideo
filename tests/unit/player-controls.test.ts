import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER_CONTROLS_TYPE,
  normalizePlayerControlsType,
} from '../../app/src/settings.js';

describe('player controls preference', () => {
  it('defaults new users to Video.js 10 controls', () => {
    expect(DEFAULT_PLAYER_CONTROLS_TYPE).toBe('videojs');
    expect(normalizePlayerControlsType(undefined)).toBe('videojs');
  });

  it.each([
    'videojs',
    'custom',
  ])('normalizes the stored %s preference to Video.js 10 controls', (storedValue) => {
    expect(normalizePlayerControlsType(storedValue)).toBe('videojs');
  });

  it('preserves an explicit native-controls preference', () => {
    const storedValue = 'stock';
    expect(normalizePlayerControlsType(storedValue)).toBe('stock');
  });

  it.each([
    null,
    'unknown',
  ])('normalizes the unsaved or invalid %s preference to the default', (storedValue) => {
    expect(normalizePlayerControlsType(storedValue)).toBe(DEFAULT_PLAYER_CONTROLS_TYPE);
  });
});
