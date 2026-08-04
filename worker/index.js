export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      url.pathname = '/index.html';
    } else if (url.pathname === '/player' || url.pathname === '/player/') {
      url.pathname = '/player.html';
    } else if (url.pathname === '/debug' || url.pathname === '/debug/') {
      url.pathname = '/debug.html';
    } else if (url.pathname === '/app' || url.pathname.startsWith('/app/')) {
      // Exact static assets are served before the Worker. Reaching this branch
      // means the requested app path did not match an asset, so serve the SPA.
      url.pathname = '/app/index.html';
    } else {
      return env.ASSETS.fetch(request);
    }

    return env.ASSETS.fetch(new Request(url, request));
  },
};
