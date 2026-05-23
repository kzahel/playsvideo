import { useLayoutEffect, useState } from 'react';
import type { PlayerControlsType } from '../settings.js';

let videoElementId = 0;

function pauseHostedVideos(hostElement: HTMLDivElement): void {
  // Video.js wraps the tech video; pause it before replacing the wrapper.
  for (const video of hostElement.querySelectorAll('video')) {
    video.pause();
  }
}

export function usePlaybackVideoElement(controlsType: PlayerControlsType) {
  const [hostElement, setHostElement] = useState<HTMLDivElement | null>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

  useLayoutEffect(() => {
    if (!hostElement) {
      setVideoElement(null);
      return;
    }

    pauseHostedVideos(hostElement);
    const video = document.createElement('video');
    video.id = `pv-${controlsType}-video-${++videoElementId}`;
    video.autoplay = true;
    video.controls = controlsType === 'stock';
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    hostElement.replaceChildren(video);
    setVideoElement(video);

    return () => {
      pauseHostedVideos(hostElement);
      setVideoElement(null);
    };
  }, [controlsType, hostElement]);

  return {
    setVideoHostElement: setHostElement,
    videoElement,
  };
}
