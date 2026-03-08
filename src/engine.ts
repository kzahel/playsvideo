import type {
  FragmentLoaderContext,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderStats,
  PlaylistLoaderContext,
} from 'hls.js';
import Hls from 'hls.js';
import type { Source } from 'mediabunny';
import { WasmFfmpegRunner } from './adapters/wasm-ffmpeg.js';
import { createLocalAudioTranscoder, makeAacDecoderConfig } from './pipeline/audio-transcode.js';
import { audioNeedsTranscode, createBrowserProber } from './pipeline/codec-probe.js';
import type { DemuxResult } from './pipeline/demux.js';
import { demuxSource, getKeyframeIndex } from './pipeline/demux.js';
import { generateVodPlaylist } from './pipeline/playlist.js';
import { buildSegmentPlan } from './pipeline/segment-plan.js';
import { processSegmentWithAbort } from './pipeline/segment-processor.js';
import { isAbortableSource } from './pipeline/source-signal.js';
import type {
  FfmpegRunner,
  KeyframeIndex,
  PlannedSegment,
  SubtitleTrackInfo,
} from './pipeline/types.js';
import type { TranscodeWorkerSnapshot, TranscodeWorkerStateMessage } from './transcode-protocol.js';
import type { WorkerSegmentStateMessage } from './worker-protocol.js';

export type EnginePhase = 'idle' | 'demuxing' | 'ready' | 'error';

export interface ReadyDetail {
  totalSegments: number;
  durationSec: number;
  subtitleTracks: SubtitleTrackInfo[];
  passthrough?: boolean;
}

export interface ErrorDetail {
  message: string;
}

export interface LoadingDetail {
  file?: File;
  url?: string;
}

export interface WasmWorkerState extends TranscodeWorkerSnapshot {
  id: number;
}

export interface WorkerStateDetail {
  workers: WasmWorkerState[];
}

export type SegmentPhase =
  | 'requested'
  | 'queued'
  | 'prefetching'
  | 'processing'
  | 'ready'
  | 'cache-hit'
  | 'delivered'
  | 'canceled'
  | 'aborted'
  | 'error';

export interface SegmentTimelineEvent {
  phase: SegmentPhase;
  atMs: number;
  sizeBytes: number | null;
  message: string | null;
}

export interface SegmentState {
  index: number;
  phase: SegmentPhase;
  requestCount: number;
  sizeBytes: number | null;
  latencyMs: number | null;
  error: string | null;
  prefetched: boolean;
  events: SegmentTimelineEvent[];
}

export interface SegmentStateDetail {
  segments: SegmentState[];
}

export interface EngineOptions {
  /**
   * Number of internal audio transcode workers to create for worker-mode playback.
   * Use 0 to disable the pool and keep all transcode work inside the coordinator worker.
   */
  transcodeWorkers?: number;
}

interface EngineEventMap {
  ready: CustomEvent<ReadyDetail>;
  error: CustomEvent<ErrorDetail>;
  loading: CustomEvent<LoadingDetail>;
  workerstatechange: CustomEvent<WorkerStateDetail>;
  segmentstatechange: CustomEvent<SegmentStateDetail>;
}

interface TranscodeWorkerHandle {
  worker: Worker;
}

function defaultTranscodeWorkerCount(): number {
  const concurrency =
    typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
      ? navigator.hardwareConcurrency
      : 2;
  return Math.max(1, Math.min(2, concurrency - 1));
}

export class PlaysVideoEngine extends EventTarget {
  readonly video: HTMLVideoElement;
  readonly options: Required<EngineOptions>;
  private worker: Worker | null = null;
  private transcodeWorkers: TranscodeWorkerHandle[] = [];
  private _transcodeWorkerStates: WasmWorkerState[] = [];
  private _segmentStates = new Map<number, SegmentState>();
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

  private segmentRequestTimes = new Map<number, number>();

  // Subtitle state
  private subtitleBlobUrls: string[] = [];
  private _subtitleTracks: SubtitleTrackInfo[] = [];

  // Public read-only state
  private _phase: EnginePhase = 'idle';
  private _totalSegments = 0;
  private _durationSec = 0;

