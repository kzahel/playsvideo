import type { SegmentPhase, SegmentState, WasmWorkerState } from './engine.js';
import { PlaysVideoEngine } from './engine.js';

const fileInput = document.getElementById('file-input') as HTMLInputElement;
const video = document.getElementById('video') as HTMLVideoElement;
const status = document.getElementById('status') as HTMLElement;
const logEl = document.getElementById('log') as HTMLElement;
const workerSummaryEl = document.getElementById('worker-summary') as HTMLElement;
const workerListEl = document.getElementById('worker-list') as HTMLElement;
const segmentSummaryEl = document.getElementById('segment-summary') as HTMLElement;
const segmentLegendEl = document.getElementById('segment-legend') as HTMLElement;
const segmentListEl = document.getElementById('segment-list') as HTMLElement;

const engine = new PlaysVideoEngine(video);
let workerStates: WasmWorkerState[] = [];
let segmentStates: SegmentState[] = [];

const ACTIVE_SEGMENT_PHASES = new Set<SegmentPhase>([
  'requested',
  'queued',
  'prefetching',
  'processing',
]);

const SEGMENT_LEGEND: Array<{ phase: SegmentPhase; label: string }> = [
  { phase: 'requested', label: 'requested' },
  { phase: 'queued', label: 'queued' },
  { phase: 'prefetching', label: 'prefetch' },
  { phase: 'processing', label: 'processing' },
  { phase: 'ready', label: 'ready' },
  { phase: 'cache-hit', label: 'cache hit' },
  { phase: 'delivered', label: 'delivered' },
  { phase: 'canceled', label: 'canceled' },
  { phase: 'aborted', label: 'aborted' },
  { phase: 'error', label: 'error' },
];

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) engine.loadFile(file);
});

engine.addEventListener('loading', (e) => {
  const { file, url } = e.detail;
  status.textContent = `Opening ${file?.name ?? url ?? ''}...`;
  video.style.display = 'none';
  if (file) {
    log(
      'loading',
      `loadFile name=${file.name} size=${(file.size / 1024 / 1024).toFixed(1)}MB type=${file.type}`,
    );
  } else {
    log('loading', `loadUrl url=${url}`);
  }
});

engine.addEventListener('ready', (e) => {
  const { totalSegments, durationSec, subtitleTracks, passthrough } = e.detail;
  const mode = passthrough ? 'direct playback' : `${totalSegments} segments`;
  status.textContent = `Ready — ${mode}, ${formatTime(durationSec)}`;
  video.style.display = 'block';
  log('ready', `ready mode=${mode} duration=${durationSec.toFixed(1)}s`);
  if (subtitleTracks.length > 0) {
    for (const t of subtitleTracks) {
      log(
        'subtitle',
        `subtitle track=${t.index} lang=${t.language} codec=${t.codec} name=${t.name ?? '(none)'}`,
      );
    }
  }
  renderWorkerStates();
});

engine.addEventListener('error', (e) => {
  status.textContent = `Error: ${e.detail.message}`;
  log('error', e.detail.message);
  renderWorkerStates();
});

engine.addEventListener('loading', () => {
  workerStates = [];
  segmentStates = [];
  renderWorkerStates();
  renderSegmentTimeline();
});

engine.addEventListener('workerstatechange', (e) => {
  workerStates = e.detail.workers;
  renderWorkerStates();
});

engine.addEventListener('segmentstatechange', (e) => {
  segmentStates = e.detail.segments;
  renderSegmentTimeline();
});

// Intercept console.log to capture [engine] messages
const origLog = console.log;
const origWarn = console.warn;
const origError = console.error;

console.log = (...args: unknown[]) => {
  origLog(...args);
  const msg = args.map(String).join(' ');
  if (msg.startsWith('[engine]')) {
    const body = msg.slice('[engine] '.length);
    if (body.startsWith('hls ')) {
      log('hls', body);
    } else if (body.startsWith('WARN')) {
      log('warn', body);
    } else if (body.startsWith('seg ') || body.startsWith('req seg')) {
      log('segment', body);
    } else if (body.startsWith('subtitle')) {
      log('subtitle', body);
    } else {
      log('ready', body);
    }
  }
};

