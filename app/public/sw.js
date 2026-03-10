const WASM_CACHE = 'playsvideo-wasm-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== WASM_CACHE).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

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
