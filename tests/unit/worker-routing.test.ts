import { describe, expect, it, vi } from 'vitest';
import worker from '../../worker/index.js';

function createAssets() {
  return {
    fetch: vi.fn(async (request: Request) => new Response(new URL(request.url).pathname)),
  };
}

describe('site Worker routing', () => {
  it.each([
    ['/', '/index.html'],
    ['/player', '/player.html'],
    ['/player/', '/player.html'],
    ['/debug', '/debug.html'],
    ['/debug/', '/debug.html'],
  ])('maps %s to %s', async (path, expected) => {
    const assets = createAssets();
    const response = await worker.fetch(new Request(`https://playsvideo.com${path}`), {
      ASSETS: assets,
    });

    expect(await response.text()).toBe(expected);
  });

  it('serves the app shell for SPA routes while retaining the query string', async () => {
    const assets = createAssets();
    await worker.fetch(new Request('https://playsvideo.com/app/activity?device=laptop'), {
      ASSETS: assets,
    });

    const request = assets.fetch.mock.calls[0][0];
    expect(new URL(request.url).pathname).toBe('/app/index.html');
    expect(new URL(request.url).search).toBe('?device=laptop');
  });

  it('passes unrelated missing paths through to the asset service', async () => {
    const assets = createAssets();
    const request = new Request('https://playsvideo.com/missing.txt');
    await worker.fetch(request, { ASSETS: assets });

    expect(assets.fetch).toHaveBeenCalledWith(request);
  });
});
