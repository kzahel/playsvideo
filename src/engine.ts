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
import {
  createBrowserPlaybackCapabilities,
  evaluatePlaybackOptions,
  type PlaybackDiagnostic,
  type PlaybackEvaluationResult,
  type PlaybackMediaMetadata,
  type PlaybackMode,
  type PlaybackOption,
  type PlaybackOptionEvaluation,
} from './playback-selection.js';
import { createLocalAudioTranscoder, makeAacDecoderConfig } from './pipeline/audio-transcode.js';
import type { DemuxResult } from './pipeline/demux.js';
import { demuxSource, getKeyframeIndex } from './pipeline/demux.js';
import { buildMkvKeyframeIndexFromSource } from './pipeline/mkv-keyframe-index.js';
import { generateVodPlaylist } from './pipeline/playlist.js';
import { buildSegmentPlan } from './pipeline/segment-plan.js';
import {
  extractSubtitleData,
  parseSubtitleFile,
  subtitleDataToWebVTT,
} from './pipeline/subtitle.js';
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
  codecPath: CodecPath;
}

export interface ErrorDetail {
  message: string;
}

export interface LoadingDetail {
  file?: File;
  url?: string;
}

export interface SubtitleStatusDetail {
  message: string;
}

export interface WasmWorkerState extends TranscodeWorkerSnapshot {
  id: number;
}

export interface WorkerStateDetail {
  workers: WasmWorkerState[];
}

export interface PlaybackDecisionDetail {
  media: PlaybackMediaMetadata;
  evaluation: PlaybackEvaluationResult;
  playbackPolicy: PlaybackPolicy;
}

export type PlaybackPolicy = 'auto' | 'force-hls';

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

export interface LoadWithOptionsInput {
  source: Source;
  options: PlaybackOption[];
  ffmpeg?: FfmpegRunner;
  targetSegmentDuration?: number;
  preferenceOrder?: PlaybackMode[];
  playbackPolicy?: PlaybackPolicy;
}

export interface ExternalSubtitleOptions {
  label?: string;
  language?: string;
  kind?: 'subtitles' | 'captions';
}

export interface CodecDescriptor {
  short: string | null;
  full: string | null;
}

export interface CodecPath {
  mode: 'passthrough' | 'pipeline';
  sourceVideo: CodecDescriptor;
  sourceAudio: CodecDescriptor;
  outputVideo: CodecDescriptor;
  outputAudio: CodecDescriptor;
}

interface EngineEventMap {
  ready: CustomEvent<ReadyDetail>;
  error: CustomEvent<ErrorDetail>;
  loading: CustomEvent<LoadingDetail>;
  workerstatechange: CustomEvent<WorkerStateDetail>;
  segmentstatechange: CustomEvent<SegmentStateDetail>;
  playbackdecision: CustomEvent<PlaybackDecisionDetail>;
}

interface TranscodeWorkerHandle {
  worker: Worker;
}

interface AttachedSubtitleTrack {
  element: HTMLTrackElement;
  url: string;
  source: 'embedded' | 'external';
}

