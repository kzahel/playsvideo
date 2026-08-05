import { describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '../../app/src/db.js';
import {
  buildFocusedDiscoveryPlan,
  catalogSeriesIdentity,
  commonDirectoryPath,
  emptyFocusedDiscoveryResult,
  FocusedDiscoveryCoordinator,
} from '../../app/src/scanning/focused-discovery.js';
import { DirectoryScanCoordinator } from '../../app/src/scanning/scan-coordinator.js';

function episode(
  id: number,
  path: string,
  episodeNumber: number,
  overrides: Partial<CatalogEntry> = {},
): CatalogEntry {
  const name = path.split('/').at(-1)!;
  return {
    id,
    createdAt: 1,
    updatedAt: 1,
    name,
    path,
    directoryId: 4,
    size: 1_000,
    lastModified: 1,
    availability: 'present',
    hasLocalFile: true,
    detectedMediaType: 'tv',
    parsedTitle: 'Example Show',
    seasonNumber: 1,
    episodeNumber,
    seriesMetadataKey: 'tv:example show:',
    canonicalPlaybackKey: `file:${name}|1000`,
    ...overrides,
  };
}

describe('focused discovery planning', () => {
  it('keeps a normal series directory narrow', () => {
    const current = episode(1, 'Shows/Example Show/Example.Show.S01E01.mkv', 1);

    expect(buildFocusedDiscoveryPlan(current, [current])).toEqual(
      expect.objectContaining({
        directoryId: 4,
        scopePath: 'Shows/Example Show',
        seriesIdentity: 'tv:example show:',
      }),
    );
  });

  it('widens a season directory to find sibling seasons', () => {
    const current = episode(1, 'Shows/Example Show/Season 1/Episode S01E01.mkv', 1);

    expect(buildFocusedDiscoveryPlan(current, [current])?.scopePath).toBe('Shows/Example Show');
  });

  it('uses the nearest common ancestor of known series directories', () => {
    const first = episode(1, 'Shows/Example Show/Season 1/Episode S01E01.mkv', 1);
    const second = episode(2, 'Shows/Example Show/Season 2/Episode S02E01.mkv', 1, {
      seasonNumber: 2,
    });
    const unrelated = episode(3, 'Shows/Other Show/Episode S01E01.mkv', 1, {
      parsedTitle: 'Other Show',
      seriesMetadataKey: 'tv:other show:',
    });

    expect(buildFocusedDiscoveryPlan(first, [first, second, unrelated])?.scopePath).toBe(
      'Shows/Example Show',
    );
  });

  it('does not plan discovery for movies or entries without a directory', () => {
    const current = episode(1, 'Movie.mkv', 1, {
      detectedMediaType: 'movie',
      parsedTitle: 'Movie',
      seriesMetadataKey: undefined,
    });
    expect(buildFocusedDiscoveryPlan(current, [current])).toBeNull();
    expect(
      buildFocusedDiscoveryPlan({ ...current, detectedMediaType: 'tv', directoryId: undefined }, [
        current,
      ]),
    ).toBeNull();
  });

  it('retains the local identity fallback used by player navigation', () => {
    expect(
      catalogSeriesIdentity({
        detectedMediaType: 'tv',
        parsedTitle: 'Example Show',
        parsedYear: 2025,
      }),
    ).toBe('tv-local:Example Show:2025');
    expect(commonDirectoryPath(['Shows/Example/Season 1', 'Shows/Example/Season 2'])).toBe(
      'Shows/Example',
    );
  });
});

describe('focused discovery coordination', () => {
  it('coalesces active work and throttles a recently completed scope', async () => {
    let now = 100;
    let finish!: (value: ReturnType<typeof emptyFocusedDiscoveryResult>) => void;
    const coordinator = new FocusedDiscoveryCoordinator(1_000, () => now);
    const work = vi.fn(
      () =>
        new Promise<ReturnType<typeof emptyFocusedDiscoveryResult>>((resolve) => {
          finish = resolve;
        }),
    );

    const first = coordinator.run('scope', work);
    const duplicate = coordinator.run('scope', work);
    expect(duplicate).toBe(first);
    expect(work).toHaveBeenCalledTimes(1);

    finish(emptyFocusedDiscoveryResult('unchanged'));
    await expect(first).resolves.toEqual(expect.objectContaining({ status: 'unchanged' }));
    await expect(coordinator.run('scope', work)).resolves.toEqual(
      expect.objectContaining({ status: 'throttled' }),
    );
    expect(work).toHaveBeenCalledTimes(1);

    now += 1_001;
    const afterCooldown = coordinator.run('scope', async () =>
      emptyFocusedDiscoveryResult('updated'),
    );
    await expect(afterCooldown).resolves.toEqual(expect.objectContaining({ status: 'updated' }));
  });

  it('serializes catalog scans for the same configured directory', async () => {
    const coordinator = new DirectoryScanCoordinator();
    const events: string[] = [];
    let finishFirst!: () => void;

    const first = coordinator.run(4, async () => {
      events.push('first-start');
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      events.push('first-end');
      return 'first';
    });
    const second = coordinator.run(4, async () => {
      events.push('second-start');
      return 'second';
    });

    await vi.waitFor(() => expect(events).toEqual(['first-start']));
    finishFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['first-start', 'first-end', 'second-start']);
  });
});