console.warn = (...args: unknown[]) => {
  origWarn(...args);
  log('warn', args.map(String).join(' '));
};

console.error = (...args: unknown[]) => {
  origError(...args);
  log('error', args.map(String).join(' '));
};

// Video element events
for (const evt of [
  'play',
  'pause',
  'seeking',
  'seeked',
  'waiting',
  'stalled',
  'error',
  'ended',
] as const) {
  video.addEventListener(evt, () => {
    const t = video.currentTime.toFixed(1);
    const buffered =
      video.buffered.length > 0
        ? `${video.buffered.start(0).toFixed(1)}-${video.buffered.end(video.buffered.length - 1).toFixed(1)}`
        : 'none';
    log('hls', `video.${evt} t=${t} buffered=${buffered} readyState=${video.readyState}`);
  });
}

function log(cls: string, msg: string) {
  const ts = performance.now().toFixed(0).padStart(7);
  const line = document.createElement('div');
  line.className = `log-${cls}`;
  line.textContent = `${ts}ms  ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function renderWorkerStates() {
  workerListEl.replaceChildren();

  if (workerStates.length === 0) {
    if (engine.passthrough) {
      workerSummaryEl.textContent = 'No wasm workers active. Playback is using direct passthrough.';
    } else if (engine.loading) {
      workerSummaryEl.textContent = 'No wasm workers active yet. Waiting for the remux decision.';
    } else {
      workerSummaryEl.textContent = 'No wasm workers active.';
    }
    return;
  }

  const busyWorkers = workerStates.filter((worker) => worker.phase !== 'idle').length;
  workerSummaryEl.textContent = `${workerStates.length} wasm workers, ${busyWorkers} active`;

  for (const worker of workerStates) {
    const card = document.createElement('section');
    card.className = 'worker-card';

    const header = document.createElement('div');
    header.className = 'worker-card-header';

    const title = document.createElement('strong');
    title.textContent = `Worker ${worker.id}`;

    const phase = document.createElement('span');
    phase.className = `worker-phase worker-phase-${worker.phase}`;
    phase.textContent = worker.phase;

    header.append(title, phase);
    card.appendChild(header);

    card.appendChild(makeWorkerLine('codec', worker.sourceCodec ?? 'unloaded'));
    card.appendChild(makeWorkerLine('job', worker.jobId === null ? 'idle' : `#${worker.jobId}`));
    card.appendChild(makeWorkerLine('input', formatBytes(worker.inputBytes)));
    card.appendChild(makeWorkerLine('output', formatBytes(worker.outputBytes)));
    card.appendChild(makeWorkerLine('last total', formatMs(worker.totalMs)));
    card.appendChild(makeWorkerLine('last ffmpeg', formatMs(worker.ffmpegMs)));
    card.appendChild(makeWorkerLine('completed', String(worker.jobsCompleted)));

    if (worker.lastError) {
      const errorLine = makeWorkerLine('error', worker.lastError);
      errorLine.classList.add('worker-line-error');
      card.appendChild(errorLine);
    }

    workerListEl.appendChild(card);
  }
}

function renderSegmentLegend() {
  segmentLegendEl.replaceChildren();
  for (const item of SEGMENT_LEGEND) {
    const entry = document.createElement('div');
    entry.className = `segment-legend-item segment-phase-${item.phase}`;

    const swatch = document.createElement('span');
    swatch.className = 'segment-swatch';

    const label = document.createElement('span');
    label.textContent = item.label;

    entry.append(swatch, label);
    segmentLegendEl.appendChild(entry);
  }
}

