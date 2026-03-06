import { PlaysVideoEngine } from '../src/engine.js';

const fileInput = document.getElementById('file-input') as HTMLInputElement;
const video = document.getElementById('video') as HTMLVideoElement;
const status = document.getElementById('status') as HTMLElement;
const dropOverlay = document.getElementById('drop-overlay') as HTMLElement;

const engine = new PlaysVideoEngine(video);

function loadFile(file: File): void {
  engine.loadFile(file);
}

// File input
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) loadFile(file);
});

// Drag-and-drop
let dragCounter = 0;

document.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragCounter++;
  dropOverlay.classList.add('active');
});

document.addEventListener('dragleave', () => {
  dragCounter--;
  if (dragCounter === 0) dropOverlay.classList.remove('active');
});

document.addEventListener('dragover', (e) => {
  e.preventDefault();
});

document.addEventListener('drop', (e) => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('active');
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

// File Handling API (Chrome OS file handler)
if ('launchQueue' in window) {
  (window as any).launchQueue.setConsumer(async (launchParams: any) => {
    if (!launchParams.files?.length) return;
    const handle = launchParams.files[0];
    const file = await handle.getFile();
    loadFile(file);
  });
}

// Engine events
engine.addEventListener('loading', (e) => {
  status.textContent = `Opening ${e.detail.file?.name ?? e.detail.url ?? ''}...`;
  video.style.display = 'none';
});

engine.addEventListener('ready', (e) => {
  status.textContent = `Ready — ${e.detail.totalSegments} segments, ${formatTime(e.detail.durationSec)}`;
  video.style.display = 'block';
});

engine.addEventListener('error', (e) => {
  status.textContent = `Error: ${e.detail.message}`;
});

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
