/// <reference lib="webworker" />

import {
  handleMetadataRequest,
  isMetadataRequestEnvelope,
  toMetadataErrorResponse,
} from './metadata/protocol-handler.js';
import { registerEnvCredentialProvider } from './metadata/env-credential-provider.js';

declare const self: ServiceWorkerGlobalScope;

const WASM_CACHE = 'playsvideo-wasm-v1';

registerEnvCredentialProvider();

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== WASM_CACHE).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('.wasm')) {
    event.respondWith(
      caches.open(WASM_CACHE).then((cache) =>
        cache.match(event.request).then((cached) =>
          cached ||
          fetch(event.request).then((response) => {
            cache.put(event.request, response.clone());
            return response;
          }),
        ),
      ),
    );
  }
});

self.addEventListener('message', (event) => {
  if (!isMetadataRequestEnvelope(event.data)) {
    return;
  }

  const port = event.ports[0];
  if (!port) {
    return;
  }

  void handleMetadataRequest(event.data)
    .then((response) => port.postMessage(response))
    .catch((error) => port.postMessage(toMetadataErrorResponse(event.data.id, error)));
});
