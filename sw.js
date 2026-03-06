const CACHE_NAME = 'playsvideo-shell-v1';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Handle share target POST (Android share sheet)
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // Only handle GET requests for same-origin resources
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // Cache-first for shell resources
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

async function handleShareTarget(request) {
  const formData = await request.formData();
  const videoFile = formData.get('video');

  if (videoFile) {
    // Stash the shared file so the client page can pick it up
    const cache = await caches.open('playsvideo-shared');
    await cache.put('/shared-video-file', new Response(videoFile));
  }

  return Response.redirect('/?source=share', 303);
}