  // Passthrough state
  private _passthrough = false;
  private _blobUrl: string | null = null;
  private _pendingFileType: string | null = null;

  // Pre-built keyframe index (e.g. from MKV cues) to skip mediabunny scan
  private _keyframeIndex: KeyframeIndex | null = null;

  // Main-thread pipeline state (used by loadSource)
  private _source: Source | null = null;
  private _sourceDemux: DemuxResult | null = null;
  private _sourcePlan: PlannedSegment[] = [];
  private _sourceDoTranscode = false;
  private _sourceAudioDecoderConfig: AudioDecoderConfig | null = null;
  private _sourceInitSegment: Uint8Array | null = null;
  private _sourceFfmpeg: FfmpegRunner | null = null;
  private _sourceTargetSegDuration = 4;
  private _sourceSegmentAbort: AbortController | null = null;

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
  get passthrough(): boolean {
    return this._passthrough;
  }
  get transcodeWorkerStates(): WasmWorkerState[] {
    return this._transcodeWorkerStates.map((worker) => ({ ...worker }));
  }
  get segmentStates(): SegmentState[] {
    return Array.from(this._segmentStates.values())
      .sort((a, b) => a.index - b.index)
      .map((segment) => ({
        ...segment,
        events: segment.events.map((event) => ({ ...event })),
      }));
  }

  constructor(video: HTMLVideoElement, options: EngineOptions = {}) {
    super();
    this.video = video;
    this.options = {
      transcodeWorkers: options.transcodeWorkers ?? defaultTranscodeWorkerCount(),
    };
  }

  loadFile(file: File, opts?: { keyframeIndex?: KeyframeIndex }): void {
    this.reset({ file });
    this._pendingFileType = file.type || null;
    this._blobUrl = URL.createObjectURL(file);
    this._keyframeIndex = opts?.keyframeIndex ?? null;
    this.createWorker();
    this.worker!.postMessage({ type: 'open', file });
    mlog(`open file=${file.name} size=${(file.size / 1024 / 1024).toFixed(1)}MB type=${file.type}`);
  }

  loadUrl(url: string, opts?: { keyframeIndex?: KeyframeIndex }): void {
    this.reset({ url });
    this._keyframeIndex = opts?.keyframeIndex ?? null;
    this.createWorker();
    this.worker!.postMessage({ type: 'open-url', url });
    mlog(`open url=${url}`);
  }

  /**
   * Load from an external Source (e.g. TorrentSource).
   *
   * Runs the pipeline on the main thread (no worker) because external Sources
   * typically need access to objects on the main thread.
   *
   * If the Source implements AbortableSource, the pipeline will call
   * setCurrentSignal() before each segment so the Source can abort in-flight
   * reads on seek.
   */
  loadSource(
    source: Source,
    opts?: {
      keyframeIndex?: KeyframeIndex;
      ffmpeg?: FfmpegRunner;
      targetSegmentDuration?: number;
    },
  ): void {
    this.reset({});
    this._keyframeIndex = opts?.keyframeIndex ?? null;
    this._source = source;
    this._sourcePlan = [];
    this._sourceDoTranscode = false;
    this._sourceAudioDecoderConfig = null;
    this._sourceInitSegment = null;
    this._sourceFfmpeg = opts?.ffmpeg ?? null;
    this._sourceTargetSegDuration = opts?.targetSegmentDuration ?? 4;
    this.startSourcePipeline(source);
  }

  private reset(detail: LoadingDetail): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.destroyTranscodeWorkers();
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
    if (this._passthrough) {
      this.video.removeAttribute('src');
      this.video.load();
    }

    this.playlist = null;
    this.initData = null;
    this.pendingSegments.clear();
    this.segmentRequestTimes.clear();
    for (const url of this.subtitleBlobUrls) URL.revokeObjectURL(url);
    this.subtitleBlobUrls = [];
    this.removeSubtitleTracks();

    this._phase = 'demuxing';
    this._totalSegments = 0;
    this._durationSec = 0;
    this._subtitleTracks = [];
    this._passthrough = false;
    this._pendingFileType = null;
    this._keyframeIndex = null;

