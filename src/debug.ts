import { PlaysVideoEngine } from './engine.js';

const fileInput = document.getElementById('file-input') as HTMLInputElement;
const video = document.getElementById('video') as HTMLVideoElement;
const status = document.getElementById('status') as HTMLElement;
const logEl = document.getElementById('log') as HTMLElement;

const engine = new PlaysVideoEngine(video);

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
  const { totalSegments, durationSec, subtitleTracks } = e.detail;
  status.textContent = `Ready — ${totalSegments} segments, ${formatTime(durationSec)}`;
  video.style.display = 'block';
  log('ready', `ready segments=${totalSegments} duration=${durationSec.toFixed(1)}s`);
  if (subtitleTracks.length > 0) {
    for (const t of subtitleTracks) {
      log(
        'subtitle',
        `subtitle track=${t.index} lang=${t.language} codec=${t.codec} name=${t.name ?? '(none)'}`,
      );
    }
  }
});

engine.addEventListener('error', (e) => {
  status.textContent = `Error: ${e.detail.message}`;
  log('error', e.detail.message);
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

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
