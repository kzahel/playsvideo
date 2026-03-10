import type { RefObject } from 'react';
import { useEffect } from 'react';
import { createCustomControls } from '../../../src/custom-controls.js';

export function useCustomControls(
  videoRef: RefObject<HTMLVideoElement | null>,
  container: HTMLElement | null,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled || !videoRef.current || !container) return;
    const handle = createCustomControls({
      video: videoRef.current,
      container,
    });
    return () => handle.destroy();
  }, [enabled, videoRef, container]);
}
