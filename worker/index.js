export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let key = url.pathname.slice(1);

    if (key === '' || key === '/') {
      key = 'index.html';
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

    return new Response(object.body, { headers });
  },
};