function renderSegmentTimeline() {
  segmentListEl.replaceChildren();

  if (segmentStates.length === 0) {
    segmentSummaryEl.textContent = 'No segment activity yet.';
    const empty = document.createElement('div');
    empty.className = 'segment-empty';
    empty.textContent = engine.passthrough
      ? 'Direct playback is active, so the remux segment pipeline is idle.'
      : 'Segment requests will appear here once playback starts pulling fragments.';
    segmentListEl.appendChild(empty);
    return;
  }

  const eventTimes = segmentStates.flatMap((segment) => segment.events.map((event) => event.atMs));
  const minAt = Math.min(...eventTimes);
  const maxAt = Math.max(...eventTimes);
  const hasActiveSegments = segmentStates.some((segment) =>
    ACTIVE_SEGMENT_PHASES.has(segment.phase),
  );
  const timelineEnd = hasActiveSegments ? Math.max(maxAt, performance.now()) : maxAt;
  const spanMs = Math.max(1, timelineEnd - minAt);
  const activeCount = segmentStates.filter((segment) =>
    ACTIVE_SEGMENT_PHASES.has(segment.phase),
  ).length;
  const completedCount = segmentStates.filter((segment) => segment.phase === 'delivered').length;
  segmentSummaryEl.textContent = `${segmentStates.length} touched · ${activeCount} active · ${completedCount} delivered · ${formatMs(spanMs)} wall`;

  for (const segment of segmentStates) {
    const row = document.createElement('section');
    row.className = 'segment-row';

    const meta = document.createElement('div');
    meta.className = 'segment-meta';

    const metaTop = document.createElement('div');
    metaTop.className = 'segment-meta-top';

    const index = document.createElement('span');
    index.className = 'segment-index';
    index.textContent = `seg-${segment.index}`;

    const phase = document.createElement('span');
    phase.className = `segment-phase-pill segment-phase-${segment.phase}`;
    phase.textContent = segment.phase;

    metaTop.append(index, phase);

    const stats = document.createElement('div');
    stats.className = 'segment-stats';
    stats.textContent = formatSegmentStats(segment);

    meta.append(metaTop, stats);

    const track = document.createElement('div');
    track.className = 'segment-track';

    for (let i = 0; i < segment.events.length; i++) {
      const event = segment.events[i];
      const nextAt =
        i < segment.events.length - 1
          ? segment.events[i + 1].atMs
          : ACTIVE_SEGMENT_PHASES.has(segment.phase)
            ? timelineEnd
            : Math.min(timelineEnd, event.atMs + Math.max(40, spanMs * 0.025));
      const left = ((event.atMs - minAt) / spanMs) * 100;
      const width = Math.max(0.8, ((nextAt - event.atMs) / spanMs) * 100);

      const block = document.createElement('div');
      block.className = `segment-block segment-phase-${event.phase}`;
      block.style.left = `${left}%`;
      block.style.width = `${Math.min(100 - left, width)}%`;
      block.title = describeSegmentEvent(event, minAt);
      track.appendChild(block);
    }

    row.append(meta, track);
    segmentListEl.appendChild(row);
  }
}

function makeWorkerLine(label: string, value: string): HTMLDivElement {
  const line = document.createElement('div');
  line.className = 'worker-line';

  const key = document.createElement('span');
  key.className = 'worker-line-label';
  key.textContent = label;

  const val = document.createElement('span');
  val.className = 'worker-line-value';
  val.textContent = value;

  line.append(key, val);
  return line;
}

function formatBytes(value: number | null): string {
  if (value === null) return 'n/a';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function formatMs(value: number | null): string {
  if (value === null) return 'n/a';
  return `${value.toFixed(1)} ms`;
}

function formatSegmentStats(segment: SegmentState): string {
  const parts = [`${segment.requestCount} req`, segment.prefetched ? 'prefetched' : 'on-demand'];
  if (segment.latencyMs !== null) {
    parts.push(`${segment.latencyMs.toFixed(1)} ms`);
  }
  if (segment.sizeBytes !== null) {
    parts.push(formatBytes(segment.sizeBytes));
  }
  if (segment.error) {
    parts.push(segment.error);
  }
  return parts.join(' · ');
}

function describeSegmentEvent(
  event: SegmentState['events'][number],
  timelineStartAt: number,
): string {
  const parts = [`${event.phase} @ +${Math.max(0, event.atMs - timelineStartAt).toFixed(1)} ms`];
  if (event.sizeBytes !== null) {
    parts.push(formatBytes(event.sizeBytes));
  }
  if (event.message) {
    parts.push(event.message);
  }
  return parts.join(' | ');
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

renderSegmentLegend();
renderWorkerStates();
renderSegmentTimeline();
