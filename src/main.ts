import type {
  FragmentLoaderContext,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderStats,
  PlaylistLoaderContext,
} from 'hls.js';
import Hls from 'hls.js';
import type { SubtitleTrackInfo } from './pipeline/types.js';

function mlog(msg: string) {
  console.log(`[main] ${msg}`);
}

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

// Race detection tracking
let lastSegmentRequested = -1;
let lastSegmentCompleted = -1;
const segmentRequestTimes = new Map<number, number>();

// Subtitle state
let subtitleBlobUrls: string[] = [];
let subtitleTrackInfos: SubtitleTrackInfo[] = [];

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
  lastSegmentRequested = -1;
  lastSegmentCompleted = -1;
  segmentRequestTimes.clear();
  for (const url of subtitleBlobUrls) URL.revokeObjectURL(url);
  subtitleBlobUrls = [];
  removeSubtitleTracks();
  video.style.display = 'none';
  status.textContent = `Opening ${file.name}...`;

  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = handleWorkerMessage;
  worker.onerror = (e) => {
    status.textContent = `Worker error: ${e.message}`;
  };
  worker.postMessage({ type: 'open', file });
  mlog(`open file=${file.name} size=${(file.size / 1024 / 1024).toFixed(1)}MB`);
}

function handleWorkerMessage(event: MessageEvent) {
  const msg = event.data;

  if (msg.type === 'ready') {
    playlist = msg.playlist;
    initData = msg.initData;
    status.textContent = `Ready — ${msg.totalSegments} segments, ${formatTime(msg.durationSec)}`;
    mlog(`ready segments=${msg.totalSegments} dur=${msg.durationSec.toFixed(1)}s`);

    // Resolve any pending requests
    if (pendingPlaylist) {
      pendingPlaylist.resolve(playlist!);
      pendingPlaylist = null;
    }
    if (pendingInit && initData) {
      pendingInit.resolve(initData);
      pendingInit = null;
    }

    // Request subtitle extraction for all embedded tracks
    subtitleTrackInfos = msg.subtitleTracks ?? [];
    for (const track of subtitleTrackInfos) {
      mlog(`requesting subtitle track=${track.index} lang=${track.language} codec=${track.codec}`);
      worker!.postMessage({ type: 'subtitle', trackIndex: track.index });
    }

    startHls();
  } else if (msg.type === 'subtitle') {
    mlog(`subtitle arrived track=${msg.trackIndex} codec=${msg.codec} len=${msg.webvtt?.length}`);
    addSubtitleTrack(msg.webvtt, msg.trackIndex);
  } else if (msg.type === 'segment') {
    const pending = pendingSegments.get(msg.index);
    const reqTime = segmentRequestTimes.get(msg.index);
    const latency = reqTime ? (performance.now() - reqTime).toFixed(1) : '?';
    const size = msg.data?.byteLength ?? 0;
    segmentRequestTimes.delete(msg.index);

    if (pending) {
      pending.resolve(msg.data);
      pendingSegments.delete(msg.index);
    }

    // Race detection: out-of-order completion
    if (msg.index < lastSegmentCompleted) {
      mlog(`WARN seg ${msg.index} completed out-of-order (last=${lastSegmentCompleted})`);
    }
    lastSegmentCompleted = Math.max(lastSegmentCompleted, msg.index);

    mlog(
      `seg ${msg.index} arrived latency=${latency}ms size=${size} pending=${pendingSegments.size}`,
    );
  } else if (msg.type === 'error') {
    mlog(`error: ${msg.message} pending=${pendingSegments.size}`);
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
  // Race detection: duplicate request for same segment
  if (pendingSegments.has(index)) {
    mlog(`WARN duplicate request for seg ${index} (already pending)`);
  }
  // Race detection: out-of-order request
  if (index < lastSegmentRequested) {
    mlog(`WARN seg ${index} requested out-of-order (last=${lastSegmentRequested})`);
  }
  lastSegmentRequested = Math.max(lastSegmentRequested, index);

  const pendingCount = pendingSegments.size;
  if (pendingCount > 1) {
    mlog(`WARN ${pendingCount} segments already pending when requesting seg ${index}`);
  }

  mlog(`req seg ${index} pending=${pendingCount}`);
  segmentRequestTimes.set(index, performance.now());

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

  // Register event listeners BEFORE loadSource/attachMedia to avoid race
  // with synchronous custom loaders that may trigger MANIFEST_PARSED immediately.
  hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
    mlog(`hls MANIFEST_PARSED levels=${data.levels.length}`);
    video.style.display = 'block';
    video.play().catch(() => {});
  });

  hls.on(Hls.Events.FRAG_LOADING, (_evt, data) => {
    mlog(`hls FRAG_LOADING sn=${data.frag.sn} url=${data.frag.relurl}`);
  });

  hls.on(Hls.Events.FRAG_LOADED, (_evt, data) => {
    mlog(`hls FRAG_LOADED sn=${data.frag.sn} size=${data.frag.stats.loaded}`);
  });

  hls.on(Hls.Events.FRAG_BUFFERED, (_evt, data) => {
    mlog(`hls FRAG_BUFFERED sn=${data.frag.sn}`);
  });

  hls.on(Hls.Events.BUFFER_APPENDING, (_evt, data) => {
    mlog(`hls BUFFER_APPENDING type=${data.type}`);
  });

  hls.on(Hls.Events.ERROR, (_evt, data) => {
    mlog(`hls ERROR fatal=${data.fatal} type=${data.type} details=${data.details}`);
    if (data.fatal) {
      console.error('hls.js fatal error:', data);
      status.textContent = `Playback error: ${data.details}`;
    }
  });

  hls.loadSource('/virtual/playlist.m3u8');
  hls.attachMedia(video);
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
      // Defer to let hls.js's state machine settle between ticks
      const data = playlist;
      queueMicrotask(() => {
        this.stats.loaded = data.length;
        this.stats.loading.end = performance.now();
        callbacks.onSuccess({ url: context.url, data }, this.stats, context, null);
      });
    } else {
      // Wait for worker to send playlist
      pendingPlaylist = {
        resolve: (data) => {
          this.stats.loaded = data.length;
          this.stats.loading.end = performance.now();
          callbacks.onSuccess({ url: context.url, data }, this.stats, context, null);
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
      // Defer to let hls.js's state machine settle between ticks
      const data = initData;
      queueMicrotask(() => {
        this.stats.loaded = data.byteLength;
        this.stats.loading.end = performance.now();
        callbacks.onSuccess({ url: context.url, data }, this.stats, context, null);
      });
    } else {
      pendingInit = {
        resolve: (data) => {
          this.stats.loaded = data.byteLength;
          this.stats.loading.end = performance.now();
          callbacks.onSuccess({ url: context.url, data }, this.stats, context, null);
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
        callbacks.onSuccess({ url: context.url, data }, this.stats, context, null);
      })
      .catch((err) => {
        callbacks.onError({ code: 0, text: err.message }, context, null, this.stats);
      });
  }

  abort() {}
  destroy() {}
}

function addSubtitleTrack(webvtt: string, trackIndex: number) {
  const blob = new Blob([webvtt], { type: 'text/vtt' });
  const url = URL.createObjectURL(blob);
  subtitleBlobUrls.push(url);

  const info = subtitleTrackInfos[trackIndex];
  const track = document.createElement('track');
  track.kind = info?.disposition.hearingImpaired ? 'captions' : 'subtitles';
  track.src = url;
  track.srclang = iso639_2to1(info?.language ?? 'und');
  track.label = info?.name ?? languageLabel(info?.language ?? 'und', trackIndex);
  // Show first track by default
  if (trackIndex === 0) {
    track.default = true;
  }
  video.appendChild(track);
  mlog(`subtitle track ${trackIndex} attached as <track kind=${track.kind} lang=${track.srclang}>`);
}

/** Map common ISO 639-2/T (3-letter) codes to ISO 639-1 (2-letter) for <track srclang>. */
function iso639_2to1(code: string): string {
  const map: Record<string, string> = {
    eng: 'en',
    spa: 'es',
    fra: 'fr',
    deu: 'de',
    ita: 'it',
    por: 'pt',
    rus: 'ru',
    jpn: 'ja',
    kor: 'ko',
    zho: 'zh',
    ara: 'ar',
    hin: 'hi',
    nld: 'nl',
    swe: 'sv',
    pol: 'pl',
    tur: 'tr',
    vie: 'vi',
    tha: 'th',
    und: '',
  };
  return map[code] ?? code;
}

function languageLabel(langCode: string, trackIndex: number): string {
  const names: Record<string, string> = {
    eng: 'English',
    spa: 'Spanish',
    fra: 'French',
    deu: 'German',
    ita: 'Italian',
    por: 'Portuguese',
    rus: 'Russian',
    jpn: 'Japanese',
    kor: 'Korean',
    zho: 'Chinese',
    ara: 'Arabic',
    hin: 'Hindi',
    nld: 'Dutch',
    swe: 'Swedish',
    pol: 'Polish',
    tur: 'Turkish',
    vie: 'Vietnamese',
    tha: 'Thai',
  };
  return names[langCode] ?? `Track ${trackIndex + 1}`;
}

function removeSubtitleTracks() {
  for (const track of Array.from(video.querySelectorAll('track'))) {
    track.remove();
  }
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
