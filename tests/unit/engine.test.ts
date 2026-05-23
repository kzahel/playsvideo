import { describe, expect, it, vi } from 'vitest';
import { PlaysVideoEngine } from '../../src/engine.js';

describe('PlaysVideoEngine', () => {
  it('clears the media element on destroy', () => {
    const video = {
      pause: vi.fn(),
      removeAttribute: vi.fn(),
      srcObject: {},
      load: vi.fn(),
    } as unknown as HTMLVideoElement;

    const engine = new PlaysVideoEngine(video, { transcodeWorkers: 0 });
    engine.destroy();

    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.removeAttribute).toHaveBeenCalledWith('src');
    expect(video.srcObject).toBeNull();
    expect(video.load).toHaveBeenCalledOnce();
  });
});
