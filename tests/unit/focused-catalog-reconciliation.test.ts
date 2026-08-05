import { describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../../app/src/db.js';
import type { ScannedFile, ScannedManifest } from '../../app/src/folder-provider.js';
import {
  planFocusedCatalogUpdates,
  planFullCatalogReconciliation,
} from '../../app/src/scanning/catalog-reconciliation.js';
import type { FocusedDiscoveryPlan } from '../../app/src/scanning/focused-discovery.js';

const discovery: FocusedDiscoveryPlan = {
  directoryId: 4,
  scopePath: 'Shows/Example Show',
  seriesIdentity: 'tv:example show:',
  maxEntries: 2_000,
};

function existingEpisode(
  id: number,
  episodeNumber: number,
  overrides: Partial<CatalogEntry> = {},
): CatalogEntry {
  const name = `Example.Show.S01E${String(episodeNumber).padStart(2, '0')}.mkv`;
  return {
    id,
    createdAt: 1,
    updatedAt: 1,
    name,
    path: `Shows/Example Show/${name}`,
    directoryId: 4,
    size: 1_000,
    lastModified: 10,
    availability: 'present',
    lastSeenAt: 1,
    detectedMediaType: 'tv',
    parsedTitle: 'Example Show',
    seasonNumber: 1,
    episodeNumber,
    seriesMetadataKey: 'tv:example show:',
    hasLocalFile: true,
    canonicalPlaybackKey: `file:${name}|1000`,
    ...overrides,
  };
}

function scannedEpisode(episodeNumber: number): ScannedFile {
  const name = `Example.Show.S01E${String(episodeNumber).padStart(2, '0')}.mkv`;
  return {
    name,
    path: `Shows/Example Show/${name}`,
    size: 1_000,
    lastModified: 10,
  };
}

function plan(input: {
  files: ScannedFile[];
  manifests?: ScannedManifest[];
  catalog?: CatalogEntry[];
}) {
  return planFocusedCatalogUpdates({
    discovery,
    files: input.files,
    manifests: input.manifests ?? [],
    allCatalogEntries: input.catalog ?? [],
    seriesMetadata: [],
    movieMetadata: [],
    scannedAt: 500,
  });
}

describe('focused catalog reconciliation', () => {
  it('adds a matching next episode without rewriting an unchanged current episode', () => {
    const current = existingEpisode(1, 1);
    const result = plan({
      files: [scannedEpisode(1), scannedEpisode(2)],
      catalog: [current],
    });

    expect(result.relevantFileCount).toBe(2);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toEqual(
      expect.objectContaining({
        path: 'Shows/Example Show/Example.Show.S01E02.mkv',
        episodeNumber: 2,
        availability: 'present',
        hasLocalFile: true,
      }),
    );
  });

  it('ignores unrelated media and never produces missing-row mutations', () => {
    const absentKnownEpisode = existingEpisode(3, 3);
    const result = plan({
      files: [
        {
          name: 'Other.Show.S01E02.mkv',
          path: 'Shows/Example Show/Other.Show.S01E02.mkv',
          size: 1_000,
          lastModified: 10,
        },
      ],
      catalog: [absentKnownEpisode],
    });

    expect(result).toEqual({ updates: [], relevantFileCount: 0 });
    expect(absentKnownEpisode.availability).toBe('present');
  });

  it('does not promote a known-incomplete JSTorrent file', () => {
    const file = scannedEpisode(2);
    const manifest: ScannedManifest = {
      path: 'Shows/Example Show/.1234567890abcdef1234567890abcdef12345678.jstorrent.json',
      data: {
        infohash: 'abc',
        magnet: 'magnet:?xt=urn:btih:abc',
        files: { [file.name]: { index: 1, complete: false } },
      },
    };

    expect(plan({ files: [file], manifests: [manifest] })).toEqual({
      updates: [],
      relevantFileCount: 0,
    });
  });

  it('retains known-incomplete state when a focused scope cannot see its manifest', () => {
    const incomplete = existingEpisode(2, 2, {
      size: 0,
      lastModified: 0,
      hasLocalFile: false,
      torrentInfoHash: 'abc',
      torrentFileIndex: 1,
      torrentMagnetUrl: 'magnet:?xt=urn:btih:abc',
      torrentComplete: false,
      canonicalPlaybackKey: 'torrent:abc:1',
    });

    expect(plan({ files: [scannedEpisode(2)], catalog: [incomplete] })).toEqual({
      updates: [],
      relevantFileCount: 0,
    });
  });

  it('restores a missing matching episode when a playable file is observed', () => {
    const missing = existingEpisode(2, 2, {
      availability: 'missing',
      hasLocalFile: false,
      firstMissingAt: 100,
    });
    const result = plan({ files: [scannedEpisode(2)], catalog: [missing] });

    expect(result.updates).toEqual([
      expect.objectContaining({
        id: 2,
        availability: 'present',
        hasLocalFile: true,
        firstMissingAt: undefined,
      }),
    ]);
  });
});

describe('full catalog reconciliation planning', () => {
  it('remains authoritative for missing rows after the pure extraction', () => {
    const observed = existingEpisode(1, 1);
    const unseen = existingEpisode(2, 2);
    const result = planFullCatalogReconciliation({
      directoryId: 4,
      files: [scannedEpisode(1)],
      manifests: [],
      allCatalogEntries: [observed, unseen],
      seriesMetadata: [],
      movieMetadata: [],
      scannedAt: 500,
    });

    expect(result.nextCatalogEntries).toEqual([
      expect.objectContaining({ id: 1, availability: 'present', lastSeenAt: 500 }),
    ]);
    expect(result.missingCatalogEntries).toEqual([
      expect.objectContaining({
        id: 2,
        availability: 'missing',
        hasLocalFile: false,
        firstMissingAt: 500,
      }),
    ]);
  });
});
