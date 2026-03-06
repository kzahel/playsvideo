export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let key = url.pathname.slice(1);

    if (key === '' || key === '/') {
      key = 'index.html';
    } else if (key === 'player' || key === 'player/') {
      key = 'player.html';
    } else if (key === 'debug' || key === 'debug/') {
      key = 'debug.html';
    }

    const object = await env.BUCKET.get(key);
    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp');

    // HTML, SW, manifest: always revalidate. Hashed assets: cache long-term.
    if (key.endsWith('.html') || key === 'sw.js' || key === 'manifest.json') {
      headers.set('Cache-Control', 'no-cache');
    } else if (key.startsWith('assets/')) {
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    }

    return new Response(object.body, { headers });
  },
};
