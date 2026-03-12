import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type CredentialSlot = 'primary' | 'standby';
type Credential = {
  slot: CredentialSlot;
  token: string;
};

type TransportState = {
  key: string;
  transport: 'direct';
  credentialSlot: CredentialSlot;
  status: 'healthy' | 'cooldown' | 'invalid';
  cooldownUntil?: number;
  lastError?: string;
  updatedAt: number;
};

type RepositoryMock = {
  listTmdbCredentials: ReturnType<typeof vi.fn>;
  getTransportState: ReturnType<typeof vi.fn>;
  putTransportState: ReturnType<typeof vi.fn>;
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json',
    },
    ...init,
  });
}

async function flushMicrotasks(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

async function loadCoordinator(options?: {
  credentials?: Credential[];
  transportStateByKey?: Record<string, TransportState | undefined>;
}) {
  vi.resetModules();

  const transportStateByKey = new Map(Object.entries(options?.transportStateByKey ?? {}));
  const repository: RepositoryMock = {
    listTmdbCredentials: vi.fn(async () => options?.credentials ?? []),
    getTransportState: vi.fn(async (key: string) => transportStateByKey.get(key)),
    putTransportState: vi.fn(async (entry: TransportState) => {
      transportStateByKey.set(entry.key, entry);
    }),
  };

  vi.doMock('../../app/src/metadata/repository.js', () => ({
    metadataRepository: repository,
  }));

  const module = await import('../../app/src/metadata/coordinator.js');
  return {
    ...module,
    repository,
  };
}

describe('metadataCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T18:00:00.000Z'));
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses the primary credential when healthy', async () => {
    const { metadataCoordinator, repository } = await loadCoordinator({
      credentials: [
        { slot: 'primary', token: 'primary-token' },
        { slot: 'standby', token: 'standby-token' },
      ],
    });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(jsonResponse({ id: 1399 }));

    await expect(
      metadataCoordinator.fetchJson('tv:yellowstone', 'https://example.test/tv/search'),
    ).resolves.toEqual({ id: 1399 });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledWith('https://example.test/tv/search', {
      headers: {
        accept: 'application/json',
        Authorization: 'Bearer primary-token',
      },
    });
    expect(repository.putTransportState).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'transport:direct:primary',
        credentialSlot: 'primary',
        status: 'healthy',
      }),
    );
  });

  it('falls back to the standby credential after a 429 and stores cooldown state', async () => {
    const { metadataCoordinator, repository } = await loadCoordinator({
      credentials: [
        { slot: 'primary', token: 'primary-token' },
        { slot: 'standby', token: 'standby-token' },
      ],
    });

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response('', {
          status: 429,
          headers: {
            'Retry-After': '15',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 1399 }));

    await expect(
      metadataCoordinator.fetchJson('tv:yellowstone', 'https://example.test/tv/search'),
    ).resolves.toEqual({ id: 1399 });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(1, 'https://example.test/tv/search', {
      headers: {
        accept: 'application/json',
        Authorization: 'Bearer primary-token',
      },
    });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, 'https://example.test/tv/search', {
      headers: {
        accept: 'application/json',
        Authorization: 'Bearer standby-token',
      },
    });
    expect(repository.putTransportState).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        key: 'transport:direct:primary',
        credentialSlot: 'primary',
        status: 'cooldown',
        cooldownUntil: Date.now() + 15_000,
        lastError: '429 Too Many Requests',
      }),
    );
    expect(repository.putTransportState).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        key: 'transport:direct:standby',
        credentialSlot: 'standby',
        status: 'healthy',
      }),
    );
  });

  it('falls back to the standby credential after a 401 and marks primary invalid', async () => {
    const { metadataCoordinator, repository } = await loadCoordinator({
      credentials: [
        { slot: 'primary', token: 'primary-token' },
        { slot: 'standby', token: 'standby-token' },
      ],
    });

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ id: 1399 }));

    await expect(
      metadataCoordinator.fetchJson('tv:yellowstone', 'https://example.test/tv/search'),
    ).resolves.toEqual({ id: 1399 });

    expect(repository.putTransportState).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        key: 'transport:direct:primary',
        credentialSlot: 'primary',
        status: 'invalid',
        lastError: 'TMDB request failed with 401',
      }),
    );
    expect(repository.putTransportState).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        key: 'transport:direct:standby',
        credentialSlot: 'standby',
        status: 'healthy',
      }),
    );
  });

  it('surfaces the earliest cooldown when all configured credentials are cooling down', async () => {
    const { metadataCoordinator, MetadataTransportCooldownError } = await loadCoordinator({
      credentials: [
        { slot: 'primary', token: 'primary-token' },
        { slot: 'standby', token: 'standby-token' },
      ],
      transportStateByKey: {
        'transport:direct:primary': {
          key: 'transport:direct:primary',
          transport: 'direct',
          credentialSlot: 'primary',
          status: 'cooldown',
          cooldownUntil: Date.now() + 30_000,
          updatedAt: Date.now(),
        },
        'transport:direct:standby': {
          key: 'transport:direct:standby',
          transport: 'direct',
          credentialSlot: 'standby',
          status: 'cooldown',
          cooldownUntil: Date.now() + 10_000,
          updatedAt: Date.now(),
        },
      },
    });

    await expect(
      metadataCoordinator.fetchJson('tv:yellowstone', 'https://example.test/tv/search'),
    ).rejects.toEqual(
      expect.objectContaining<Partial<InstanceType<typeof MetadataTransportCooldownError>>>({
        name: 'MetadataTransportCooldownError',
        cooldownUntil: Date.now() + 10_000,
      }),
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('throws when no credentials are configured', async () => {
    const { metadataCoordinator, MetadataTransportInvalidError } = await loadCoordinator();

    await expect(
      metadataCoordinator.fetchJson('tv:yellowstone', 'https://example.test/tv/search'),
    ).rejects.toEqual(
      expect.objectContaining<Partial<InstanceType<typeof MetadataTransportInvalidError>>>({
        name: 'MetadataTransportInvalidError',
        message: 'No TMDB credentials are configured',
      }),
    );

    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('dedupes concurrent requests by request key', async () => {
    const { metadataCoordinator } = await loadCoordinator({
      credentials: [{ slot: 'primary', token: 'primary-token' }],
    });

    let releaseFetch: (() => void) | null = null;
    vi.mocked(globalThis.fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          releaseFetch = () => resolve(jsonResponse({ id: 1399 }));
        }),
    );

    const first = metadataCoordinator.fetchJson('tv:yellowstone', 'https://example.test/tv/search');
    const second = metadataCoordinator.fetchJson('tv:yellowstone', 'https://example.test/tv/search');

    await flushMicrotasks();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    releaseFetch?.();

    await expect(Promise.all([first, second])).resolves.toEqual([{ id: 1399 }, { id: 1399 }]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('parses Retry-After HTTP dates for cooldown state', async () => {
    const retryAt = new Date(Date.now() + 45_000).toUTCString();
    const { metadataCoordinator, repository } = await loadCoordinator({
      credentials: [{ slot: 'primary', token: 'primary-token' }],
    });

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response('', {
        status: 429,
        headers: {
          'Retry-After': retryAt,
        },
      }),
    );

    await expect(
      metadataCoordinator.fetchJson('tv:yellowstone', 'https://example.test/tv/search'),
    ).rejects.toMatchObject({
      name: 'MetadataTransportCooldownError',
      cooldownUntil: Date.now() + 60_000,
    });

    expect(repository.putTransportState).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'transport:direct:primary',
        status: 'cooldown',
        cooldownUntil: Date.now() + 60_000,
      }),
    );
  });
});
