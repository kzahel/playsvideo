export interface CustomControlsOptions {
  video: HTMLVideoElement;
  container: HTMLElement;
}

export interface CustomControlsHandle {
  destroy(): void;
}

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

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
  flex-shrink: 0;
}
.pv-controls button:hover { opacity: 0.8; }
.pv-controls-seek {
  flex: 1;
  min-width: 40px;
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
.pv-controls-speed {
  font-size: 0.75rem;
  font-weight: 600;
  min-width: 2.2em;
  text-align: center;
}
.pv-cc-active { color: var(--accent, #3b82f6) !important; }
.pv-popup-anchor { position: relative; }
.pv-popup {
  position: absolute;
  bottom: 100%;
  right: 50%;
  transform: translateX(50%);
  background: rgba(0,0,0,0.9);
  border-radius: 6px;
  padding: 0.25rem 0;
  min-width: 140px;
  margin-bottom: 0.75rem;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
  z-index: 20;
}
.pv-popup-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  color: #fff;
  cursor: pointer;
  font-size: 0.85rem;
  white-space: nowrap;
  border: none;
  background: none;
  width: 100%;
  text-align: left;
}
.pv-popup-item:hover { background: rgba(255,255,255,0.15); }
.pv-popup-item.pv-active { color: var(--accent, #3b82f6); }
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

function makeButton(label: string, text: string, className?: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.setAttribute('aria-label', label);
  if (className) btn.className = className;
  return btn;
}

export function createCustomControls(options: CustomControlsOptions): CustomControlsHandle {
  const { video, container } = options;
  injectStyles();

  const controls = document.createElement('div');
  controls.className = 'pv-controls';

  // Buttons
  const playBtn = makeButton('Play/Pause', '\u25B6');
  const skipBackBtn = makeButton('Skip back 10s', '\u23EA');
  const skipFwdBtn = makeButton('Skip forward 10s', '\u23E9');

  const seekBar = document.createElement('input');
  seekBar.type = 'range';
  seekBar.className = 'pv-controls-seek';
  seekBar.min = '0';
  seekBar.max = '0';
  seekBar.step = '0.1';
  seekBar.value = '0';

  const timeDisplay = document.createElement('span');
  timeDisplay.className = 'pv-controls-time';
  timeDisplay.textContent = '0:00 / 0:00';

  // CC button + popup anchor
  const ccAnchor = document.createElement('span');
  ccAnchor.className = 'pv-popup-anchor';
  const ccBtn = makeButton('Subtitles', 'CC');
  ccBtn.style.fontSize = '0.85rem';
  ccBtn.style.fontWeight = '700';
  ccAnchor.appendChild(ccBtn);

  // Speed button + popup anchor
  const speedAnchor = document.createElement('span');
  speedAnchor.className = 'pv-popup-anchor';
  const speedBtn = makeButton('Playback speed', '1x', 'pv-controls-speed');
  speedAnchor.appendChild(speedBtn);

  // PiP button
  const pipBtn = makeButton('Picture in Picture', '\u{1F5BC}');
  const pipSupported = document.pictureInPictureEnabled;
  if (!pipSupported) pipBtn.style.display = 'none';

  const volumeBtn = makeButton('Mute/Unmute', '\uD83D\uDD0A');

  const volumeBar = document.createElement('input');
  volumeBar.type = 'range';
  volumeBar.className = 'pv-controls-volume';
  volumeBar.min = '0';
  volumeBar.max = '1';
  volumeBar.step = '0.01';
  volumeBar.value = String(video.volume);

  const fsBtn = makeButton('Fullscreen', '\u26F6');

  controls.append(
    playBtn,
    skipBackBtn,
    skipFwdBtn,
    seekBar,
    timeDisplay,
    ccAnchor,
    speedAnchor,
    pipBtn,
    volumeBtn,
    volumeBar,
    fsBtn,
  );
  container.appendChild(controls);

  // State
  let seeking = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let activePopup: HTMLElement | null = null;

  // --- Popup helpers ---
  function closePopup() {
    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }
  }

  function togglePopup(anchor: HTMLElement, buildItems: () => HTMLElement[]) {
    if (activePopup?.parentElement === anchor) {
      closePopup();
      return;
    }
    closePopup();
    const popup = document.createElement('div');
    popup.className = 'pv-popup';
    for (const item of buildItems()) popup.appendChild(item);
    anchor.appendChild(popup);
    activePopup = popup;
  }

  function popupItem(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
    const item = document.createElement('button');
    item.className = `pv-popup-item${active ? ' pv-active' : ''}`;
    item.textContent = `${active ? '\u2713 ' : '  '}${label}`;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
      closePopup();
    });
    return item;
  }

  // --- Auto-hide ---
  function resetHideTimer() {
    controls.classList.remove('pv-hidden');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!video.paused && !activePopup) controls.classList.add('pv-hidden');
    }, 3000);
  }

  // --- Update functions ---
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

  function updateSpeedBtn() {
    const rate = video.playbackRate;
    speedBtn.textContent = rate === 1 ? '1x' : `${rate}x`;
  }

  function updateCcBtn() {
    let hasShowing = false;
    let hasTracks = false;
    for (let i = 0; i < video.textTracks.length; i++) {
      hasTracks = true;
      if (video.textTracks[i].mode === 'showing') hasShowing = true;
    }
    ccBtn.style.display = hasTracks ? '' : 'none';
    if (hasShowing) {
      ccBtn.classList.add('pv-cc-active');
    } else {
      ccBtn.classList.remove('pv-cc-active');
    }
  }

  function updatePipBtn() {
    if (!pipSupported) return;
    pipBtn.textContent = document.pictureInPictureElement === video ? '\u2716' : '\u{1F5BC}';
  }

  // --- Video event listeners ---
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
  const onRateChange = () => updateSpeedBtn();

  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('durationchange', onDurationChange);
  video.addEventListener('loadedmetadata', onDurationChange);
  video.addEventListener('volumechange', onVolumeChange);
  video.addEventListener('ratechange', onRateChange);

  // Text track changes
  const onTrackChange = () => updateCcBtn();
  video.textTracks.addEventListener('addtrack', onTrackChange);
  video.textTracks.addEventListener('removetrack', onTrackChange);
  video.textTracks.addEventListener('change', onTrackChange);

  // PiP events
  const onEnterPip = () => updatePipBtn();
  const onLeavePip = () => updatePipBtn();
  video.addEventListener('enterpictureinpicture', onEnterPip);
  video.addEventListener('leavepictureinpicture', onLeavePip);

  // --- Button handlers ---

  // Play/pause
  const onPlayClick = () => {
    if (video.paused) video.play();
    else video.pause();
  };
  playBtn.addEventListener('click', onPlayClick);

  // Click on video toggles play/pause
  const onVideoClick = (e: MouseEvent) => {
    if (activePopup) {
      closePopup();
      return;
    }
    if (e.target === video) {
      if (video.paused) video.play();
      else video.pause();
    }
  };
  container.addEventListener('click', onVideoClick);

  // Skip
  const onSkipBack = () => {
    video.currentTime = Math.max(0, video.currentTime - 10);
  };
  const onSkipFwd = () => {
    video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
  };
  skipBackBtn.addEventListener('click', onSkipBack);
  skipFwdBtn.addEventListener('click', onSkipFwd);

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

  // CC popup
  const onCcClick = (e: MouseEvent) => {
    e.stopPropagation();
    resetHideTimer();
    togglePopup(ccAnchor, () => {
      const items: HTMLButtonElement[] = [];
      // "Off" option
      let anyShowing = false;
      for (let i = 0; i < video.textTracks.length; i++) {
        if (video.textTracks[i].mode === 'showing') anyShowing = true;
      }
      items.push(
        popupItem('Off', !anyShowing, () => {
          for (let i = 0; i < video.textTracks.length; i++) {
            video.textTracks[i].mode = 'disabled';
          }
          updateCcBtn();
        }),
      );
      // Track options
      for (let i = 0; i < video.textTracks.length; i++) {
        const track = video.textTracks[i];
        const label = track.label || track.language || `Track ${i + 1}`;
        items.push(
          popupItem(label, track.mode === 'showing', () => {
            for (let j = 0; j < video.textTracks.length; j++) {
              video.textTracks[j].mode = 'disabled';
            }
            track.mode = 'showing';
            updateCcBtn();
          }),
        );
      }
      return items;
    });
  };
  ccBtn.addEventListener('click', onCcClick);

  // Speed popup
  const onSpeedClick = (e: MouseEvent) => {
    e.stopPropagation();
    resetHideTimer();
    togglePopup(speedAnchor, () =>
      SPEED_OPTIONS.map((rate) =>
        popupItem(`${rate}x`, video.playbackRate === rate, () => {
          video.playbackRate = rate;
        }),
      ),
    );
  };
  speedBtn.addEventListener('click', onSpeedClick);

  // PiP
  const onPipClick = async () => {
    if (document.pictureInPictureElement === video) {
      await document.exitPictureInPicture();
    } else {
      await video.requestPictureInPicture();
    }
  };
  pipBtn.addEventListener('click', onPipClick);

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
  updateSpeedBtn();
  updateCcBtn();
  updatePipBtn();
  resetHideTimer();

  return {
    destroy() {
      clearTimeout(hideTimer);
      closePopup();
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('loadedmetadata', onDurationChange);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('ratechange', onRateChange);
      video.removeEventListener('enterpictureinpicture', onEnterPip);
      video.removeEventListener('leavepictureinpicture', onLeavePip);
      video.textTracks.removeEventListener('addtrack', onTrackChange);
      video.textTracks.removeEventListener('removetrack', onTrackChange);
      video.textTracks.removeEventListener('change', onTrackChange);
      playBtn.removeEventListener('click', onPlayClick);
      container.removeEventListener('click', onVideoClick);
      skipBackBtn.removeEventListener('click', onSkipBack);
      skipFwdBtn.removeEventListener('click', onSkipFwd);
      seekBar.removeEventListener('input', onSeekInput);
      seekBar.removeEventListener('change', onSeekChange);
      volumeBtn.removeEventListener('click', onVolumeBtnClick);
      volumeBar.removeEventListener('input', onVolumeInput);
      ccBtn.removeEventListener('click', onCcClick);
      speedBtn.removeEventListener('click', onSpeedClick);
      pipBtn.removeEventListener('click', onPipClick);
      fsBtn.removeEventListener('click', onFsClick);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      container.removeEventListener('mousemove', onActivity);
      container.removeEventListener('touchstart', onActivity);
      controls.remove();
    },
  };
}
