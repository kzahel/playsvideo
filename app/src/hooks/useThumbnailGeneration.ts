import { useEffect } from 'react';
import {
  db,
  type CatalogEntry,
  type FailedThumbnailCacheEntry,
  type ReadyThumbnailCacheEntry,
} from '../db.js';
import { isFileAccessPermissionError } from '../folder-provider.js';
import { getFile } from '../scan.js';
import {
  getLocalThumbnailCacheKey,
  LOCAL_THUMBNAIL_GENERATOR_VERSION,
} from '../thumbnails/cache.js';
import { ThumbnailWorkerClient } from '../thumbnails/client.js';

function waitForIdle(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let idleCallbackId: number | undefined;
    let timeoutId: number | undefined;
    const finish = () => {
      if (idleCallbackId != null) {
        window.cancelIdleCallback(idleCallbackId);
      }
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
      signal.removeEventListener('abort', finish);
      resolve();
    };

    signal.addEventListener('abort', finish, { once: true });
    if (typeof window.requestIdleCallback === 'function') {
      idleCallbackId = window.requestIdleCallback(finish, { timeout: 1500 });
    } else {
      timeoutId = window.setTimeout(finish, 0);
    }
  });
}

function waitUntilVisible(signal: AbortSignal): Promise<void> {
  if (document.visibilityState !== 'hidden' || signal.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const finish = () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      finish();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function describeError(error: unknown): string {
  const description =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return description.slice(0, 500);
}

async function replaceLocalThumbnail(
  entry: CatalogEntry,
  thumbnail: ReadyThumbnailCacheEntry | FailedThumbnailCacheEntry,
): Promise<void> {
  await db.transaction('rw', db.thumbnailCache, async () => {
    await db.thumbnailCache
      .where('[catalogId+source]')
      .equals([entry.id, 'local-video'])
      .delete();
    await db.thumbnailCache.put(thumbnail);
  });
}

export function useThumbnailGeneration(entries?: readonly CatalogEntry[]): void {
  const queueKey =
    entries
      ?.map((entry) => getLocalThumbnailCacheKey(entry))
      .filter((key): key is string => key != null)
      .join('\n') ?? '';

  useEffect(() => {
    const eligibleEntries =
      entries?.filter((entry) => getLocalThumbnailCacheKey(entry) != null) ?? [];
    if (eligibleEntries.length === 0) {
      return;
    }

    const controller = new AbortController();
    const client = new ThumbnailWorkerClient();

    const runQueue = async () => {
      for (const entry of eligibleEntries) {
        if (controller.signal.aborted) {
          return;
        }

        const key = getLocalThumbnailCacheKey(entry);
        if (!key || (await db.thumbnailCache.get(key))) {
          continue;
        }

        await waitUntilVisible(controller.signal);
        await waitForIdle(controller.signal);
        if (controller.signal.aborted) {
          return;
        }

        try {
          const file = await getFile(entry);
          const result = await client.generate(file);
          if (controller.signal.aborted) {
            return;
          }

          await replaceLocalThumbnail(entry, {
            key,
            catalogId: entry.id,
            source: 'local-video',
            blob: result.blob,
            width: result.width,
            height: result.height,
            selectedTimestampSec: result.selectedTimestampSec,
            createdAt: Date.now(),
            generatorVersion: LOCAL_THUMBNAIL_GENERATOR_VERSION,
            status: 'ready',
            debugReason: result.debugReason,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }
          if (isFileAccessPermissionError(error)) {
            return;
          }

          await replaceLocalThumbnail(entry, {
            key,
            catalogId: entry.id,
            source: 'local-video',
            createdAt: Date.now(),
            generatorVersion: LOCAL_THUMBNAIL_GENERATOR_VERSION,
            status: 'failed',
            debugReason: describeError(error),
          });
        }
      }
    };

    void runQueue();
    return () => {
      controller.abort();
      client.dispose();
    };
  }, [queueKey]);
}
