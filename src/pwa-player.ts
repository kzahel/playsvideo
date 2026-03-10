import { PlaysVideoEngine } from './engine.js';
import { createCustomControls, type CustomControlsHandle } from './custom-controls.js';
import { bindExternalSubtitlePicker } from './external-subtitle-picker.js';

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
  video.style.display = 'none';
  playerActions.style.display = 'none';
  subtitlePicker.reset();
});

engine.addEventListener('ready', (e) => {
  const mode = e.detail.passthrough ? 'direct playback' : `${e.detail.totalSegments} segments`;
  status.textContent = `Ready — ${mode}, ${formatTime(e.detail.durationSec)}`;
  dropTarget.classList.add('hidden');
  video.style.display = 'block';
  playerActions.style.display = 'flex';
});

engine.addEventListener('error', (e) => {
  status.textContent = `Error: ${e.detail.message}`;
  dropTarget.classList.remove('hidden');
  playerActions.style.display = 'none';
  subtitlePicker.reset();
});

// Controls toggle
let controlsType = localStorage.getItem('pv-controls-type') === 'custom' ? 'custom' : 'stock';
let customControlsHandle: CustomControlsHandle | null = null;

function applyControlsType() {
  if (controlsType === 'custom') {
    video.removeAttribute('controls');
    if (!customControlsHandle) {
      customControlsHandle = createCustomControls({ video, container: videoContainer });
    }
    toggleControlsBtn.textContent = 'Stock controls';
  } else {
    video.setAttribute('controls', '');
    customControlsHandle?.destroy();
    customControlsHandle = null;
    toggleControlsBtn.textContent = 'Custom controls';
  }
}

toggleControlsBtn.addEventListener('click', () => {
  controlsType = controlsType === 'stock' ? 'custom' : 'stock';
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
