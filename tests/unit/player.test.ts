import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogEntry, PlaybackEntry } from '../../app/src/db.js';
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

vi.mock('../../app/src/hooks/useVideoJsControls.js', () => ({
  useVideoJsControls: vi.fn(),
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

function makePlaybackEntry(overrides: Partial<PlaybackEntry> = {}): PlaybackEntry {
  return {
    deviceId: 'device-1',
    playbackKey: 'file:Episode.mkv|1000',
    positionSec: 152,
    durationSec: 3600,
    watchState: 'in-progress',
    lastPlayedAt: 100,
    updatedAt: 100,
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
      savePosition: vi.fn(),
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
    expect(html).toContain('pv-video-host');
    expect(useEngineMock).toHaveBeenCalledWith(
      {
        kind: 'entry',
        entry,
        playback: null,
        playbackTarget: {
          deviceId: 'device-1',
          playbackKey: 'file:Episode.mkv|1000',
        },
      },
      'stock',
      null,
    );
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
    expect(useEngineMock).toHaveBeenCalledWith(null, 'stock', null);
  });

  it('waits for playback lookup before starting the player', async () => {
    const entry = makeCatalogEntry();

    useLiveQueryMock
      .mockReturnValueOnce(entry)
      .mockReturnValueOnce([entry])
      .mockImplementationOnce((_: unknown, __: unknown, defaultResult: unknown) => defaultResult)
      .mockImplementationOnce((_: unknown, __: unknown, defaultResult: unknown) => defaultResult);

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

    expect(html).toContain('Loading...');
    expect(useEngineMock).toHaveBeenCalledWith(null, 'stock', null);
  });

  it('waits when the playback lookup still contains the previous episode row', async () => {
    const entry = makeCatalogEntry({
      id: 2,
      name: 'Episode 2.mkv',
      path: 'shows/show/episode-2.mkv',
      episodeNumber: 2,
      canonicalPlaybackKey: 'file:Episode2.mkv|1000',
    });
    const stalePlayback = makePlaybackEntry({
      playbackKey: 'file:Episode1.mkv|1000',
      positionSec: 1520,
    });

    useLiveQueryMock
      .mockReturnValueOnce(entry)
      .mockReturnValueOnce([entry])
      .mockReturnValueOnce('device-1')
      .mockReturnValueOnce(stalePlayback);

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/play/2'] },
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

    expect(html).toContain('Loading...');
    expect(useEngineMock).toHaveBeenCalledWith(null, 'stock', null);
  });

  it('uses the route entry while the catalog lookup still contains the previous episode', async () => {
    const previousEntry = makeCatalogEntry();
    const nextEntry = makeCatalogEntry({
      id: 2,
      name: 'Episode 2.mkv',
      path: 'shows/show/episode-2.mkv',
      episodeNumber: 2,
      canonicalPlaybackKey: 'file:Episode2.mkv|1000',
    });

    useLiveQueryMock
      .mockReturnValueOnce(previousEntry)
      .mockReturnValueOnce([previousEntry, nextEntry])
      .mockReturnValueOnce('device-1')
      .mockReturnValueOnce(null);

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {
          initialEntries: [
            {
              pathname: '/play/2',
              state: { entry: nextEntry, startAtBeginning: true },
            },
          ],
        },
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
    expect(useEngineMock).toHaveBeenCalledWith(
      {
        kind: 'entry',
        entry: nextEntry,
        playback: null,
        playbackTarget: {
          deviceId: 'device-1',
          playbackKey: 'file:Episode2.mkv|1000',
        },
      },
      'stock',
      null,
    );
  });

  it('starts next-episode route navigation at the beginning even when playback exists', async () => {
    const entry = makeCatalogEntry();
    const playback = makePlaybackEntry({
      positionSec: 900,
      lastPlayedAt: 1_000,
      updatedAt: 1_000,
    });

    useLiveQueryMock
      .mockReturnValueOnce(entry)
      .mockReturnValueOnce([entry])
      .mockReturnValueOnce('device-1')
      .mockReturnValueOnce(playback);

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {
          initialEntries: [
            {
              pathname: '/play/1',
              state: { entry, startAtBeginning: true },
            },
          ],
        },
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
    expect(useEngineMock).toHaveBeenCalledWith(
      {
        kind: 'entry',
        entry,
        playback: null,
        playbackTarget: {
          deviceId: 'device-1',
          playbackKey: 'file:Episode.mkv|1000',
        },
      },
      'stock',
      null,
    );
  });

  it('uses route resume playback when no local playback exists', async () => {
    const entry = makeCatalogEntry();
    const resumePlayback = makePlaybackEntry({
      deviceId: 'remote-device',
      positionSec: 152,
      lastPlayedAt: 500,
      updatedAt: 500,
    });

    useLiveQueryMock
      .mockReturnValueOnce(entry)
      .mockReturnValueOnce([entry])
      .mockReturnValueOnce('device-1')
      .mockReturnValueOnce(null);

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {
          initialEntries: [
            {
              pathname: '/play/1',
              state: {
                resumePlayback: {
                  playbackKey: resumePlayback.playbackKey,
                  positionSec: resumePlayback.positionSec,
                  durationSec: resumePlayback.durationSec,
                  watchState: resumePlayback.watchState,
                  lastPlayedAt: resumePlayback.lastPlayedAt,
                },
              },
            },
          ],
        },
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
    expect(useEngineMock).toHaveBeenCalledWith(
      {
        kind: 'entry',
        entry,
        playback: {
          deviceId: 'device-1',
          playbackKey: 'file:Episode.mkv|1000',
          positionSec: 152,
          durationSec: 3600,
          watchState: 'in-progress',
          lastPlayedAt: 500,
          updatedAt: 500,
        },
        playbackTarget: {
          deviceId: 'device-1',
          playbackKey: 'file:Episode.mkv|1000',
        },
      },
      'stock',
      null,
    );
  });

  it('uses route resume playback without waiting for a local playback lookup', async () => {
    const entry = makeCatalogEntry();
    const resumePlayback = makePlaybackEntry({
      positionSec: 420,
      lastPlayedAt: 700,
      updatedAt: 700,
    });

    useLiveQueryMock
      .mockReturnValueOnce(entry)
      .mockReturnValueOnce([entry])
      .mockReturnValueOnce('device-1')
      .mockImplementationOnce((_: unknown, __: unknown, defaultResult: unknown) => defaultResult);

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {
          initialEntries: [
            {
              pathname: '/play/1',
              state: {
                resumePlayback: {
                  playbackKey: resumePlayback.playbackKey,
                  positionSec: resumePlayback.positionSec,
                  durationSec: resumePlayback.durationSec,
                  watchState: resumePlayback.watchState,
                  lastPlayedAt: resumePlayback.lastPlayedAt,
                },
              },
            },
          ],
        },
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
    expect(useEngineMock).toHaveBeenCalledWith(
      {
        kind: 'entry',
        entry,
        playback: {
          deviceId: 'device-1',
          playbackKey: 'file:Episode.mkv|1000',
          positionSec: 420,
          durationSec: 3600,
          watchState: 'in-progress',
          lastPlayedAt: 700,
          updatedAt: 700,
        },
        playbackTarget: {
          deviceId: 'device-1',
          playbackKey: 'file:Episode.mkv|1000',
        },
      },
      'stock',
      null,
    );
  });

  it('uses route resume playback over a newer local playback row', async () => {
    const entry = makeCatalogEntry();
    const localPlayback = makePlaybackEntry({
      positionSec: 900,
      lastPlayedAt: 1_000,
      updatedAt: 1_000,
    });
    const routeResumePlayback = makePlaybackEntry({
      deviceId: 'phone',
      positionSec: 600,
      lastPlayedAt: 500,
      updatedAt: 500,
    });

    useLiveQueryMock
      .mockReturnValueOnce(entry)
      .mockReturnValueOnce([entry])
      .mockReturnValueOnce('device-1')
      .mockReturnValueOnce(localPlayback);

    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        {
          initialEntries: [
            {
              pathname: '/play/1',
              state: {
                resumePlayback: {
                  playbackKey: routeResumePlayback.playbackKey,
                  positionSec: routeResumePlayback.positionSec,
                  durationSec: routeResumePlayback.durationSec,
                  watchState: routeResumePlayback.watchState,
                  lastPlayedAt: routeResumePlayback.lastPlayedAt,
                },
              },
            },
          ],
        },
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
    expect(useEngineMock).toHaveBeenCalledWith(
      {
        kind: 'entry',
        entry,
        playback: {
          deviceId: 'device-1',
          playbackKey: 'file:Episode.mkv|1000',
          positionSec: 600,
          durationSec: 3600,
          watchState: 'in-progress',
          lastPlayedAt: 500,
          updatedAt: 500,
        },
        playbackTarget: {
          deviceId: 'device-1',
          playbackKey: 'file:Episode.mkv|1000',
        },
      },
      'stock',
      null,
    );
  });
});
