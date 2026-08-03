import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PlaybackVideo } from '../../app/src/components/PlaybackVideo.js';

describe('PlaybackVideo', () => {
  it.each([
    'stock',
    'videojs',
  ] as const)('renders exactly one media element with %s controls', (controlsType) => {
    const html = renderToStaticMarkup(
      createElement(PlaybackVideo, {
        controlsType,
        onVideoElementChange: vi.fn(),
      }),
    );

    expect(html.match(/<video/g)).toHaveLength(1);
  });

  it('uses native controls only in stock mode', () => {
    const nativeHtml = renderToStaticMarkup(
      createElement(PlaybackVideo, {
        controlsType: 'stock',
        onVideoElementChange: vi.fn(),
      }),
    );
    const videoJsHtml = renderToStaticMarkup(
      createElement(PlaybackVideo, {
        controlsType: 'videojs',
        onVideoElementChange: vi.fn(),
      }),
    );

    expect(nativeHtml).toContain('controls=""');
    expect(videoJsHtml).not.toContain('controls=""');
    expect(videoJsHtml).toContain('pv-videojs10-player');
  });
});
