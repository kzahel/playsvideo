import { describe, expect, it } from 'vitest';
import { normalizeCatalogViewMode } from '../../app/src/settings.js';

describe('catalog view mode', () => {
  it.each(['card', 'compact', 'list'] as const)('preserves the %s layout', (viewMode) => {
    expect(normalizeCatalogViewMode(viewMode)).toBe(viewMode);
  });

  it.each([
    undefined,
    null,
    'grid',
    'rows',
    1,
  ])('falls back to the kid-friendly card grid for %j', (storedValue) => {
    expect(normalizeCatalogViewMode(storedValue)).toBe('card');
  });
});
