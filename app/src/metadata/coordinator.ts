import type { MetadataCredentialSlot, MetadataTransportStateEntry } from '../db.js';
import { metadataRepository, type TmdbCredential } from './repository.js';

const MAX_CONCURRENT_REQUESTS = 1;
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
  async fetchJson<T>(requestKey: string, url: string): Promise<T> {
    const existing = inFlightRequests.get(requestKey);
    if (existing) {
      return existing as Promise<T>;
    }

    const promise = enqueue(async () => {
      return fetchWithCredentialFallback<T>(url);
    });

    inFlightRequests.set(requestKey, promise);
    promise.then(
      () => {
        inFlightRequests.delete(requestKey);
      },
      () => {
        inFlightRequests.delete(requestKey);
      },
    );

    return promise;
  },
};

async function fetchWithCredentialFallback<T>(url: string): Promise<T> {
  const attemptedSlots = new Set<MetadataCredentialSlot>();

  while (true) {
    const selection = await selectCredential(attemptedSlots);
    if (!selection) {
      throw new MetadataTransportInvalidError('No TMDB credentials are configured');
    }

    if ('cooldownUntil' in selection) {
      throw new MetadataTransportCooldownError(
        `TMDB direct transport cooling down until ${new Date(selection.cooldownUntil).toISOString()}`,
        selection.cooldownUntil,
      );
    }

    const { credential } = selection;
    attemptedSlots.add(credential.slot);

    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${credential.token}`,
      },
    });

    if (response.status === 429) {
      const retryAfterMs = getRetryAfterMs(response.headers.get('Retry-After'));
      const cooldownUntil = Date.now() + retryAfterMs;
      await metadataRepository.putTransportState({
        key: buildTransportStateKey(credential.slot),
        transport: 'direct',
        credentialSlot: credential.slot,
        status: 'cooldown',
        cooldownUntil,
        lastError: `429 Too Many Requests`,
        updatedAt: Date.now(),
      });
      if (await hasAlternativeCredential(attemptedSlots)) {
        continue;
      }
      throw new MetadataTransportCooldownError(
        `TMDB ${credential.slot} credential cooling down until ${new Date(cooldownUntil).toISOString()}`,
        cooldownUntil,
      );
    }

    if (response.status === 401 || response.status === 403) {
      await metadataRepository.putTransportState({
        key: buildTransportStateKey(credential.slot),
        transport: 'direct',
        credentialSlot: credential.slot,
        status: 'invalid',
        lastError: `TMDB request failed with ${response.status}`,
        updatedAt: Date.now(),
      });
      if (await hasAlternativeCredential(attemptedSlots)) {
        continue;
      }
      throw new MetadataTransportInvalidError(`TMDB request failed with ${response.status}`);
    }

    if (!response.ok) {
      throw new Error(`TMDB request failed with ${response.status}`);
    }

    await metadataRepository.putTransportState({
      key: buildTransportStateKey(credential.slot),
      transport: 'direct',
      credentialSlot: credential.slot,
      status: 'healthy',
      updatedAt: Date.now(),
    });

    return (await response.json()) as T;
  }
}

async function hasAlternativeCredential(
  attemptedSlots: Set<MetadataCredentialSlot>,
): Promise<boolean> {
  const credentials = await metadataRepository.listTmdbCredentials();
  return credentials.some((credential) => !attemptedSlots.has(credential.slot));
}

async function selectCredential(
  attemptedSlots: Set<MetadataCredentialSlot>,
):
  | { credential: TmdbCredential }
  | { cooldownUntil: number }
  | null {
  const credentials = await metadataRepository.listTmdbCredentials();
  if (credentials.length === 0) {
    return null;
  }

  let earliestCooldownUntil: number | undefined;

  for (const credential of credentials) {
    if (attemptedSlots.has(credential.slot)) {
      continue;
    }

    const state = await metadataRepository.getTransportState(buildTransportStateKey(credential.slot));
    if (!state) {
      return { credential };
    }

    if (state.status === 'invalid') {
      continue;
    }

    if (state.status === 'cooldown' && state.cooldownUntil && state.cooldownUntil > Date.now()) {
      earliestCooldownUntil =
        earliestCooldownUntil == null
          ? state.cooldownUntil
          : Math.min(earliestCooldownUntil, state.cooldownUntil);
      continue;
    }

    return { credential };
  }

  if (earliestCooldownUntil != null) {
    return { cooldownUntil: earliestCooldownUntil };
  }

  return null;
}

function buildTransportStateKey(slot: MetadataCredentialSlot): string {
  return `transport:direct:${slot}`;
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
