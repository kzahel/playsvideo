import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MagnetLink } from '../../app/src/components/MagnetLink.js';

describe('MagnetLink', () => {
  it('renders one native magnet anchor with an accessible label and icon', () => {
    const markup = renderToStaticMarkup(
      createElement(MagnetLink, {
        href: 'magnet:?xt=urn:btih:abc&so=4',
        className: 'handoff-action',
      }),
    );

    expect(markup).toContain('<a href="magnet:?xt=urn:btih:abc&amp;so=4"');
    expect(markup).toContain('title="Open magnet link"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('<span>Magnet link</span>');
    expect(markup).not.toContain('Copy magnet');
  });
});
