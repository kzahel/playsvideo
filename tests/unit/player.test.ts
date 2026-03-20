import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '../../app/src/db.js';
import { Player } from '../../app/src/pages/Player.js';

const { useLiveQueryMock, useEngineMock, useSettingMock, listSiblingSubtitleFilesMock } =
  vi.hoisted(() => ({
    useLiveQueryMock: vi.fn(),
    useEngineMock: vi.fn(),
    useSettingMock: vi.fn((_: string, defaultValue: unknown) => [defaultValue, vi.fn()]),
    listSiblingSubtitleFilesMock: vi.fn().mockResolvedValue([]),
  }));

vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: useLiveQueryMock,
}));

vi.mock('../../app/src/hooks/useEngine.js', () => ({
  useEngine: useEngineMock,
}));

vi.mock('../../app/src/hooks/useSetting.js', () => ({
  useSetting: useSettingMock,
}));

vi.mock('../../app/src/hooks/useCustomControls.js', () => ({
  useCustomControls: vi.fn(),
}));

vi.mock('../../app/src/hooks/useFullscreen.js', () => ({
  useFullscreen: vi.fn(),
}));

vi.mock('../../app/src/folder-provider.js', () => ({
  folderProvider: {
    requiresPermissionGrant: false,
    listSiblingSubtitleFiles: listSiblingSubtitleFilesMock,
  },
}));

function makeCatalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 1,
    createdAt: 1,
    updatedAt: 1,
    name: 'Episode.mkv',
    path: 'shows/show/episode.mkv',
    directoryId: 1,
    size: 1_000,
    lastModified: 123,
    availability: 'present',
    detectedMediaType: 'tv',
    seasonNumber: 1,
    episodeNumber: 1,
    hasLocalFile: true,
    canonicalPlaybackKey: 'file:Episode.mkv|1000',
    ...overrides,
  };
}

describe('Player', () => {
  beforeEach(() => {
    useLiveQueryMock.mockReset();
    useEngineMock.mockReset();
    useSettingMock.mockClear();
    listSiblingSubtitleFilesMock.mockClear();
    useEngineMock.mockReturnValue({
      videoRef: { current: null },
      status: 'Ready',
      phase: 'ready',
      hasEnded: false,
      needsPermission: false,
      retryPermission: vi.fn(),
      subtitleStatus: '',
      loadSubtitleFile: vi.fn(),
      clearExternalSubtitles: vi.fn(),
      copyDiagnostics: vi.fn(),
      diagnosticsStatus: '',
    });
  });

  it('renders the player when no playback row exists yet', async () => {
    const entry = makeCatalogEntry();

    useLiveQueryMock
      .mockReturnValueOnce(entry)
      .mockReturnValueOnce([entry])
      .mockReturnValueOnce('device-1')
      .mockReturnValueOnce(null);

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/play/1'] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/play/:id',
            element: createElement(Player),
          }),
        ),
      ),
    );

    expect(html).not.toContain('Loading...');
    expect(html).toContain('<video');
    expect(useEngineMock).toHaveBeenCalledWith({
      kind: 'entry',
      entry,
      playback: null,
      playbackTarget: {
        deviceId: 'device-1',
        playbackKey: 'file:Episode.mkv|1000',
      },
    });
  });

  it('renders not found instead of staying on loading when the catalog row is missing', async () => {
    useLiveQueryMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce([])
      .mockReturnValueOnce('device-1')
      .mockReturnValueOnce(null);

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/play/6'] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/play/:id',
            element: createElement(Player),
          }),
        ),
      ),
    );

    expect(html).not.toContain('Loading...');
    expect(html).toContain('Video not found.');
    expect(useEngineMock).toHaveBeenCalledWith(null);
  });

  it('renders the player while device id is still pending', async () => {
    const entry = makeCatalogEntry();

    useLiveQueryMock
      .mockReturnValueOnce(entry)
      .mockReturnValueOnce([entry])
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(null);

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/play/1'] },
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/play/:id',
            element: createElement(Player),
          }),
        ),
      ),
    );

    expect(html).not.toContain('Loading...');
    expect(html).toContain('<video');
    expect(useEngineMock).toHaveBeenCalledWith({
      kind: 'entry',
      entry,
      playback: null,
      playbackTarget: null,
    });
  });
});
