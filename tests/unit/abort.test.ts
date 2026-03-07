import { describe, expect, it } from 'vitest';
import { checkAbort, type AbortableSource } from '../../src/pipeline/source-signal.js';
import { isAbortableSource } from '../../src/pipeline/source-signal.js';

/**
 * SlowSource — mock that delays reads and responds to AbortSignal.
 * Used to test abort/cancellation without real files or torrents.
 */
class SlowSource implements AbortableSource {
  private data: Uint8Array;
  private delayMs: number;
  currentSignal: AbortSignal | null = null;
  readCount = 0;
  abortCount = 0;

  constructor(size: number, delayMs = 100) {
    this.data = new Uint8Array(size);
    this.delayMs = delayMs;
  }

  setCurrentSignal(signal: AbortSignal | null): void {
    this.currentSignal = signal;
  }

  _retrieveSize(): number {
    return this.data.byteLength;
  }

  _read(
    start: number,
    end: number,
  ): Promise<{ bytes: Uint8Array; view: DataView; offset: number }> {
    this.readCount++;
    const signal = this.currentSignal;

    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        this.abortCount++;
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }

      const timer = setTimeout(() => {
        const slice = this.data.slice(start, Math.min(end, this.data.byteLength));
        resolve({
          bytes: slice,
          view: new DataView(slice.buffer, slice.byteOffset, slice.byteLength),
          offset: start,
        });
      }, this.delayMs);

      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        this.abortCount++;
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  }

  _dispose(): void {}
}

describe('checkAbort', () => {
  it('does nothing when signal is not aborted', () => {
    const controller = new AbortController();
    expect(() => checkAbort(controller.signal)).not.toThrow();
  });

  it('does nothing when signal is undefined', () => {
    expect(() => checkAbort(undefined)).not.toThrow();
  });

  it('throws AbortError when signal is aborted', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => checkAbort(controller.signal)).toThrow(DOMException);
    try {
      checkAbort(controller.signal);
    } catch (err) {
      expect((err as DOMException).name).toBe('AbortError');
    }
  });
});

describe('isAbortableSource', () => {
  it('returns true for objects with setCurrentSignal', () => {
    const source = new SlowSource(100);
    expect(isAbortableSource(source)).toBe(true);
  });

  it('returns false for plain objects', () => {
    expect(isAbortableSource({})).toBe(false);
    expect(isAbortableSource(null)).toBe(false);
    expect(isAbortableSource(42)).toBe(false);
  });
});

describe('SlowSource', () => {
  it('resolves when not aborted', async () => {
    const source = new SlowSource(1000, 10);
    const result = await source._read(0, 100);
    expect(result.bytes.byteLength).toBe(100);
    expect(result.offset).toBe(0);
    expect(source.readCount).toBe(1);
  });

  it('rejects with AbortError when signal fires during read', async () => {
    const source = new SlowSource(1000, 5000);
    const controller = new AbortController();
    source.setCurrentSignal(controller.signal);

    const readPromise = source._read(0, 100);

    // Abort after read starts but before it completes
    controller.abort();

    await expect(readPromise).rejects.toThrow();
    try {
      await readPromise;
    } catch (err) {
      expect((err as DOMException).name).toBe('AbortError');
    }
    expect(source.abortCount).toBe(1);
  });

  it('rejects immediately when signal is already aborted', async () => {
    const source = new SlowSource(1000, 5000);
    const controller = new AbortController();
    controller.abort();
    source.setCurrentSignal(controller.signal);

    await expect(source._read(0, 100)).rejects.toThrow();
    expect(source.abortCount).toBe(1);
  });

  it('can be reused after abort with a new signal', async () => {
    const source = new SlowSource(1000, 10);

    // First read: abort
    const controller1 = new AbortController();
    source.setCurrentSignal(controller1.signal);
    const p1 = source._read(0, 100);
    controller1.abort();
    await expect(p1).rejects.toThrow();

    // Second read: new signal, should succeed
    const controller2 = new AbortController();
    source.setCurrentSignal(controller2.signal);
    const result = await source._read(0, 50);
    expect(result.bytes.byteLength).toBe(50);
    expect(source.readCount).toBe(2);
  });

  it('clears signal with null', async () => {
    const source = new SlowSource(1000, 10);
    const controller = new AbortController();
    source.setCurrentSignal(controller.signal);
    source.setCurrentSignal(null);

    // Read without any signal — should succeed even if old controller aborts
    controller.abort();
    const result = await source._read(0, 100);
    expect(result.bytes.byteLength).toBe(100);
  });
});