    // Source pipeline cleanup
    if (this._sourceSegmentAbort) {
      this._sourceSegmentAbort.abort();
      this._sourceSegmentAbort = null;
    }
    if (this._source && isAbortableSource(this._source)) {
      this._source.setCurrentSignal(null);
    }
    this._source = null;
    this._sourceDemux?.dispose();
    this._sourceDemux = null;
    this._sourcePlan = [];
    this._sourceDoTranscode = false;
    this._sourceAudioDecoderConfig = null;
    this._sourceInitSegment = null;
    this._sourceFfmpeg = null;
    this._segmentStates.clear();

    this.dispatchEvent(new CustomEvent('loading', { detail }));
    this.dispatchSegmentStateChange();
  }

  private createWorker(): void {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.handleWorkerMessage(e);
    this.worker.onerror = (e) => {
      this._phase = 'error';
      this.dispatchEvent(new CustomEvent('error', { detail: { message: e.message } }));
    };
  }

  private ensureTranscodeWorkers(): void {
    if (!this.worker || this.transcodeWorkers.length > 0 || this.options.transcodeWorkers <= 0) {
      return;
    }

    for (let i = 0; i < this.options.transcodeWorkers; i++) {
      const worker = new Worker(new URL('./transcode-worker.js', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event) => this.handleTranscodeWorkerMessage(i, event);
      worker.onerror = (event) => {
        this.updateTranscodeWorkerState(i, {
          phase: 'error',
          jobId: null,
          lastError: event.message || 'Transcode worker crashed',
        });
      };
      const channel = new MessageChannel();
      worker.postMessage({ type: 'connect' }, [channel.port2]);
      this.worker.postMessage({ type: 'transcode-port', id: i }, [channel.port1]);
      this.transcodeWorkers.push({ worker });
      this._transcodeWorkerStates.push({
        id: i,
        phase: 'starting',
        sourceCodec: null,
        jobId: null,
        inputBytes: null,
        outputBytes: null,
        totalMs: null,
        ffmpegMs: null,
        jobsCompleted: 0,
        lastError: null,
      });
    }
    this.dispatchWorkerStateChange();
  }

  private destroyTranscodeWorkers(): void {
    for (const handle of this.transcodeWorkers) {
      handle.worker.terminate();
    }
    this.transcodeWorkers = [];
    this._transcodeWorkerStates = [];
    this.dispatchWorkerStateChange();
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
    this.destroyTranscodeWorkers();
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
    if (this._passthrough) {
      this.video.removeAttribute('src');
      this.video.load();
    }
    for (const url of this.subtitleBlobUrls) URL.revokeObjectURL(url);
    this.subtitleBlobUrls = [];
    this.removeSubtitleTracks();
    this.pendingSegments.clear();
    this.segmentRequestTimes.clear();
    this._phase = 'idle';
    this._passthrough = false;
    this._segmentStates.clear();
    this.dispatchSegmentStateChange();
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

  private dispatchWorkerStateChange(): void {
    this.dispatchEvent(
      new CustomEvent('workerstatechange', {
        detail: {
          workers: this.transcodeWorkerStates,
        },
      }),
    );
  }

  private dispatchSegmentStateChange(): void {
    this.dispatchEvent(
      new CustomEvent('segmentstatechange', {
        detail: {
          segments: this.segmentStates,
        },
      }),
    );
  }

  private handleTranscodeWorkerMessage(
    id: number,
    event: MessageEvent<TranscodeWorkerStateMessage>,
  ) {
    const msg = event.data;
    if (!msg || msg.type !== 'worker-state') {
      return;
    }
    this.updateTranscodeWorkerState(id, msg.state);
  }

  private updateTranscodeWorkerState(id: number, patch: Partial<TranscodeWorkerSnapshot>): void {
    const index = this._transcodeWorkerStates.findIndex((worker) => worker.id === id);
    if (index === -1) {
      return;
    }
    this._transcodeWorkerStates[index] = {
      ...this._transcodeWorkerStates[index],
      ...patch,
      id,
    };
    this.dispatchWorkerStateChange();
  }

  private noteSegmentState(
    index: number,
    phase: SegmentPhase,
    opts: {
      sizeBytes?: number;
      message?: string;
      latencyMs?: number;
      incrementRequestCount?: boolean;
      prefetched?: boolean;
    } = {},
  ): void {
    const existing = this._segmentStates.get(index);
    const next: SegmentState = existing
      ? {
          ...existing,
          events: [...existing.events],
        }
      : {
          index,
          phase,
          requestCount: 0,
          sizeBytes: null,
          latencyMs: null,
          error: null,
          prefetched: false,
          events: [],
        };

    next.phase = phase;
    if (opts.incrementRequestCount) {
      next.requestCount += 1;
    }
    if (opts.prefetched !== undefined) {
      next.prefetched = opts.prefetched;
    } else if (phase === 'prefetching') {
      next.prefetched = true;
    }
    if (opts.sizeBytes !== undefined) {
      next.sizeBytes = opts.sizeBytes;
    }
    if (opts.latencyMs !== undefined) {
      next.latencyMs = opts.latencyMs;
    }
    next.error = phase === 'error' ? (opts.message ?? next.error) : null;
    next.events.push({
      phase,
      atMs: performance.now(),
      sizeBytes: opts.sizeBytes ?? null,
      message: opts.message ?? null,
    });

    this._segmentStates.set(index, next);
    this.dispatchSegmentStateChange();
  }

  private handleWorkerSegmentState(msg: WorkerSegmentStateMessage): void {
    this.noteSegmentState(msg.index, msg.phase, {
      sizeBytes: msg.sizeBytes,
      message: msg.message,
    });
  }

  private checkNativePlayback(videoCodec: string, audioCodec: string | null): boolean {
    const mime = this._pendingFileType;
    if (!mime) return false;

    const codecs = audioCodec ? `${videoCodec}, ${audioCodec}` : videoCodec;
    const fullMime = `${mime}; codecs="${codecs}"`;
    const result = this.video.canPlayType(fullMime);
    mlog(`canPlayType("${fullMime}") = "${result}"`);
    if (FORCE_REMUX) return false;
    return result === 'probably' || result === 'maybe';
  }

  private startPassthrough(src: string): void {
    this._passthrough = true;
    this._totalSegments = 0;
    if (src.startsWith('blob:')) {
      this._blobUrl = src;
    }

    this.video.src = src;

    const fireReady = () => {
      this._durationSec = this.video.duration;
      this._phase = 'ready';
      mlog(`passthrough ready dur=${this._durationSec.toFixed(1)}s`);
      this.dispatchEvent(
        new CustomEvent('ready', {
          detail: {
            totalSegments: 0,
            durationSec: this._durationSec,
            subtitleTracks: [],
            passthrough: true,
          },
        }),
      );
    };

    if (this.video.readyState >= 1) {
      fireReady();
    } else {
      this.video.addEventListener('loadedmetadata', fireReady, { once: true });
    }
  }

  private handleWorkerMessage(event: MessageEvent): void {
    const msg = event.data;

    if (msg.type === 'probed') {
      // Worker finished demux — decide passthrough vs pipeline
      const canPlay = this.checkNativePlayback(msg.videoCodec, msg.audioCodec);
      this._subtitleTracks = msg.subtitleTracks ?? [];

      if (canPlay && this._blobUrl) {
        mlog(`passthrough: canPlayType accepted codecs=${msg.videoCodec}/${msg.audioCodec}`);
        this.startPassthrough(this._blobUrl);
        this.worker!.postMessage({ type: 'passthrough-pipeline' });

        for (const track of this._subtitleTracks) {
          mlog(
            `requesting subtitle track=${track.index} lang=${track.language} codec=${track.codec}`,
          );
          this.worker!.postMessage({ type: 'subtitle', trackIndex: track.index });
        }
      } else {
        if (this._blobUrl) {
          URL.revokeObjectURL(this._blobUrl);
          this._blobUrl = null;
        }
        mlog(`pipeline: canPlayType rejected, proceeding with remux pipeline`);
        this.ensureTranscodeWorkers();
        const remuxMsg: Record<string, unknown> = { type: 'remux-pipeline' };
        if (this._keyframeIndex) remuxMsg.keyframeIndex = this._keyframeIndex;
        this.worker!.postMessage(remuxMsg);
      }
    } else if (msg.type === 'ready') {
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
    } else if (msg.type === 'segment-state') {
      this.handleWorkerSegmentState(msg);
    } else if (msg.type === 'segment') {
      const pending = this.pendingSegments.get(msg.index);
      const reqTime = this.segmentRequestTimes.get(msg.index);
      const latencyMs = reqTime ? performance.now() - reqTime : null;
      const latency = latencyMs !== null ? latencyMs.toFixed(1) : '?';
      const size = msg.data?.byteLength ?? 0;
      this.segmentRequestTimes.delete(msg.index);

      if (pending) {
        pending.resolve(msg.data);
        this.pendingSegments.delete(msg.index);
      }

      this.noteSegmentState(msg.index, 'delivered', {
        sizeBytes: size,
        latencyMs: latencyMs ?? undefined,
      });

      mlog(
        `seg ${msg.index} arrived latency=${latency}ms size=${size} pending=${this.pendingSegments.size}`,
      );
    } else if (msg.type === 'error') {
      mlog(`error: ${msg.message} pending=${this.pendingSegments.size}`);
      this._phase = 'error';
      this.dispatchEvent(new CustomEvent('error', { detail: { message: msg.message } }));

      // Reject all pending requests
      for (const [index, p] of this.pendingSegments) {
        this.noteSegmentState(index, 'error', { message: msg.message });
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

    const pendingCount = this.pendingSegments.size;
    if (pendingCount > 1) {
      mlog(`WARN ${pendingCount} segments already pending when requesting seg ${index}`);
    }

    mlog(`req seg ${index} pending=${pendingCount}`);
    this.segmentRequestTimes.set(index, performance.now());
    this.noteSegmentState(index, 'requested', { incrementRequestCount: true });

    return new Promise((resolve, reject) => {
      this.pendingSegments.set(index, { resolve, reject });
      this.worker!.postMessage({ type: 'segment', index });
    });
  }

  private cancelSegment(index: number): void {
    const pending = this.pendingSegments.get(index);
    if (pending) {
      mlog(`cancel seg ${index}`);
      this.noteSegmentState(index, 'canceled');
      pending.reject(new DOMException('Segment aborted', 'AbortError'));
      this.pendingSegments.delete(index);
      this.segmentRequestTimes.delete(index);
      this.worker?.postMessage({ type: 'cancel', index });
    }
  }

  private async startSourcePipeline(source: Source): Promise<void> {
    try {
      mlog('source pipeline: demuxing');
      this._sourceDemux = await demuxSource(source);
      const demux = this._sourceDemux;

      // Build keyframe index
      let index: KeyframeIndex;
      if (this._keyframeIndex) {
        index = this._keyframeIndex;
        mlog(`source pipeline: pre-built keyframes=${index.keyframes.length}`);
      } else {
        index = await getKeyframeIndex(demux.videoSink, demux.duration);
        mlog(`source pipeline: keyframe-index keyframes=${index.keyframes.length}`);
      }

      // Build segment plan
      this._sourcePlan = buildSegmentPlan({
        keyframeTimestampsSec: index.keyframes.map((k) => k.timestamp),
        durationSec: index.duration,
        targetSegmentDurationSec: this._sourceTargetSegDuration,
      });

      // Check transcode
      const codecProber = createBrowserProber();
      this._sourceDoTranscode =
        demux.audioCodec !== null &&
        audioNeedsTranscode(codecProber, demux.audioCodec, demux.audioDecoderConfig?.codec);
      this._sourceAudioDecoderConfig = this._sourceDoTranscode
        ? makeAacDecoderConfig(demux.audioDecoderConfig)
        : demux.audioDecoderConfig;

      // Pre-process segment 0
      const seg0Result = await processSegmentWithAbort(this.makeSourceProcessorConfig(), 0);
      if (seg0Result.initSegment) {
        this._sourceInitSegment = seg0Result.initSegment;
      }

      // Build playlist
      const playlist = generateVodPlaylist({
        targetDuration: Math.ceil(Math.max(...this._sourcePlan.map((s) => s.durationSec))),
        mediaSequence: 0,
        mapUri: 'init.mp4',
        entries: this._sourcePlan.map((s) => ({
          uri: `seg-${s.sequence}.m4s`,
          durationSec: s.durationSec,
        })),
        endList: true,
      });

      this.playlist = playlist;
      this.initData = (this._sourceInitSegment!.buffer as ArrayBuffer).slice(
        this._sourceInitSegment!.byteOffset,
        this._sourceInitSegment!.byteOffset + this._sourceInitSegment!.byteLength,
      );
      this._totalSegments = this._sourcePlan.length;
      this._durationSec = demux.duration;
      this._subtitleTracks = demux.subtitleTracks;
      this._phase = 'ready';

      mlog(
        `source pipeline: ready segments=${this._totalSegments} dur=${this._durationSec.toFixed(1)}s`,
      );

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
    } catch (err) {
      this._phase = 'error';
      this.dispatchEvent(new CustomEvent('error', { detail: { message: String(err) } }));
    }
  }

  private makeSourceProcessorConfig() {
    if (!this._sourceFfmpeg) {
      this._sourceFfmpeg = new WasmFfmpegRunner();
    }
    const demux = this._sourceDemux!;
    return {
      videoSink: demux.videoSink,
      audioSink: demux.audioSink,
      videoCodec: demux.videoCodec,
      audioCodec: demux.audioCodec,
      videoDecoderConfig: demux.videoDecoderConfig,
      audioDecoderConfig: this._sourceAudioDecoderConfig,
      plan: this._sourcePlan,
      doTranscode: this._sourceDoTranscode,
      transcodeAudio: createLocalAudioTranscoder(this._sourceFfmpeg),
      sourceCodec: demux.audioCodec ?? undefined,
      log: mlog,
    };
  }

  private async requestSourceSegment(index: number): Promise<ArrayBuffer> {
    // Cancel previous in-flight segment if any
    if (this._sourceSegmentAbort) {
      this._sourceSegmentAbort.abort();
    }

    const controller = new AbortController();
    this._sourceSegmentAbort = controller;

    // Set signal on source for abort-aware Sources (e.g. TorrentSource)
    if (this._source && isAbortableSource(this._source)) {
      this._source.setCurrentSignal(controller.signal);
    }

    const result = await processSegmentWithAbort(
      this.makeSourceProcessorConfig(),
      index,
      controller.signal,
    );

    this._sourceSegmentAbort = null;

    // Update mutable state
    if (!this._sourceInitSegment && result.initSegment) {
      this._sourceInitSegment = result.initSegment;
    }

    return (result.mediaData.buffer as ArrayBuffer).slice(
      result.mediaData.byteOffset,
      result.mediaData.byteOffset + result.mediaData.byteLength,
    );
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
      private currentSegmentIndex: number | null = null;

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
        this.currentSegmentIndex = index;
        const segmentPromise = engine._source
          ? engine.requestSourceSegment(index)
          : engine.requestSegment(index);
        segmentPromise
          .then((data) => {
            this.currentSegmentIndex = null;
            this.stats.loaded = data.byteLength;
            this.stats.loading.end = performance.now();
            callbacks.onSuccess({ url: context.url, data }, this.stats, context, null);
          })
          .catch((err) => {
            this.currentSegmentIndex = null;
            if (err instanceof DOMException && err.name === 'AbortError') {
              this.stats.aborted = true;
              return;
            }
            callbacks.onError({ code: 0, text: err.message }, context, null, this.stats);
          });
      }

      abort() {
        if (this.currentSegmentIndex !== null) {
          if (engine._source) {
            // Source mode: abort the in-flight main-thread processing
            engine._sourceSegmentAbort?.abort();
          } else {
            // Worker mode: cancel via worker message
            engine.cancelSegment(this.currentSegmentIndex);
          }
          this.currentSegmentIndex = null;
        }
      }

      destroy() {
        this.abort();
      }
    }

    this.hls = new Hls({
      pLoader: PipelinePlaylistLoader as any,
      fLoader: PipelineFragmentLoader as any,
      enableWorker: false,
    });

    this.hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
      mlog(`hls MANIFEST_PARSED levels=${data.levels.length}`);
      if (this.video.autoplay) {
        this.video.play().catch(() => {});
      }
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

/** Set to true to bypass native playback and force the remux pipeline (for testing). */
const FORCE_REMUX = false;

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
