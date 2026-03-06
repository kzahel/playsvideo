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

export type EnginePhase = 'idle' | 'demuxing' | 'ready' | 'error';

export interface ReadyDetail {
  totalSegments: number;
  durationSec: number;
  subtitleTracks: SubtitleTrackInfo[];
}

export interface ErrorDetail {
  message: string;
}

export interface LoadingDetail {
  file: File;
}

interface EngineEventMap {
  ready: CustomEvent<ReadyDetail>;
  error: CustomEvent<ErrorDetail>;
  loading: CustomEvent<LoadingDetail>;
}

export class PlaysVideoEngine extends EventTarget {
  private video: HTMLVideoElement;
  private worker: Worker | null = null;
  private hls: Hls | null = null;

  // Pending segment requests from hls.js custom loader
  private pendingSegments = new Map<
    number,
    { resolve: (data: ArrayBuffer) => void; reject: (err: Error) => void }
  >();

  // Cached data from the worker
  private playlist: string | null = null;
  private initData: ArrayBuffer | null = null;
  private pendingInit: {
    resolve: (data: ArrayBuffer) => void;
    reject: (err: Error) => void;
  } | null = null;
  private pendingPlaylist: {
    resolve: (data: string) => void;
    reject: (err: Error) => void;
  } | null = null;

  // Race detection tracking
  private lastSegmentRequested = -1;
  private lastSegmentCompleted = -1;
  private segmentRequestTimes = new Map<number, number>();

  // Subtitle state
  private subtitleBlobUrls: string[] = [];
  private _subtitleTracks: SubtitleTrackInfo[] = [];

  // Public read-only state
  private _phase: EnginePhase = 'idle';
  private _totalSegments = 0;
  private _durationSec = 0;

  get phase(): EnginePhase {
    return this._phase;
  }
  get loading(): boolean {
    return this._phase === 'demuxing';
  }
  get totalSegments(): number {
    return this._totalSegments;
  }
  get durationSec(): number {
    return this._durationSec;
  }
  get subtitleTracks(): SubtitleTrackInfo[] {
    return this._subtitleTracks;
  }

  constructor(video: HTMLVideoElement) {
    super();
    this.video = video;
  }

  loadFile(file: File): void {
    // Clean up previous state
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.worker) {
      this.worker.terminate();
    }
    this.playlist = null;
    this.initData = null;
    this.pendingSegments.clear();
    this.lastSegmentRequested = -1;
    this.lastSegmentCompleted = -1;
    this.segmentRequestTimes.clear();
    for (const url of this.subtitleBlobUrls) URL.revokeObjectURL(url);
    this.subtitleBlobUrls = [];
    this.removeSubtitleTracks();

    this._phase = 'demuxing';
    this._totalSegments = 0;
    this._durationSec = 0;
    this._subtitleTracks = [];

