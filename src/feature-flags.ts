/**
 * Video.js controls can leave a detached video playing after switching control
 * modes. Keep the implementation available for future investigation, but force
 * every player entry point to use native browser controls in the meantime.
 */
export const VIDEOJS_CONTROLS_ENABLED = false;
