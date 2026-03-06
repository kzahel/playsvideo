import { PlaysVideoEngine } from './engine.js';

const fileInput = document.getElementById('file-input') as HTMLInputElement;
const video = document.getElementById('video') as HTMLVideoElement;
const status = document.getElementById('status') as HTMLElement;

const engine = new PlaysVideoEngine(video);

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) engine.loadFile(file);
});

engine.addEventListener('loading', (e) => {
  status.textContent = `Opening ${e.detail.file.name}...`;
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
