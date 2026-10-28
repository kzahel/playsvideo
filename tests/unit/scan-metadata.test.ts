import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setFolder } from '../../app/src/scan.js';

const mocks = vi.hoisted(() => ({
  catalog: { toArray: vi.fn(), bulkPut: vi.fn() },
  directories: { update: vi.fn() },
  pickFolder: vi.fn(),
  refreshMetadata: vi.fn(),
}));

vi.mock('../../app/src/db.js', () => ({
  db: {
    catalog: mocks.catalog,
    directories: mocks.directories,
    seriesMetadata: { toArray: async () => [] },
    movieMetadata: { toArray: async () => [] },
    transaction: async (...args: unknown[]) => (args.at(-1) as () => Promise<void>)(),
  },
}));
vi.mock('../../app/src/folder-provider.js', () => ({
  folderProvider: { pickFolder: mocks.pickFolder },
  isFileAccessPermissionError: () => false,
}));
vi.mock('../../app/src/metadata/client.js', () => ({
  refreshCatalogMetadata: mocks.refreshMetadata,
}));
vi.mock('../../app/src/handoff/pending-handoffs.js', () => ({
  reconcilePendingHandoffs: async () => {},
}));
vi.mock('../../app/src/playback-identity-resolver.js', () => ({
  backfillCatalogAliases: async () => {},
}));

describe('scan metadata refresh', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.catalog.toArray.mockResolvedValue([]);
    mocks.pickFolder.mockResolvedValue({
      directoryId: 4,
      files: [{ name: 'Movie.mp4', path: 'Movie.mp4', size: 100, lastModified: 1 }],
      manifests: [],
    });
  });

  it('refreshes newly scanned files using their generated database IDs', async () => {
    mocks.catalog.bulkPut.mockResolvedValue([42]);

    await setFolder();

    expect(mocks.refreshMetadata).toHaveBeenCalledWith({
      entries: [expect.objectContaining({ id: 42, path: 'Movie.mp4', directoryId: 4 })],
    });
  });

  it('does not refresh metadata when persistence fails', async () => {
    mocks.catalog.bulkPut.mockRejectedValue(new Error('Storage full'));

    await expect(setFolder()).rejects.toThrow('Storage full');

    expect(mocks.refreshMetadata).not.toHaveBeenCalled();
  });
});