function normalizeErrorMessage(message: string): string {
  return message.replace(/^Error:\s*/, '').trim();
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
  private attachedSubtitleTracks: AttachedSubtitleTrack[] = [];
  private _subtitleTracks: SubtitleTrackInfo[] = [];

  // Public read-only state
  private _phase: EnginePhase = 'idle';
  private _totalSegments = 0;
  private _durationSec = 0;

  // Passthrough state
  private _passthrough = false;
  private _blobUrl: string | null = null;
  private _pendingFileType: string | null = null;
  private _codecPath: CodecPath = {
    mode: 'pipeline',
    sourceVideo: { short: null, full: null },
    sourceAudio: { short: null, full: null },
    outputVideo: { short: null, full: null },
    outputAudio: { short: null, full: null },
  };

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
  private _sourcePlaybackOptions: PlaybackOption[] | null = null;
  private _sourcePreferenceOrder: PlaybackMode[] | null = null;
  private _sourcePlaybackPolicy: PlaybackPolicy = 'auto';
  private _lastInternalErrorMessage: string | null = null;
  private _lastInternalErrorAt = 0;

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
  get codecPath(): CodecPath {
    return {
      mode: this._codecPath.mode,
      sourceVideo: { ...this._codecPath.sourceVideo },
      sourceAudio: { ...this._codecPath.sourceAudio },
      outputVideo: { ...this._codecPath.outputVideo },
      outputAudio: { ...this._codecPath.outputAudio },
    };
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
    this._sourcePlaybackOptions = null;
    this._sourcePreferenceOrder = null;
    this._sourcePlaybackPolicy = 'auto';
    this.createWorker();
    this.worker!.postMessage({ type: 'open-url', url });
    mlog(`open url=${url}`);
  }

  async loadExternalSubtitle(file: File, options: ExternalSubtitleOptions = {}): Promise<void> {
    if (this._phase !== 'ready') {
      throw new Error('Load a video before adding an external subtitle file');
    }

    const text = await file.text();
    const data = parseSubtitleFile(text, file.name);
    if (data.codec === 'ass' || data.codec === 'ssa') {
      throw new Error('External .ass/.ssa subtitles are not supported yet');
    }

    const webvtt = subtitleDataToWebVTT(data);
    this.clearExternalSubtitles();
    this.addSubtitleTrack({
      webvtt,
      source: 'external',
      label: options.label ?? file.name.replace(/\.[^.]+$/, ''),
      language: options.language ?? 'und',
      kind: options.kind ?? 'subtitles',
      defaultTrack: true,
      selectTrack: true,
    });
  }

  clearExternalSubtitles(): void {
    this.removeSubtitleTracks('external');
    this.restoreDefaultTextTrack();
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
    this._sourcePlaybackOptions = null;
    this._sourcePreferenceOrder = null;
    this._sourcePlaybackPolicy = 'auto';
    this._source = source;
    this._sourcePlan = [];
    this._sourceDoTranscode = false;
    this._sourceAudioDecoderConfig = null;
    this._sourceInitSegment = null;
    this._sourceFfmpeg = opts?.ffmpeg ?? null;
    this._sourceTargetSegDuration = opts?.targetSegmentDuration ?? 4;
    this.startSourcePipeline(source);
  }

  loadWithOptions(input: LoadWithOptionsInput): void {
    this.reset({});
    this._keyframeIndex = null;
    this._source = input.source;
    this._sourcePlan = [];
    this._sourceDoTranscode = false;
    this._sourceAudioDecoderConfig = null;
    this._sourceInitSegment = null;
    this._sourceFfmpeg = input.ffmpeg ?? null;
    this._sourceTargetSegDuration = input.targetSegmentDuration ?? 4;
    this._sourcePlaybackOptions = input.options.length > 0 ? [...input.options] : [{ mode: 'hls' }];
    this._sourcePreferenceOrder = input.preferenceOrder ? [...input.preferenceOrder] : null;
    this._sourcePlaybackPolicy = input.playbackPolicy ?? 'auto';
    this.startSourcePipeline(input.source);
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
    this.removeSubtitleTracks();

    this._phase = 'demuxing';
    this._totalSegments = 0;
    this._durationSec = 0;
    this._subtitleTracks = [];
    this._passthrough = false;
    this._pendingFileType = null;
    this._keyframeIndex = null;
    this._codecPath = {
      mode: 'pipeline',
      sourceVideo: { short: null, full: null },
      sourceAudio: { short: null, full: null },
      outputVideo: { short: null, full: null },
      outputAudio: { short: null, full: null },
    };

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
    this._sourcePlaybackOptions = null;
    this._sourcePreferenceOrder = null;
    this._sourcePlaybackPolicy = 'auto';
    this._segmentStates.clear();
    this._lastInternalErrorMessage = null;
    this._lastInternalErrorAt = 0;

    this.dispatchEvent(new CustomEvent('loading', { detail }));
    this.dispatchSegmentStateChange();
  }

  private createWorker(): void {
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.handleWorkerMessage(e);
    this.worker.onerror = (e) => {
      this.failPlayback(e.message || 'Playback worker crashed');
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
        const message = event.message || 'Transcode worker crashed';
        this.updateTranscodeWorkerState(i, {
          phase: 'error',
          jobId: null,
          lastError: message,
        });
        this.worker?.postMessage({ type: 'transcode-worker-failed', id: i, message });
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
    this.removeSubtitleTracks();
    this.pendingSegments.clear();
    this.segmentRequestTimes.clear();
    this._phase = 'idle';
    this._passthrough = false;
    this._segmentStates.clear();
    this._lastInternalErrorMessage = null;
    this._lastInternalErrorAt = 0;
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
    if (patch.phase === 'error' && patch.lastError) {
      this.recordInternalError(patch.lastError);
    }
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
    if (msg.phase === 'error' && msg.message) {
      this.recordInternalError(msg.message);
    }
    this.noteSegmentState(msg.index, msg.phase, {
      sizeBytes: msg.sizeBytes,
      message: msg.message,
    });
  }

  private recordInternalError(message: string): string {
    const normalized = normalizeErrorMessage(message);
    this._lastInternalErrorMessage = normalized;
    this._lastInternalErrorAt = performance.now();
    return normalized;
  }

  private getRecentInternalError(maxAgeMs = 5000): string | null {
    if (!this._lastInternalErrorMessage) {
      return null;
    }
    if (performance.now() - this._lastInternalErrorAt > maxAgeMs) {
      return null;
    }
    return this._lastInternalErrorMessage;
  }

  private failPlayback(message: string): void {
    const normalized = this.recordInternalError(message);
    this._phase = 'error';
    this.dispatchEvent(new CustomEvent('error', { detail: { message: normalized } }));
  }

  private createPlaybackCapabilities(): ReturnType<typeof createBrowserPlaybackCapabilities> {
    const capabilities = createBrowserPlaybackCapabilities(this.video);
    if (FORCE_REMUX) {
      return {
        ...capabilities,
        canPlayType: () => '' as const,
      };
    }
    return capabilities;
  }

  private evaluateInitialPlayback(media: PlaybackMediaMetadata): PlaybackEvaluationResult {
    const options = this._blobUrl
      ? [
          { mode: 'direct-bytes', mimeType: this._pendingFileType, url: this._blobUrl } as const,
          { mode: 'hls' } as const,
        ]
      : ([{ mode: 'hls' }] as const);

    return evaluatePlaybackOptions({
      options: [...options],
      media,
      capabilities: this.createPlaybackCapabilities(),
    });
  }

  private evaluateHlsPlayback(media: PlaybackMediaMetadata): PlaybackOptionEvaluation {
    return evaluatePlaybackOptions({
      options: [{ mode: 'hls' }],
      media,
      capabilities: this.createPlaybackCapabilities(),
    }).evaluations[0];
  }

  private evaluateSourcePlayback(media: PlaybackMediaMetadata): PlaybackEvaluationResult {
    return evaluatePlaybackOptions({
      options: this.getSourcePlaybackOptions(),
      media,
      capabilities: this.createPlaybackCapabilities(),
      preferenceOrder: this._sourcePreferenceOrder ?? undefined,
    });
  }

  private getSourcePlaybackOptions(): PlaybackOption[] {
    const baseOptions: PlaybackOption[] = this._sourcePlaybackOptions
      ? [...this._sourcePlaybackOptions]
      : [{ mode: 'hls' }];
    if (this._sourcePlaybackPolicy !== 'force-hls') {
      return baseOptions;
    }
    const hlsOption = baseOptions.find((option) => option.mode === 'hls');
    return hlsOption ? [hlsOption] : [{ mode: 'hls' }];
  }

  private logPlaybackDiagnostics(context: string, evaluation: PlaybackEvaluationResult): void {
    for (const entry of evaluation.evaluations) {
      for (const diagnostic of entry.diagnostics) {
        mlog(`${context}: mode=${entry.option.mode} ${diagnostic.code} ${diagnostic.message}`);
      }
    }
    if (!evaluation.recommended) {
      mlog(`${context}: no-supported-option`);
    }
  }

  private dispatchPlaybackDecision(
    media: PlaybackMediaMetadata,
    evaluation: PlaybackEvaluationResult,
  ): void {
    this.dispatchEvent(
      new CustomEvent('playbackdecision', {
        detail: {
          media,
          evaluation,
          playbackPolicy: this._sourcePlaybackPolicy,
        },
      }),
    );
  }

  private throwPlaybackSelectionError(context: string, diagnostics: PlaybackDiagnostic[]): never {
    const detail =
      diagnostics.length > 0
        ? diagnostics.map((diagnostic) => diagnostic.message).join(' ')
        : 'No supported playback option.';
    throw new Error(`${context}: ${detail}`);
  }

  private failPlaybackSelection(context: string, diagnostics: PlaybackDiagnostic[]): void {
    const detail =
      diagnostics.length > 0
        ? diagnostics.map((diagnostic) => diagnostic.message).join(' ')
        : 'No supported playback option.';
    this.failPlayback(`${context}: ${detail}`);
  }

  private makeCodecPathFromSource(
    media: PlaybackMediaMetadata,
    mode: CodecPath['mode'],
    outputAudio: CodecDescriptor = {
      short: media.sourceAudioCodec,
      full: media.audioCodec,
    },
  ): CodecPath {
    return {
      mode,
      sourceVideo: {
        short: media.sourceVideoCodec,
        full: media.videoCodec,
      },
      sourceAudio: {
        short: media.sourceAudioCodec,
        full: media.audioCodec,
      },
      outputVideo: {
        short: media.sourceVideoCodec,
        full: media.videoCodec,
      },
      outputAudio,
    };
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
            subtitleTracks: this._subtitleTracks,
            passthrough: true,
            codecPath: this.codecPath,
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
      const media: PlaybackMediaMetadata = {
        sourceVideoCodec: msg.sourceVideoCodec ?? null,
        sourceAudioCodec: msg.sourceAudioCodec ?? null,
        videoCodec: msg.videoCodec ?? null,
        audioCodec: msg.audioCodec ?? null,
      };
      const evaluation = this.evaluateInitialPlayback(media);
      this.logPlaybackDiagnostics('playback selection', evaluation);
      this.dispatchPlaybackDecision(media, evaluation);
      this._subtitleTracks = msg.subtitleTracks ?? [];
      const blobUrl = this._blobUrl;
      const usePassthrough =
        evaluation.recommended?.option.mode === 'direct-bytes' && blobUrl !== null;
      this._codecPath = this.makeCodecPathFromSource(
        media,
        usePassthrough ? 'passthrough' : 'pipeline',
      );

      if (usePassthrough && blobUrl) {
        mlog(`passthrough: selected direct playback codecs=${msg.videoCodec}/${msg.audioCodec}`);
        this.startPassthrough(blobUrl);
        this.worker!.postMessage({ type: 'passthrough-pipeline' });

        if (this._subtitleTracks.length > 0) {
          this.dispatchSubtitleStatus(
            `Extracting ${this._subtitleTracks.length} subtitle track(s)...`,
          );
        } else {
          this.dispatchSubtitleStatus('No embedded subtitles');
        }
        for (const track of this._subtitleTracks) {
          mlog(
            `requesting subtitle track=${track.index} lang=${track.language} codec=${track.codec}`,
          );
          this.worker!.postMessage({ type: 'subtitle', trackIndex: track.index });
        }
      } else {
        const hlsEvaluation = evaluation.evaluations.find((entry) => entry.option.mode === 'hls');
        if (evaluation.recommended?.option.mode !== 'hls') {
          this.failPlaybackSelection('Playback selection failed', hlsEvaluation?.diagnostics ?? []);
          return;
        }
        if (this._blobUrl) {
          URL.revokeObjectURL(this._blobUrl);
          this._blobUrl = null;
        }
        mlog('pipeline: selected remux/HLS playback');
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
      this._codecPath = {
        mode: 'pipeline',
        sourceVideo: {
          short: msg.sourceVideoCodec ?? this._codecPath.sourceVideo.short,
          full: msg.sourceVideoCodecFull ?? this._codecPath.sourceVideo.full,
        },
        sourceAudio: {
          short: msg.sourceAudioCodec ?? this._codecPath.sourceAudio.short,
          full: msg.sourceAudioCodecFull ?? this._codecPath.sourceAudio.full,
        },
        outputVideo: {
          short: msg.outputVideoCodec ?? this._codecPath.outputVideo.short,
          full: msg.outputVideoCodecFull ?? this._codecPath.outputVideo.full,
        },
        outputAudio: {
          short: msg.outputAudioCodec ?? this._codecPath.outputAudio.short,
          full: msg.outputAudioCodecFull ?? this._codecPath.outputAudio.full,
        },
      };

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
      if (this._subtitleTracks.length > 0) {
        this.dispatchSubtitleStatus(
          `Extracting ${this._subtitleTracks.length} subtitle track(s)...`,
        );
      } else {
        this.dispatchSubtitleStatus('No embedded subtitles');
      }
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
            codecPath: this.codecPath,
          },
        }),
      );

      this.startHls();
    } else if (msg.type === 'subtitle') {
      mlog(`subtitle arrived track=${msg.trackIndex} codec=${msg.codec} len=${msg.webvtt?.length}`);
      const info = this._subtitleTracks.find((t) => t.index === msg.trackIndex);
      const lang = info?.language ?? '?';
      const cueMatch = msg.webvtt?.match(/\d\d:\d\d/g);
      const cueCount = cueMatch ? Math.floor(cueMatch.length / 2) : 0;
      this.dispatchSubtitleStatus(
        `Subtitle track ${msg.trackIndex}: ${lang} ${msg.codec} ${cueCount} cues, ${msg.webvtt?.length ?? 0} bytes`,
      );
      this.addSubtitleTrack({
        webvtt: msg.webvtt,
        source: 'embedded',
        trackIndex: msg.trackIndex,
        defaultTrack: msg.trackIndex === 0,
        selectTrack: msg.trackIndex === 0,
      });
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
      this.failPlayback(msg.message);

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
        const mkvIndex = await buildMkvKeyframeIndexFromSource(source);
        if (mkvIndex) {
          index = mkvIndex;
          mlog(`source pipeline: mkv-cues keyframes=${index.keyframes.length}`);
        } else {
          index = await getKeyframeIndex(demux.videoSink, demux.duration);
          mlog(`source pipeline: keyframe-index keyframes=${index.keyframes.length}`);
        }
      }

      // Build segment plan
      this._sourcePlan = buildSegmentPlan({
        keyframeTimestampsSec: index.keyframes.map((k) => k.timestamp),
        durationSec: index.duration,
        targetSegmentDurationSec: this._sourceTargetSegDuration,
      });

      const media: PlaybackMediaMetadata = {
        sourceVideoCodec: demux.videoCodec,
        sourceAudioCodec: demux.audioCodec,
        videoCodec: demux.videoDecoderConfig.codec,
        audioCodec: demux.audioDecoderConfig?.codec ?? null,
      };
      const evaluation = this.evaluateSourcePlayback(media);
      this.logPlaybackDiagnostics('source playback selection', evaluation);
      this.dispatchPlaybackDecision(media, evaluation);

      const selectedOption = evaluation.recommended?.option ?? null;
      if (!selectedOption) {
        this.throwPlaybackSelectionError(
          'Source playback selection failed',
          evaluation.evaluations.flatMap((entry) => entry.diagnostics),
        );
      }

      if (selectedOption.mode !== 'hls') {
        if (!selectedOption.url) {
          this.throwPlaybackSelectionError(
            'Source playback selection failed',
            evaluation.evaluations.flatMap((entry) => entry.diagnostics),
          );
        }
        this._subtitleTracks = demux.subtitleTracks;
        this._codecPath = this.makeCodecPathFromSource(media, 'passthrough');
        this._sourcePlan = [];
        this._sourceDoTranscode = false;
        this._sourceAudioDecoderConfig = null;
        this._sourceInitSegment = null;
        mlog(`source pipeline: selected ${selectedOption.mode}`);
        this.startPassthrough(selectedOption.url);
        void this.extractEmbeddedSubtitlesFromDemux(demux, { releaseAfterComplete: true });
        return;
      }

      const hlsEvaluation =
        evaluation.evaluations.find((entry) => entry.option.mode === 'hls') ?? null;
      if (!hlsEvaluation || hlsEvaluation.status !== 'supported') {
        this.throwPlaybackSelectionError(
          'Source playback selection failed',
          evaluation.evaluations.flatMap((entry) => entry.diagnostics),
        );
      }
      this._sourceDoTranscode = hlsEvaluation.pipelineAudioRequiresTranscode === true;
      this._sourceAudioDecoderConfig = this._sourceDoTranscode
        ? makeAacDecoderConfig(demux.audioDecoderConfig)
        : demux.audioDecoderConfig;
      this._codecPath = this.makeCodecPathFromSource(media, 'pipeline', {
        short: this._sourceDoTranscode ? 'aac' : demux.audioCodec,
        full: this._sourceAudioDecoderConfig?.codec ?? null,
      });

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
            codecPath: this.codecPath,
          },
        }),
      );

      void this.extractEmbeddedSubtitlesFromDemux(demux);
      this.startHls();
    } catch (err) {
      this.failPlayback(String(err));
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
      this.failPlayback('hls.js not supported in this browser');
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
      private callbacks: LoaderCallbacks<FragmentLoaderContext> | null = null;
      private aborted = false;

      load(
        context: FragmentLoaderContext,
        _config: LoaderConfiguration,
        callbacks: LoaderCallbacks<FragmentLoaderContext>,
      ) {
        this.context = context;
        this.callbacks = callbacks;
        this.aborted = false;
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
            if (this.aborted) {
              return;
            }
            this.currentSegmentIndex = null;
            this.stats.loaded = data.byteLength;
            this.stats.loading.end = performance.now();
            callbacks.onSuccess({ url: context.url, data }, this.stats, context, null);
          })
          .catch((err) => {
            if (this.aborted) {
              return;
            }
            this.currentSegmentIndex = null;
            if (err instanceof DOMException && err.name === 'AbortError') {
              this.stats.aborted = true;
              callbacks.onAbort?.(this.stats, context, null);
              return;
            }
            callbacks.onError({ code: 0, text: err.message }, context, null, this.stats);
          });
      }

      abort() {
        if (this.aborted) {
          return;
        }
        this.aborted = true;
        this.stats.aborted = true;
        let abortedActiveSegment = false;
        if (this.currentSegmentIndex !== null) {
          abortedActiveSegment = true;
          if (engine._source) {
            // Source mode: abort the in-flight main-thread processing
            engine._sourceSegmentAbort?.abort();
          } else {
            // Worker mode: cancel via worker message
            engine.cancelSegment(this.currentSegmentIndex);
          }
          this.currentSegmentIndex = null;
        }
        if (abortedActiveSegment && this.callbacks && this.context) {
          this.callbacks.onAbort?.(this.stats, this.context, null);
        }
      }

      destroy() {
        this.abort();
        this.callbacks = null;
        this.context = null;
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
      const underlyingMessage =
        data.error?.message ?? data.reason ?? data.response?.text ?? data.err?.message ?? null;
      mlog(
        `hls ERROR fatal=${data.fatal} type=${data.type} details=${data.details}${underlyingMessage ? ` message=${underlyingMessage}` : ''}`,
      );
      if (data.fatal) {
        console.error('hls.js fatal error:', data);
        const internalMessage = this.getRecentInternalError();
        const message =
          internalMessage && data.details === 'fragLoadError'
            ? internalMessage
            : underlyingMessage
              ? `${data.details} (${normalizeErrorMessage(underlyingMessage)})`
              : data.details;
        this.failPlayback(message);
      }
    });

    this.hls.loadSource('/virtual/playlist.m3u8');
    this.hls.attachMedia(this.video);
  }

  private addSubtitleTrack({
    webvtt,
    source,
    trackIndex,
    label,
    language,
    kind,
    defaultTrack = false,
    selectTrack = false,
  }: {
    webvtt: string;
    source: 'embedded' | 'external';
    trackIndex?: number;
    label?: string;
    language?: string;
    kind?: 'subtitles' | 'captions';
    defaultTrack?: boolean;
    selectTrack?: boolean;
  }): void {
    const blob = new Blob([webvtt], { type: 'text/vtt' });
    const url = URL.createObjectURL(blob);
    const info =
      trackIndex === undefined
        ? undefined
        : this._subtitleTracks.find((t) => t.index === trackIndex);
    const track = document.createElement('track');
    track.kind = kind ?? (info?.disposition.hearingImpaired ? 'captions' : 'subtitles');
    track.src = url;
    track.srclang = normalizeSubtitleLanguageCode(language ?? info?.language ?? 'und');
    track.label =
      label ??
      info?.name ??
      languageLabel(
        info?.language ?? 'und',
        trackIndex ?? this.video.querySelectorAll('track').length,
      );
    track.default = defaultTrack;
    this.video.appendChild(track);
    this.attachedSubtitleTracks.push({ element: track, url, source });
    if (selectTrack) {
      track.addEventListener('load', () => this.showTextTrack(track), { once: true });
      queueMicrotask(() => this.showTextTrack(track));
    }
    mlog(
      `subtitle track ${trackIndex ?? 'external'} attached as <track kind=${track.kind} lang=${track.srclang}>`,
    );
  }

  private removeSubtitleTracks(source?: 'embedded' | 'external'): void {
    const keep: AttachedSubtitleTrack[] = [];
    for (const attached of this.attachedSubtitleTracks) {
      if (source && attached.source !== source) {
        keep.push(attached);
        continue;
      }
      attached.element.remove();
      URL.revokeObjectURL(attached.url);
    }
    this.attachedSubtitleTracks = keep;
  }

  private showTextTrack(track: HTMLTrackElement): void {
    for (let i = 0; i < this.video.textTracks.length; i++) {
      this.video.textTracks[i].mode = 'disabled';
    }
    track.track.mode = 'showing';
  }

  private dispatchSubtitleStatus(message: string): void {
    mlog(`subtitle-status: ${message}`);
    this.dispatchEvent(new CustomEvent('subtitle-status', { detail: { message } }));
  }

  private async extractEmbeddedSubtitlesFromDemux(
    demux: DemuxResult,
    options: { releaseAfterComplete?: boolean } = {},
  ): Promise<void> {
    const subtitleTracks = demux.subtitleTracks;
    if (subtitleTracks.length === 0) {
      this.dispatchSubtitleStatus('No embedded subtitles');
      if (options.releaseAfterComplete && this._sourceDemux === demux) {
        this._sourceDemux.dispose();
        this._sourceDemux = null;
        this._source = null;
      }
      return;
    }

    this.dispatchSubtitleStatus(`Extracting ${subtitleTracks.length} subtitle track(s)...`);

    try {
      for (const track of subtitleTracks) {
        mlog(
          `extracting subtitle track=${track.index} lang=${track.language} codec=${track.codec}`,
        );
        const data = await extractSubtitleData(demux.input, track.index);
        const webvtt = subtitleDataToWebVTT(data);
        const cueMatch = webvtt.match(/\d\d:\d\d/g);
        const cueCount = cueMatch ? Math.floor(cueMatch.length / 2) : 0;
        this.dispatchSubtitleStatus(
          `Subtitle track ${track.index}: ${track.language ?? '?'} ${data.codec} ${cueCount} cues, ${webvtt.length} bytes`,
        );
        this.addSubtitleTrack({
          webvtt,
          source: 'embedded',
          trackIndex: track.index,
          defaultTrack: track.index === 0,
          selectTrack: track.index === 0,
        });
      }
    } catch (error) {
      this.dispatchSubtitleStatus(`Subtitle extraction failed: ${String(error)}`);
    } finally {
      if (options.releaseAfterComplete && this._sourceDemux === demux) {
        this._sourceDemux.dispose();
        this._sourceDemux = null;
        this._source = null;
      }
    }
  }

  private restoreDefaultTextTrack(): void {
    const preferred =
      this.attachedSubtitleTracks.find((attached) => attached.element.default) ??
      this.attachedSubtitleTracks[0];
    if (!preferred) return;
    queueMicrotask(() => this.showTextTrack(preferred.element));
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

function normalizeSubtitleLanguageCode(code: string): string {
  if (code.length === 2) return code;
  return iso639_2to1(code);
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
