import { createPlayer } from '@videojs/react';
import { Video, VideoSkin, videoFeatures } from '@videojs/react/video';
import '@videojs/react/video/skin.css';
import { useCallback } from 'react';
import type { PlayerControlsType } from '../settings.js';

const VideoJsPlayer = createPlayer({
  displayName: 'PlaysVideoPlayer',
  features: videoFeatures,
});

interface PlaybackVideoProps {
  controlsType: PlayerControlsType;
  onVideoElementChange: (video: HTMLVideoElement | null) => void;
}

/**
 * Owns the session's only video element. The parent gives that exact element to
 * PlaysVideoEngine; Video.js provides state and controls without creating or
 * replacing a second playback element.
 */
export function PlaybackVideo({
  controlsType,
  onVideoElementChange,
}: PlaybackVideoProps) {
  const videoRef = useCallback(
    (video: HTMLVideoElement | null) => {
      onVideoElementChange(video);
      if (!video) return;

      return () => {
        // Stop audio immediately. The engine effect performs the full HLS,
        // worker, source URL, and media-element teardown for this same node.
        video.pause();
        onVideoElementChange(null);
      };
    },
    [onVideoElementChange],
  );

  if (controlsType === 'stock') {
    return <video ref={videoRef} autoPlay controls playsInline />;
  }

  return (
    <VideoJsPlayer.Provider>
      <VideoSkin className="pv-videojs10-player" aria-label="PlaysVideo player">
        <Video ref={videoRef} autoPlay playsInline />
      </VideoSkin>
    </VideoJsPlayer.Provider>
  );
}
