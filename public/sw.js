const WASM_CACHE = 'playsvideo-wasm-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== WASM_CACHE && k !== 'playsvideo-shared').map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle share target POST (Android share sheet)
  if (url.pathname === '/player/share-target' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Only handle GET requests for same-origin resources
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Cache-first only for .wasm files; everything else goes to network
  if (url.pathname.endsWith('.wasm')) {
    event.respondWith(
      caches.open(WASM_CACHE).then((cache) =>
        cache.match(event.request).then((cached) =>
          cached || fetch(event.request).then((resp) => {
            cache.put(event.request, resp.clone());
            return resp;
          })
        )
      )
    );
  }
});

async function handleShareTarget(request) {
  const formData = await request.formData();
  const videoFile = formData.get('video');

  if (videoFile) {
    // Stash the shared file so the client page can pick it up
    const cache = await caches.open('playsvideo-shared');
    await cache.put('/shared-video-file', new Response(videoFile));
  }

  return Response.redirect('/player?source=share', 303);
}
