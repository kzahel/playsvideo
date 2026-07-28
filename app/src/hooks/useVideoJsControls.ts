import { useEffect, useRef, type MutableRefObject } from 'react';
import videojsImport from 'video.js';
import {
  VIDEOJS_CONTROLS_ENABLED,
  type PlayerControlsType,
} from '../settings.js';

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
  dispose(): void;
  el(): HTMLElement;
  isDisposed(): boolean;
  responsive(enabled: boolean): boolean | undefined;
}

type VideoJsFactory = (element: HTMLVideoElement, options: typeof VIDEOJS_OPTIONS) => VideoJsPlayer;

const videojs = videojsImport as unknown as VideoJsFactory;

function disposeVideoJsPlayer(
  playerRef: MutableRefObject<VideoJsPlayer | null>,
  playerElementRef: MutableRefObject<HTMLVideoElement | null>,
) {
  const player = playerRef.current;
  if (player && !player.isDisposed()) {
    player.dispose();
  }
  playerRef.current = null;
  playerElementRef.current = null;
}

function sizePlayer(player: VideoJsPlayer) {
  const playerEl = player.el();
  playerEl.style.width = '100%';
  playerEl.style.height = 'auto';
  playerEl.style.aspectRatio = '16 / 9';
  const techEl = playerEl.querySelector<HTMLElement>('.vjs-tech');
  if (techEl) {
    techEl.style.objectFit = 'contain';
  }
}

export function useVideoJsControls(
  videoElement: HTMLVideoElement | null,
  controlsType: PlayerControlsType,
) {
  const playerRef = useRef<VideoJsPlayer | null>(null);
  const playerElementRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoElement;
    if (!video) {
      disposeVideoJsPlayer(playerRef, playerElementRef);
      return;
    }

    if (playerElementRef.current && playerElementRef.current !== video) {
      disposeVideoJsPlayer(playerRef, playerElementRef);
    }

    if (VIDEOJS_CONTROLS_ENABLED && controlsType === 'videojs') {
      if (!video.isConnected) return;

      video.controls = false;
      video.classList.add('video-js', 'vjs-big-play-centered');

      const player =
        playerRef.current && !playerRef.current.isDisposed()
          ? playerRef.current
          : videojs(video, VIDEOJS_OPTIONS);
      playerRef.current = player;
      playerElementRef.current = video;
      sizePlayer(player);
      player.controls(true);
      player.responsive(true);
      return () => {
        disposeVideoJsPlayer(playerRef, playerElementRef);
      };
    }

    disposeVideoJsPlayer(playerRef, playerElementRef);
    video.controls = true;
  }, [controlsType, videoElement]);
}
