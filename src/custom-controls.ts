export interface CustomControlsOptions {
  video: HTMLVideoElement;
  container: HTMLElement;
}

export interface CustomControlsHandle {
  destroy(): void;
}

const CONTROLS_CSS = `
.pv-video-container { position: relative; }
.pv-video-container:fullscreen { background: #000; }
.pv-video-container:fullscreen video { width: 100%; height: 100%; object-fit: contain; }
.pv-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: linear-gradient(transparent, rgba(0,0,0,0.7));
  color: #fff;
  opacity: 1;
  transition: opacity 0.3s;
  z-index: 10;
}
.pv-controls.pv-hidden {
  opacity: 0;
  pointer-events: none;
}
.pv-controls button {
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  font-size: 1.2rem;
  padding: 0.25rem;
  line-height: 1;
}
.pv-controls button:hover { opacity: 0.8; }
.pv-controls-seek {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: rgba(255,255,255,0.3);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.pv-controls-seek::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  cursor: pointer;
}
.pv-controls-volume {
  width: 60px;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  background: rgba(255,255,255,0.3);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
.pv-controls-volume::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 10px;
  background: #fff;
  border-radius: 50%;
  cursor: pointer;
}
.pv-controls-time {
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
`;

let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  const style = document.createElement('style');
  style.textContent = CONTROLS_CSS;
  document.head.appendChild(style);
  styleInjected = true;
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function createCustomControls(options: CustomControlsOptions): CustomControlsHandle {
  const { video, container } = options;
  injectStyles();

  const controls = document.createElement('div');
  controls.className = 'pv-controls';

  const playBtn = document.createElement('button');
  playBtn.textContent = '\u25B6';
  playBtn.setAttribute('aria-label', 'Play/Pause');

  const timeDisplay = document.createElement('span');
  timeDisplay.className = 'pv-controls-time';
  timeDisplay.textContent = '0:00 / 0:00';

  const seekBar = document.createElement('input');
  seekBar.type = 'range';
  seekBar.className = 'pv-controls-seek';
  seekBar.min = '0';
  seekBar.max = '0';
  seekBar.step = '0.1';
  seekBar.value = '0';

  const volumeBtn = document.createElement('button');
  volumeBtn.textContent = '\uD83D\uDD0A';
  volumeBtn.setAttribute('aria-label', 'Mute/Unmute');

  const volumeBar = document.createElement('input');
  volumeBar.type = 'range';
  volumeBar.className = 'pv-controls-volume';
  volumeBar.min = '0';
  volumeBar.max = '1';
  volumeBar.step = '0.01';
  volumeBar.value = String(video.volume);

  const fsBtn = document.createElement('button');
  fsBtn.textContent = '\u26F6';
  fsBtn.setAttribute('aria-label', 'Fullscreen');

  controls.append(playBtn, seekBar, timeDisplay, volumeBtn, volumeBar, fsBtn);
  container.appendChild(controls);

  let seeking = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  function resetHideTimer() {
    controls.classList.remove('pv-hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!video.paused) controls.classList.add('pv-hidden');
    }, 3000);
  }

  function updatePlayBtn() {
    playBtn.textContent = video.paused ? '\u25B6' : '\u23F8';
  }

  function updateTime() {
    if (seeking) return;
    seekBar.value = String(video.currentTime);
    timeDisplay.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration || 0)}`;
  }

  function updateDuration() {
    seekBar.max = String(video.duration || 0);
    updateTime();
  }

  function updateVolume() {
    volumeBar.value = String(video.muted ? 0 : video.volume);
    volumeBtn.textContent = video.muted || video.volume === 0 ? '\uD83D\uDD07' : '\uD83D\uDD0A';
  }

  function updateFullscreenBtn() {
    fsBtn.textContent = document.fullscreenElement ? '\u2716' : '\u26F6';
  }

  // Video event listeners
  const onPlay = () => {
    updatePlayBtn();
    resetHideTimer();
  };
  const onPause = () => {
    updatePlayBtn();
    controls.classList.remove('pv-hidden');
    clearTimeout(hideTimer);
  };
  const onTimeUpdate = () => updateTime();
  const onDurationChange = () => updateDuration();
  const onVolumeChange = () => updateVolume();

  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('durationchange', onDurationChange);
  video.addEventListener('loadedmetadata', onDurationChange);
  video.addEventListener('volumechange', onVolumeChange);

  // Play/pause
  const onPlayClick = () => {
    if (video.paused) video.play();
    else video.pause();
  };
  playBtn.addEventListener('click', onPlayClick);

  // Click on video toggles play/pause
  const onVideoClick = (e: MouseEvent) => {
    if (e.target === video) {
      if (video.paused) video.play();
      else video.pause();
    }
  };
  container.addEventListener('click', onVideoClick);

  // Seek bar
  const onSeekInput = () => {
    seeking = true;
    video.currentTime = Number(seekBar.value);
    timeDisplay.textContent = `${formatTime(Number(seekBar.value))} / ${formatTime(video.duration || 0)}`;
  };
  const onSeekChange = () => {
    video.currentTime = Number(seekBar.value);
    seeking = false;
  };
  seekBar.addEventListener('input', onSeekInput);
  seekBar.addEventListener('change', onSeekChange);

  // Volume
  const onVolumeBtnClick = () => {
    video.muted = !video.muted;
  };
  const onVolumeInput = () => {
    video.volume = Number(volumeBar.value);
    if (Number(volumeBar.value) > 0) video.muted = false;
  };
  volumeBtn.addEventListener('click', onVolumeBtnClick);
  volumeBar.addEventListener('input', onVolumeInput);

  // Fullscreen
  const onFsClick = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  };
  fsBtn.addEventListener('click', onFsClick);

  const onFullscreenChange = () => updateFullscreenBtn();
  document.addEventListener('fullscreenchange', onFullscreenChange);

  // Auto-hide on mouse/touch activity
  const onActivity = () => resetHideTimer();
  container.addEventListener('mousemove', onActivity);
  container.addEventListener('touchstart', onActivity);

  // Init state
  updatePlayBtn();
  updateDuration();
  updateVolume();
  resetHideTimer();

  return {
    destroy() {
      clearTimeout(hideTimer);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('loadedmetadata', onDurationChange);
      video.removeEventListener('volumechange', onVolumeChange);
      playBtn.removeEventListener('click', onPlayClick);
      container.removeEventListener('click', onVideoClick);
      seekBar.removeEventListener('input', onSeekInput);
      seekBar.removeEventListener('change', onSeekChange);
      volumeBtn.removeEventListener('click', onVolumeBtnClick);
      volumeBar.removeEventListener('input', onVolumeInput);
      fsBtn.removeEventListener('click', onFsClick);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      container.removeEventListener('mousemove', onActivity);
      container.removeEventListener('touchstart', onActivity);
      controls.remove();
    },
  };
}
