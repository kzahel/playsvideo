import { PlaysVideoEngine } from './engine.js';
import { bindExternalSubtitlePicker } from './external-subtitle-picker.js';
import videojsImport from 'video.js';
import 'video.js/dist/video-js.css';
import { VIDEOJS_CONTROLS_ENABLED } from './feature-flags.js';

const fileInput = document.getElementById('file-input') as HTMLInputElement;
const subtitleInput = document.getElementById('subtitle-input') as HTMLInputElement;
const video = document.getElementById('video') as HTMLVideoElement;
const videoContainer = document.getElementById('video-container') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;
const subtitleStatus = document.getElementById('subtitle-status') as HTMLElement;
const dropTarget = document.getElementById('drop-target') as HTMLElement;
const openAnother = document.getElementById('open-another') as HTMLButtonElement;
const loadSubtitles = document.getElementById('load-subtitles') as HTMLButtonElement;
const clearSubtitles = document.getElementById('clear-subtitles') as HTMLButtonElement;
const toggleControlsBtn = document.getElementById('toggle-controls') as HTMLButtonElement;
const playerActions = document.getElementById('player-actions') as HTMLElement;

const engine = new PlaysVideoEngine(video);
const subtitlePicker = bindExternalSubtitlePicker({
  engine,
  input: subtitleInput,
  openButton: loadSubtitles,
  clearButton: clearSubtitles,
  status: subtitleStatus,
});

function loadFile(file: File) {
  engine.loadFile(file);
}

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/player' });
}

// File input (hidden, triggered by drop target click or "open another")
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

// Drop target — click to browse
dropTarget.addEventListener('click', () => {
  fileInput.click();
});

// Drop target — drag and drop
dropTarget.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropTarget.classList.add('dragover');
});

dropTarget.addEventListener('dragleave', () => {
  dropTarget.classList.remove('dragover');
});

dropTarget.addEventListener('drop', (e) => {
  e.preventDefault();
  dropTarget.classList.remove('dragover');
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

// "Open another file" button
openAnother.addEventListener('click', () => {
  fileInput.click();
});

// File Handling API (desktop Chrome/Edge — OS file association)
if ('launchQueue' in window) {
  (window as any).launchQueue.setConsumer(async (launchParams: any) => {
    if (!launchParams.files?.length) return;
    const handle = launchParams.files[0];
    const file = await handle.getFile();
    loadFile(file);
  });
}

// Web Share Target (Android — receive files from share sheet)
async function handleShareTarget() {
  const params = new URL(location.href).searchParams;
  if (params.get('source') !== 'share') return;

  const cache = await caches.open('playsvideo-shared');
  const response = await cache.match('/shared-video-file');
  if (response) {
    const blob = await response.blob();
    const file = new File([blob], 'shared-video', { type: blob.type });
    loadFile(file);
    await cache.delete('/shared-video-file');
  }
  // Clean the URL
  history.replaceState(null, '', '/player');
}
handleShareTarget();

engine.addEventListener('loading', (e) => {
  status.textContent = `Opening ${e.detail.file?.name ?? e.detail.url ?? ''}...`;
  dropTarget.classList.add('hidden');
  setVideoVisible(false);
  playerActions.style.display = 'none';
  subtitlePicker.reset();
  videoReady = false;
});

engine.addEventListener('ready', (e) => {
  const mode = e.detail.passthrough ? 'direct playback' : `${e.detail.totalSegments} segments`;
  status.textContent = `Ready — ${mode}, ${formatTime(e.detail.durationSec)}`;
  dropTarget.classList.add('hidden');
  setVideoVisible(true);
  playerActions.style.display = 'flex';
  videoReady = true;
  applyControlsType();
});

engine.addEventListener('error', (e) => {
  status.textContent = `Error: ${e.detail.message}`;
  dropTarget.classList.remove('hidden');
  setVideoVisible(false);
  playerActions.style.display = 'none';
  subtitlePicker.reset();
  videoReady = false;
});

// Controls toggle
type ControlsType = 'stock' | 'videojs';

const VIDEOJS_OPTIONS = {
  autoplay: true,
  controls: true,
  playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
  preload: 'auto',
  responsive: true,
  controlBar: {
    skipButtons: {
      backward: 10,
      forward: 10,
    },
  },
};

interface VideoJsPlayer {
  controls(enabled: boolean): boolean;
  el(): HTMLElement;
  isDisposed(): boolean;
  responsive(enabled: boolean): boolean | undefined;
}

type VideoJsFactory = (element: HTMLVideoElement, options: typeof VIDEOJS_OPTIONS) => VideoJsPlayer;

const videojs = videojsImport as unknown as VideoJsFactory;

function normalizeControlsType(value: unknown): ControlsType {
  return VIDEOJS_CONTROLS_ENABLED && (value === 'videojs' || value === 'custom')
    ? 'videojs'
    : 'stock';
}

let controlsType = normalizeControlsType(localStorage.getItem('pv-controls-type'));
let videoJsPlayer: ReturnType<typeof videojs> | null = null;
let videoReady = false;

function getVideoJsPlayer() {
  if (videoJsPlayer && !videoJsPlayer.isDisposed()) {
    return videoJsPlayer;
  }

  video.classList.add('video-js', 'vjs-big-play-centered');
  videoJsPlayer = videojs(video, VIDEOJS_OPTIONS);
  sizeVideoJsPlayer(videoJsPlayer);
  videoJsPlayer.responsive(true);
  return videoJsPlayer;
}

function sizeVideoJsPlayer(player: VideoJsPlayer) {
  const playerEl = player.el();
  playerEl.style.width = '100%';
  playerEl.style.height = 'auto';
  playerEl.style.aspectRatio = '16 / 9';
  const techEl = playerEl.querySelector<HTMLElement>('.vjs-tech');
  if (techEl) {
    techEl.style.objectFit = 'contain';
  }
}

function setVideoVisible(visible: boolean) {
  const display = visible ? 'block' : 'none';
  video.style.display = display;
  if (videoJsPlayer && !videoJsPlayer.isDisposed()) {
    videoJsPlayer.el().style.display = display;
  }
}

function applyControlsType() {
  toggleControlsBtn.hidden = !VIDEOJS_CONTROLS_ENABLED;
  toggleControlsBtn.textContent =
    controlsType === 'videojs' ? 'Stock controls' : 'Video.js controls';
  videoContainer.classList.toggle('pv-videojs-container', controlsType === 'videojs');
  if (!videoReady) return;
  if (VIDEOJS_CONTROLS_ENABLED && controlsType === 'videojs') {
    video.removeAttribute('controls');
    const player = getVideoJsPlayer();
    player.controls(true);
    setVideoVisible(true);
  } else {
    videoJsPlayer?.controls(false);
    video.setAttribute('controls', '');
  }
}

toggleControlsBtn.addEventListener('click', () => {
  if (!VIDEOJS_CONTROLS_ENABLED) return;
  controlsType = controlsType === 'stock' ? 'videojs' : 'stock';
  localStorage.setItem('pv-controls-type', controlsType);
  applyControlsType();
});

applyControlsType();

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
