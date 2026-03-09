import { describe, expect, it } from 'vitest';
import {
  evaluatePlaybackOptions,
  recommendPlaybackOption,
  type PipelinePlaybackProbe,
} from '../../src/playback-selection.js';

const ALL_SUPPORTED_PROBE: PipelinePlaybackProbe = {
  canPlayAudio: () => true,
  canPlayVideo: () => true,
};

describe('playback-selection', () => {
  it('prefers direct playback when both direct and hls are supported', () => {
    const result = evaluatePlaybackOptions({
      options: [
        { mode: 'hls', id: 'hls' },
        { mode: 'direct-bytes', id: 'direct', mimeType: 'video/mp4' },
      ],
      media: {
        sourceVideoCodec: 'avc',
        sourceAudioCodec: 'aac',
        videoCodec: 'avc1.640028',
        audioCodec: 'mp4a.40.2',
      },
      capabilities: {
        canPlayType: () => 'probably',
        hlsSupported: true,
        pipelineProbe: ALL_SUPPORTED_PROBE,
      },
    });

    expect(result.recommended?.option).toEqual({
      mode: 'direct-bytes',
      id: 'direct',
      mimeType: 'video/mp4',
    });
    expect(result.evaluations.find((e) => e.option.id === 'direct')?.selected).toBe(true);
    expect(result.evaluations.find((e) => e.option.id === 'hls')?.selected).toBe(false);
  });

  it('recommends hls when direct playback is unsupported', () => {
    const result = evaluatePlaybackOptions({
      options: [
        { mode: 'direct-url', id: 'direct', mimeType: 'video/x-matroska' },
        { mode: 'hls', id: 'hls' },
      ],
      media: {
        sourceVideoCodec: 'avc',
        sourceAudioCodec: 'aac',
        videoCodec: 'avc1.640028',
        audioCodec: 'mp4a.40.2',
      },
      capabilities: {
        canPlayType: () => '',
        hlsSupported: true,
        pipelineProbe: ALL_SUPPORTED_PROBE,
      },
    });

    expect(result.recommended?.option).toEqual({ mode: 'hls', id: 'hls' });
    expect(result.evaluations.find((e) => e.option.id === 'direct')?.status).toBe('blocked');
    expect(result.evaluations.find((e) => e.option.id === 'hls')?.selected).toBe(true);
  });

  it('keeps hls viable when audio needs transcode', () => {
    const result = evaluatePlaybackOptions({
      options: [{ mode: 'hls', id: 'hls' }],
      media: {
        sourceVideoCodec: 'avc',
        sourceAudioCodec: 'ac3',
        videoCodec: 'avc1.640028',
        audioCodec: 'ac-3',
      },
      capabilities: {
        hlsSupported: true,
        pipelineProbe: {
          canPlayVideo: () => true,
          canPlayAudio: () => false,
        },
      },
    });

    expect(result.recommended?.option).toEqual({ mode: 'hls', id: 'hls' });
    expect(result.evaluations[0].status).toBe('supported');
    expect(result.evaluations[0].pipelineAudioRequiresTranscode).toBe(true);
    expect(result.evaluations[0].diagnostics.map((d) => d.code)).toContain('hls-audio-transcode');
  });

  it('blocks hls when remuxed video is unsupported', () => {
    const result = evaluatePlaybackOptions({
      options: [{ mode: 'hls', id: 'hls' }],
      media: {
        sourceVideoCodec: 'vp9',
        sourceAudioCodec: 'aac',
        videoCodec: 'vp09.00.10.08',
        audioCodec: 'mp4a.40.2',
      },
      capabilities: {
        hlsSupported: true,
        pipelineProbe: {
          canPlayVideo: () => false,
          canPlayAudio: () => true,
        },
      },
    });

    expect(result.recommended).toBeNull();
    expect(result.evaluations[0].status).toBe('blocked');
    expect(result.evaluations[0].diagnostics.map((d) => d.code)).toContain('hls-video-unsupported');
  });

  it('returns unknown when required metadata or capabilities are missing', () => {
    const result = evaluatePlaybackOptions({
      options: [
        { mode: 'direct-bytes', id: 'direct', mimeType: null },
        { mode: 'hls', id: 'hls' },
      ],
      media: {
        sourceVideoCodec: null,
        sourceAudioCodec: null,
        videoCodec: null,
        audioCodec: null,
      },
      capabilities: {},
    });

    expect(result.recommended).toBeNull();
    expect(result.evaluations.map((e) => e.status)).toEqual(['unknown', 'unknown']);
  });

  it('exposes a convenience recommendation helper', () => {
    const recommendation = recommendPlaybackOption({
      options: [{ mode: 'hls', id: 'hls' }],
      media: {
        sourceVideoCodec: 'avc',
        sourceAudioCodec: null,
        videoCodec: 'avc1.640028',
        audioCodec: null,
      },
      capabilities: {
        hlsSupported: true,
        pipelineProbe: ALL_SUPPORTED_PROBE,
      },
    });

    expect(recommendation?.option).toEqual({ mode: 'hls', id: 'hls' });
  });
});
