import Hls from 'hls.js';
import type {
  FragmentLoaderContext,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
  PlaylistLoaderContext,
} from 'hls.js';

const fileInput = document.getElementById('file-input') as HTMLInputElement;
const video = document.getElementById('video') as HTMLVideoElement;
const status = document.getElementById('status') as HTMLElement;

let worker: Worker | null = null;
let hls: Hls | null = null;

// Pending segment requests from hls.js custom loader
const pendingSegments = new Map<
  number,
  { resolve: (data: ArrayBuffer) => void; reject: (err: Error) => void }
>();

// Cached data from the worker
let playlist: string | null = null;
let initData: ArrayBuffer | null = null;
let pendingInit: { resolve: (data: ArrayBuffer) => void; reject: (err: Error) => void } | null =
  null;
let pendingPlaylist: {
  resolve: (data: string) => void;
  reject: (err: Error) => void;
} | null = null;

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  startProcessing(file);
});

function startProcessing(file: File) {
  // Clean up previous state
  if (hls) {
    hls.destroy();
    hls = null;
  }
  if (worker) {
    worker.terminate();
  }
  playlist = null;
  initData = null;
  pendingSegments.clear();
  video.style.display = 'none';
  status.textContent = `Opening ${file.name}...`;

  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = handleWorkerMessage;
  worker.onerror = (e) => {
    status.textContent = `Worker error: ${e.message}`;
  };
  worker.postMessage({ type: 'open', file });
}

function handleWorkerMessage(event: MessageEvent) {
  const msg = event.data;

  if (msg.type === 'ready') {
    playlist = msg.playlist;
    initData = msg.initData;
    status.textContent = `Ready — ${msg.totalSegments} segments, ${formatTime(msg.durationSec)}`;

    // Resolve any pending requests
    if (pendingPlaylist) {
      pendingPlaylist.resolve(playlist!);
      pendingPlaylist = null;
    }
    if (pendingInit && initData) {
      pendingInit.resolve(initData);
      pendingInit = null;
    }

    startHls();
  } else if (msg.type === 'segment') {
    const pending = pendingSegments.get(msg.index);
    if (pending) {
      pending.resolve(msg.data);
      pendingSegments.delete(msg.index);
    }
  } else if (msg.type === 'error') {
    status.textContent = `Error: ${msg.message}`;
    console.error('Worker error:', msg.message);

    // Reject all pending requests
    for (const [, p] of pendingSegments) {
      p.reject(new Error(msg.message));
    }
    pendingSegments.clear();
    if (pendingInit) {
      pendingInit.reject(new Error(msg.message));
      pendingInit = null;
    }
    if (pendingPlaylist) {
      pendingPlaylist.reject(new Error(msg.message));
      pendingPlaylist = null;
    }
  }
}

function requestSegment(index: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    pendingSegments.set(index, { resolve, reject });
    worker!.postMessage({ type: 'segment', index });
  });
}

function startHls() {
  if (!Hls.isSupported()) {
    status.textContent = 'hls.js not supported in this browser';
    return;
  }

  hls = new Hls({
    pLoader: PipelinePlaylistLoader as any,
    fLoader: PipelineFragmentLoader as any,
    enableWorker: false, // we have our own worker
  });

  hls.loadSource('/virtual/playlist.m3u8');
  hls.attachMedia(video);

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    video.style.display = 'block';
    video.play().catch(() => {});
  });

  hls.on(Hls.Events.ERROR, (_evt, data) => {
    if (data.fatal) {
      console.error('hls.js fatal error:', data);
      status.textContent = `Playback error: ${data.details}`;
    }
  });
}

function makeStats(): LoaderStats {
  const now = performance.now();
  return {
    aborted: false,
    loaded: 0,
    retry: 0,
    total: 0,
    chunkCount: 0,
    bwEstimate: 0,
    loading: { start: now, first: now, end: now },
    parsing: { start: now, end: now },
    buffering: { start: now, first: now, end: now },
  } as LoaderStats;
}

// Custom playlist loader — returns our in-memory playlist
class PipelinePlaylistLoader implements Loader<PlaylistLoaderContext> {
  context: PlaylistLoaderContext | null = null;
  stats: LoaderStats = makeStats();

  load(
    context: PlaylistLoaderContext,
    _config: LoaderConfiguration,
    callbacks: LoaderCallbacks<PlaylistLoaderContext>,
  ) {
    this.context = context;

    if (playlist) {
      this.stats.loaded = playlist.length;
      this.stats.loading.end = performance.now();
      callbacks.onSuccess(
        { url: context.url, data: playlist },
        this.stats,
        context,
        null,
      );
    } else {
      // Wait for worker to send playlist
      pendingPlaylist = {
        resolve: (data) => {
          this.stats.loaded = data.length;
          this.stats.loading.end = performance.now();
          callbacks.onSuccess(
            { url: context.url, data },
            this.stats,
            context,
            null,
          );
        },
        reject: (err) => {
          callbacks.onError({ code: 0, text: err.message }, context, null, this.stats);
        },
      };
    }
  }

  abort() {}
  destroy() {}
}

// Custom fragment loader — requests segments from worker on-demand
class PipelineFragmentLoader implements Loader<FragmentLoaderContext> {
  context: FragmentLoaderContext | null = null;
  stats: LoaderStats = makeStats();

  load(
    context: FragmentLoaderContext,
    _config: LoaderConfiguration,
    callbacks: LoaderCallbacks<FragmentLoaderContext>,
  ) {
    this.context = context;
    const url = context.url;

    if (url.includes('init.mp4')) {
      this.loadInit(context, callbacks);
    } else {
      const match = url.match(/seg-(\d+)\.m4s/);
      if (match) {
        this.loadSegment(parseInt(match[1], 10), context, callbacks);
      } else {
        callbacks.onError({ code: 404, text: 'Unknown URL' }, context, null, this.stats);
      }
    }
  }

  private loadInit(
    context: FragmentLoaderContext,
    callbacks: LoaderCallbacks<FragmentLoaderContext>,
  ) {
    if (initData) {
      this.stats.loaded = initData.byteLength;
      this.stats.loading.end = performance.now();
      callbacks.onSuccess(
        { url: context.url, data: initData },
        this.stats,
        context,
        null,
      );
    } else {
      pendingInit = {
        resolve: (data) => {
          this.stats.loaded = data.byteLength;
          this.stats.loading.end = performance.now();
          callbacks.onSuccess(
            { url: context.url, data },
            this.stats,
            context,
            null,
          );
        },
        reject: (err) => {
          callbacks.onError({ code: 0, text: err.message }, context, null, this.stats);
        },
      };
    }
  }

  private loadSegment(
    index: number,
    context: FragmentLoaderContext,
    callbacks: LoaderCallbacks<FragmentLoaderContext>,
  ) {
    requestSegment(index)
      .then((data) => {
        this.stats.loaded = data.byteLength;
        this.stats.loading.end = performance.now();
        callbacks.onSuccess(
          { url: context.url, data },
          this.stats,
          context,
          null,
        );
      })
      .catch((err) => {
        callbacks.onError(
          { code: 0, text: err.message },
          context,
          null,
          this.stats,
        );
      });
  }

  abort() {}
  destroy() {}
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
