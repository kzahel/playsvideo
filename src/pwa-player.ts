import { PlaysVideoEngine } from './engine.js';

const fileInput = document.getElementById('file-input') as HTMLInputElement;
const video = document.getElementById('video') as HTMLVideoElement;
const status = document.getElementById('status') as HTMLElement;

const engine = new PlaysVideoEngine(video);

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/player' });
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) engine.loadFile(file);
});

// File Handling API (desktop Chrome/Edge — OS file association)
if ('launchQueue' in window) {
  (window as any).launchQueue.setConsumer(async (launchParams: any) => {
    if (!launchParams.files?.length) return;
    const handle = launchParams.files[0];
    const file = await handle.getFile();
    engine.loadFile(file);
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
    engine.loadFile(file);
    await cache.delete('/shared-video-file');
  }
  // Clean the URL
  history.replaceState(null, '', '/player');
}
handleShareTarget();

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
