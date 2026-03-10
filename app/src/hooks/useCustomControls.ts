import type { RefObject } from 'react';
import { useEffect } from 'react';
import { createCustomControls } from '../../../src/custom-controls.js';

export function useCustomControls(
  videoRef: RefObject<HTMLVideoElement | null>,
  containerRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled || !videoRef.current || !containerRef.current) return;
    const handle = createCustomControls({
      video: videoRef.current,
      container: containerRef.current,
    });
    return () => handle.destroy();
  }, [enabled, videoRef, containerRef]);
}
