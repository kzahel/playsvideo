import { describe, expect, it } from 'vitest';
import {
  buildThumbnailCandidateTimestamps,
  scoreThumbnailPixels,
  selectBestThumbnailFrame,
} from '../../app/src/thumbnails/selection.js';
import { getLocalThumbnailCacheKey } from '../../app/src/thumbnails/cache.js';
import type { CatalogEntry } from '../../app/src/db.js';

function makeCatalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 42,
    createdAt: 1,
    updatedAt: 1,
    name: 'Episode.mkv',
    path: 'Season 1/Episode.mkv',
    directoryId: 7,
    size: 1234,
    lastModified: 5678,
    availability: 'present',
    detectedMediaType: 'tv',
    hasLocalFile: true,
    ...overrides,
  };
}

function makePixels(
  width: number,
  height: number,
  colorAt: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const [red, green, blue] = colorAt(x, y);
      data[offset] = red;
      data[offset + 1] = green;
      data[offset + 2] = blue;
      data[offset + 3] = 255;
    }
  }
  return data;
}

describe('local thumbnail cache key', () => {
  it('changes when the file version changes', () => {
    const original = getLocalThumbnailCacheKey(makeCatalogEntry());
    const changed = getLocalThumbnailCacheKey(makeCatalogEntry({ lastModified: 9999 }));

    expect(original).not.toBe(changed);
  });

  it('does not generate keys for unavailable files', () => {
    expect(
      getLocalThumbnailCacheKey(makeCatalogEntry({ availability: 'missing', hasLocalFile: false })),
    ).toBeNull();
  });
});

describe('thumbnail frame selection', () => {
  it('keeps candidates away from the opening and closing credits', () => {
    const candidates = buildThumbnailCandidateTimestamps(420);

    expect(candidates).toHaveLength(4);
    expect(candidates[0]).toBeGreaterThanOrEqual(30);
    expect(candidates.at(-1)).toBeLessThan(360);
  });

  it('rejects a black frame', () => {
    const width = 32;
    const height = 32;
    const score = scoreThumbnailPixels({
      width,
      height,
      data: makePixels(width, height, () => [0, 0, 0]),
    });

    expect(score.accepted).toBe(false);
    expect(score.darkPixelRatio).toBe(1);
  });

  it('accepts a detailed, normally exposed frame', () => {
    const width = 32;
    const height = 32;
    const score = scoreThumbnailPixels({
      width,
      height,
      data: makePixels(width, height, (x, y) =>
        (x + y) % 8 < 4 ? [40, 100, 220] : [240, 180, 50],
      ),
    });

    expect(score.accepted).toBe(true);
    expect(score.edgeScore).toBeGreaterThan(4);
  });

  it('prefers accepted candidates over higher-scoring rejected candidates', () => {
    const selected = selectBestThumbnailFrame([
      {
        timestampSec: 10,
        meanLuma: 10,
        standardDeviation: 80,
        edgeScore: 80,
        darkPixelRatio: 0.9,
        score: 100,
        accepted: false,
      },
      {
        timestampSec: 30,
        meanLuma: 100,
        standardDeviation: 30,
        edgeScore: 20,
        darkPixelRatio: 0.1,
        score: 50,
        accepted: true,
      },
    ]);

    expect(selected?.timestampSec).toBe(30);
  });
});
