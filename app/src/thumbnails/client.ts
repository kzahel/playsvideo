import type {
  GeneratedThumbnailResult,
  ThumbnailWorkerRequest,
  ThumbnailWorkerResponse,
} from './protocol.js';

interface PendingJob {
  resolve: (result: GeneratedThumbnailResult) => void;
  reject: (error: Error) => void;
}

export class ThumbnailWorkerClient {
  private readonly worker: Worker;
  private readonly pendingJobs = new Map<number, PendingJob>();
  private nextJobId = 0;
  private disposed = false;

  constructor() {
    this.worker = new Worker(new URL('../thumbnail-worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<ThumbnailWorkerResponse>) => {
      const response = event.data;
      const pending = this.pendingJobs.get(response.jobId);
      if (!pending) {
        return;
      }

      this.pendingJobs.delete(response.jobId);
      if (response.type === 'generated') {
        pending.resolve(response);
      } else {
        pending.reject(new Error(response.message));
      }
    };
    this.worker.onerror = (event) => {
      this.rejectPending(new Error(event.message || 'Thumbnail worker failed.'));
    };
  }

  generate(file: File): Promise<GeneratedThumbnailResult> {
    if (this.disposed) {
      return Promise.reject(new Error('Thumbnail worker has been disposed.'));
    }

    const jobId = ++this.nextJobId;
    const request: ThumbnailWorkerRequest = {
      type: 'generate',
      jobId,
      file,
    };

    return new Promise((resolve, reject) => {
      this.pendingJobs.set(jobId, { resolve, reject });
      this.worker.postMessage(request);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.worker.terminate();
    this.rejectPending(new DOMException('Thumbnail generation stopped.', 'AbortError'));
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingJobs.values()) {
      pending.reject(error);
    }
    this.pendingJobs.clear();
  }
}
