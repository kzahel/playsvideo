import { describe, expect, it } from 'vitest';
import { normalizePlayerControlsType, VIDEOJS_CONTROLS_ENABLED } from '../../app/src/settings.js';

describe('player controls feature flag', () => {
  it('keeps Video.js controls globally disabled', () => {
    expect(VIDEOJS_CONTROLS_ENABLED).toBe(false);
  });

  it.each([
    'videojs',
    'custom',
    'stock',
    null,
  ])('normalizes the stored %s preference to native controls', (storedValue) => {
    expect(normalizePlayerControlsType(storedValue)).toBe('stock');
  });
});
