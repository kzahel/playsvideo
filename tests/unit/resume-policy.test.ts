import { describe, expect, it } from 'vitest';
import { evaluateResumePolicy } from '../../app/src/resume-policy.js';

describe('resume-policy', () => {
  it('recommends local playback when resumable', () => {
    const result = evaluateResumePolicy({
      local: {
        deviceId: 'local-device',
        playbackKey: 'movie:1',
        positionSec: 120,
        durationSec: 3600,
        watchState: 'in-progress',
        lastPlayedAt: 200,
      },
      remote: [
        {
          deviceId: 'tv',
          deviceLabel: 'Living Room TV',
          playbackKey: 'movie:1',
          positionSec: 180,
          durationSec: 3600,
          watchState: 'in-progress',
          lastPlayedAt: 300,
          title: 'Movie',
        },
      ],
    });

    expect(result.recommended?.source).toBe('local');
    expect(result.shouldStartOver).toBe(false);
    expect(result.suggestions).toHaveLength(2);
  });

  it('recommends the most recent remote option when local history is absent', () => {
    const result = evaluateResumePolicy({
      remote: [
        {
          deviceId: 'phone',
          deviceLabel: 'Phone',
          playbackKey: 'movie:1',
          positionSec: 90,
          durationSec: 3600,
          watchState: 'in-progress',
          lastPlayedAt: 100,
          title: 'Movie',
        },
        {
          deviceId: 'tv',
          deviceLabel: 'TV',
          playbackKey: 'movie:1',
          positionSec: 180,
          durationSec: 3600,
          watchState: 'in-progress',
          lastPlayedAt: 200,
          title: 'Movie',
        },
      ],
    });

    expect(result.recommended?.source).toBe('remote');
    expect(result.recommended?.deviceId).toBe('tv');
    expect(result.shouldStartOver).toBe(false);
  });

  it('starts over by default when the local item is already watched', () => {
    const result = evaluateResumePolicy({
      local: {
        deviceId: 'local-device',
        playbackKey: 'movie:1',
        positionSec: 3590,
        durationSec: 3600,
        watchState: 'watched',
        lastPlayedAt: 200,
      },
    });

    expect(result.recommended).toBeNull();
    expect(result.shouldStartOver).toBe(true);
    expect(result.suggestions).toHaveLength(1);
  });
});
