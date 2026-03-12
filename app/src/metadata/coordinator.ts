import { metadataRepository } from './repository.js';

const MAX_CONCURRENT_REQUESTS = 1;
const DIRECT_TRANSPORT_STATE_KEY = 'transport:direct:primary';
const DEFAULT_RETRY_AFTER_MS = 60_000;

type QueueJob<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

export class MetadataTransportCooldownError extends Error {
  constructor(message: string, readonly cooldownUntil: number) {
    super(message);
    this.name = 'MetadataTransportCooldownError';
  }
}

export class MetadataTransportInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetadataTransportInvalidError';
  }
}

const inFlightRequests = new Map<string, Promise<unknown>>();
const requestQueue: QueueJob<unknown>[] = [];
let activeRequests = 0;

export const metadataCoordinator = {
  async fetchJson<T>(requestKey: string, url: string, token: string): Promise<T> {
    const existing = inFlightRequests.get(requestKey);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = enqueue(async () => {
      await ensureDirectTransportAvailable();

      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.status === 429) {
        const retryAfterMs = getRetryAfterMs(response.headers.get('Retry-After'));
        const cooldownUntil = Date.now() + retryAfterMs;
        await metadataRepository.putTransportState({
          key: DIRECT_TRANSPORT_STATE_KEY,
          transport: 'direct',
          credentialSlot: 'primary',
          status: 'cooldown',
          cooldownUntil,
          lastError: `429 Too Many Requests`,
          updatedAt: Date.now(),
        });
        throw new MetadataTransportCooldownError(
          `TMDB direct transport cooling down until ${new Date(cooldownUntil).toISOString()}`,
          cooldownUntil,
        );
      }

      if (response.status === 401 || response.status === 403) {
        await metadataRepository.putTransportState({
          key: DIRECT_TRANSPORT_STATE_KEY,
          transport: 'direct',
          credentialSlot: 'primary',
          status: 'invalid',
          lastError: `TMDB request failed with ${response.status}`,
          updatedAt: Date.now(),
        });
        throw new MetadataTransportInvalidError(`TMDB request failed with ${response.status}`);
      }

      if (!response.ok) {
        throw new Error(`TMDB request failed with ${response.status}`);
      }

      await metadataRepository.putTransportState({
        key: DIRECT_TRANSPORT_STATE_KEY,
        transport: 'direct',
        credentialSlot: 'primary',
        status: 'healthy',
        updatedAt: Date.now(),
      });

      return (await response.json()) as T;
    });

    inFlightRequests.set(requestKey, promise);
    promise.finally(() => {
      inFlightRequests.delete(requestKey);
    });

    return promise;
  },
};

async function ensureDirectTransportAvailable(): Promise<void> {
  const state = await metadataRepository.getTransportState(DIRECT_TRANSPORT_STATE_KEY);
  if (!state) {
    return;
  }

  if (state.status === 'invalid') {
    throw new MetadataTransportInvalidError(
      state.lastError ?? 'TMDB direct transport is marked invalid',
    );
  }

  if (state.status === 'cooldown' && state.cooldownUntil && state.cooldownUntil > Date.now()) {
    throw new MetadataTransportCooldownError(
      state.lastError ?? `TMDB direct transport cooling down until ${new Date(state.cooldownUntil).toISOString()}`,
      state.cooldownUntil,
    );
  }
}

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    requestQueue.push({
      run,
      resolve,
      reject,
    });
    pumpQueue();
  });
}

function pumpQueue(): void {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && requestQueue.length > 0) {
    const job = requestQueue.shift();
    if (!job) {
      return;
    }

    activeRequests += 1;
    job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        activeRequests -= 1;
        pumpQueue();
      });
  }
}

function getRetryAfterMs(retryAfterHeader: string | null): number {
  if (!retryAfterHeader) {
    return DEFAULT_RETRY_AFTER_MS;
  }

  const seconds = Number.parseFloat(retryAfterHeader);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.ceil(seconds * 1000);
  }

  const retryAt = Date.parse(retryAfterHeader);
  if (Number.isFinite(retryAt)) {
    return Math.max(retryAt - Date.now(), DEFAULT_RETRY_AFTER_MS);
  }

  return DEFAULT_RETRY_AFTER_MS;
}
