import type { WasmWorkerState } from './engine.js';
import { PlaysVideoEngine } from './engine.js';

const fileInput = document.getElementById('file-input') as HTMLInputElement;
const video = document.getElementById('video') as HTMLVideoElement;
const status = document.getElementById('status') as HTMLElement;
const logEl = document.getElementById('log') as HTMLElement;
const workerSummaryEl = document.getElementById('worker-summary') as HTMLElement;
const workerListEl = document.getElementById('worker-list') as HTMLElement;

const engine = new PlaysVideoEngine(video);
let workerStates: WasmWorkerState[] = [];

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
  renderWorkerStates();
});

engine.addEventListener('workerstatechange', (e) => {
  workerStates = e.detail.workers;
  renderWorkerStates();
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

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

renderWorkerStates();