    this.dispatchEvent(new CustomEvent('loading', { detail: { file } }));

    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.handleWorkerMessage(e);
    this.worker.onerror = (e) => {
      this._phase = 'error';
      this.dispatchEvent(new CustomEvent('error', { detail: { message: e.message } }));
    };
    this.worker.postMessage({ type: 'open', file });
    mlog(`open file=${file.name} size=${(file.size / 1024 / 1024).toFixed(1)}MB`);
  }

  destroy(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    for (const url of this.subtitleBlobUrls) URL.revokeObjectURL(url);
    this.subtitleBlobUrls = [];
    this.removeSubtitleTracks();
    this.pendingSegments.clear();
    this.segmentRequestTimes.clear();
    this._phase = 'idle';
  }

  // Typed addEventListener overloads
  addEventListener<K extends keyof EngineEventMap>(
    type: K,
    listener: (ev: EngineEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | ((ev: CustomEvent) => void),
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener as EventListenerOrEventListenerObject, options);
  }

  private handleWorkerMessage(event: MessageEvent): void {
    const msg = event.data;

    if (msg.type === 'ready') {
      this.playlist = msg.playlist;
      this.initData = msg.initData;
      this._totalSegments = msg.totalSegments;
      this._durationSec = msg.durationSec;
      this._subtitleTracks = msg.subtitleTracks ?? [];
      this._phase = 'ready';

      mlog(`ready segments=${msg.totalSegments} dur=${msg.durationSec.toFixed(1)}s`);

      // Resolve any pending requests
      if (this.pendingPlaylist) {
        this.pendingPlaylist.resolve(this.playlist!);
        this.pendingPlaylist = null;
      }
      if (this.pendingInit && this.initData) {
        this.pendingInit.resolve(this.initData);
        this.pendingInit = null;
      }

      // Request subtitle extraction for all embedded tracks
      for (const track of this._subtitleTracks) {
        mlog(
          `requesting subtitle track=${track.index} lang=${track.language} codec=${track.codec}`,
        );
        this.worker!.postMessage({ type: 'subtitle', trackIndex: track.index });
      }

      this.dispatchEvent(
        new CustomEvent('ready', {
          detail: {
            totalSegments: this._totalSegments,
            durationSec: this._durationSec,
            subtitleTracks: this._subtitleTracks,
          },
        }),
      );

      this.startHls();
    } else if (msg.type === 'subtitle') {
      mlog(`subtitle arrived track=${msg.trackIndex} codec=${msg.codec} len=${msg.webvtt?.length}`);
      this.addSubtitleTrack(msg.webvtt, msg.trackIndex);
    } else if (msg.type === 'segment') {
      const pending = this.pendingSegments.get(msg.index);
      const reqTime = this.segmentRequestTimes.get(msg.index);
      const latency = reqTime ? (performance.now() - reqTime).toFixed(1) : '?';
      const size = msg.data?.byteLength ?? 0;
      this.segmentRequestTimes.delete(msg.index);

      if (pending) {
        pending.resolve(msg.data);
        this.pendingSegments.delete(msg.index);
      }

      // Race detection: out-of-order completion
      if (msg.index < this.lastSegmentCompleted) {
        mlog(`WARN seg ${msg.index} completed out-of-order (last=${this.lastSegmentCompleted})`);
      }
      this.lastSegmentCompleted = Math.max(this.lastSegmentCompleted, msg.index);

      mlog(
        `seg ${msg.index} arrived latency=${latency}ms size=${size} pending=${this.pendingSegments.size}`,
      );
    } else if (msg.type === 'error') {
      mlog(`error: ${msg.message} pending=${this.pendingSegments.size}`);
      this._phase = 'error';
      this.dispatchEvent(new CustomEvent('error', { detail: { message: msg.message } }));

      // Reject all pending requests
      for (const [, p] of this.pendingSegments) {
        p.reject(new Error(msg.message));
      }
      this.pendingSegments.clear();
      if (this.pendingInit) {
        this.pendingInit.reject(new Error(msg.message));
        this.pendingInit = null;
      }
      if (this.pendingPlaylist) {
        this.pendingPlaylist.reject(new Error(msg.message));
        this.pendingPlaylist = null;
      }
    }
  }

  private requestSegment(index: number): Promise<ArrayBuffer> {
    // Race detection: duplicate request for same segment
    if (this.pendingSegments.has(index)) {
      mlog(`WARN duplicate request for seg ${index} (already pending)`);
    }
    // Race detection: out-of-order request
    if (index < this.lastSegmentRequested) {
      mlog(`WARN seg ${index} requested out-of-order (last=${this.lastSegmentRequested})`);
    }
    this.lastSegmentRequested = Math.max(this.lastSegmentRequested, index);

    const pendingCount = this.pendingSegments.size;
    if (pendingCount > 1) {
      mlog(`WARN ${pendingCount} segments already pending when requesting seg ${index}`);
    }

    mlog(`req seg ${index} pending=${pendingCount}`);
    this.segmentRequestTimes.set(index, performance.now());

    return new Promise((resolve, reject) => {
      this.pendingSegments.set(index, { resolve, reject });
      this.worker!.postMessage({ type: 'segment', index });
    });
  }

  private startHls(): void {
    if (!Hls.isSupported()) {
      this._phase = 'error';
      this.dispatchEvent(
        new CustomEvent('error', { detail: { message: 'hls.js not supported in this browser' } }),
      );
      return;
    }

    // Need to capture `this` for the loader classes
    const engine = this;

    class PipelinePlaylistLoader implements Loader<PlaylistLoaderContext> {
      context: PlaylistLoaderContext | null = null;
      stats: LoaderStats = makeStats();

      load(
        context: PlaylistLoaderContext,
        _config: LoaderConfiguration,
        callbacks: LoaderCallbacks<PlaylistLoaderContext>,
      ) {
        this.context = context;

        if (engine.playlist) {
          const data = engine.playlist;
          queueMicrotask(() => {
            this.stats.loaded = data.length;
            this.stats.loading.end = performance.now();
            callbacks.onSuccess({ url: context.url, data }, this.stats, context, null);
          });
        } else {
          engine.pendingPlaylist = {
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
        if (engine.initData) {
          const data = engine.initData;
          queueMicrotask(() => {
            this.stats.loaded = data.byteLength;
            this.stats.loading.end = performance.now();
            callbacks.onSuccess({ url: context.url, data }, this.stats, context, null);
          });
        } else {
          engine.pendingInit = {
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
        engine
          .requestSegment(index)
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

    this.hls = new Hls({
      pLoader: PipelinePlaylistLoader as any,
      fLoader: PipelineFragmentLoader as any,
      enableWorker: false,
    });

    this.hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
      mlog(`hls MANIFEST_PARSED levels=${data.levels.length}`);
      this.video.play().catch(() => {});
    });

    this.hls.on(Hls.Events.FRAG_LOADING, (_evt, data) => {
      mlog(`hls FRAG_LOADING sn=${data.frag.sn} url=${data.frag.relurl}`);
    });

    this.hls.on(Hls.Events.FRAG_LOADED, (_evt, data) => {
      mlog(`hls FRAG_LOADED sn=${data.frag.sn} size=${data.frag.stats.loaded}`);
    });

    this.hls.on(Hls.Events.FRAG_BUFFERED, (_evt, data) => {
      mlog(`hls FRAG_BUFFERED sn=${data.frag.sn}`);
    });

    this.hls.on(Hls.Events.BUFFER_APPENDING, (_evt, data) => {
      mlog(`hls BUFFER_APPENDING type=${data.type}`);
    });

    this.hls.on(Hls.Events.ERROR, (_evt, data) => {
      mlog(`hls ERROR fatal=${data.fatal} type=${data.type} details=${data.details}`);
      if (data.fatal) {
        console.error('hls.js fatal error:', data);
        this._phase = 'error';
        this.dispatchEvent(
          new CustomEvent('error', { detail: { message: `Playback error: ${data.details}` } }),
        );
      }
    });

    this.hls.loadSource('/virtual/playlist.m3u8');
    this.hls.attachMedia(this.video);
  }

  private addSubtitleTrack(webvtt: string, trackIndex: number): void {
    const blob = new Blob([webvtt], { type: 'text/vtt' });
    const url = URL.createObjectURL(blob);
    this.subtitleBlobUrls.push(url);

    const info = this._subtitleTracks.find((t) => t.index === trackIndex);
    const track = document.createElement('track');
    track.kind = info?.disposition.hearingImpaired ? 'captions' : 'subtitles';
    track.src = url;
    track.srclang = iso639_2to1(info?.language ?? 'und');
    track.label = info?.name ?? languageLabel(info?.language ?? 'und', trackIndex);
    if (trackIndex === 0) {
      track.default = true;
    }
    this.video.appendChild(track);
    mlog(
      `subtitle track ${trackIndex} attached as <track kind=${track.kind} lang=${track.srclang}>`,
    );
  }

  private removeSubtitleTracks(): void {
    for (const track of Array.from(this.video.querySelectorAll('track'))) {
      track.remove();
    }
  }
}

function mlog(msg: string): void {
  console.log(`[engine] ${msg}`);
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
