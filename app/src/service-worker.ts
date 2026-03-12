const APP_SERVICE_WORKER_SCOPE = '/app/';
const APP_SERVICE_WORKER_URL = import.meta.env.DEV ? '/app/sw-dev.js' : '/app/sw.js';
const SERVICE_WORKER_ACTIVATION_TIMEOUT_MS = 15_000;

let appServiceWorkerRegistrationPromise: Promise<ServiceWorkerRegistration> | null = null;

export function registerAppServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    return Promise.reject(new Error('Service workers are unavailable in this browser'));
  }

  if (!appServiceWorkerRegistrationPromise) {
    appServiceWorkerRegistrationPromise = navigator.serviceWorker.register(APP_SERVICE_WORKER_URL, {
      scope: APP_SERVICE_WORKER_SCOPE,
      type: 'module',
    });
  }

  return appServiceWorkerRegistrationPromise;
}

export async function getActiveAppServiceWorker(): Promise<ServiceWorker> {
  const registration = await registerAppServiceWorker();
  if (registration.active?.state === 'activated') {
    return registration.active;
  }

  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) {
    throw new Error('Metadata service worker is not available');
  }

  return await waitForActivatedWorker(registration, worker);
}

function waitForActivatedWorker(
  registration: ServiceWorkerRegistration,
  initialWorker: ServiceWorker,
): Promise<ServiceWorker> {
  return new Promise<ServiceWorker>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Metadata service worker activation timed out'));
    }, SERVICE_WORKER_ACTIVATION_TIMEOUT_MS);

    const onStateChange = () => {
      const activeWorker = registration.active;
      if (activeWorker?.state === 'activated') {
        cleanup();
        resolve(activeWorker);
        return;
      }

      if (initialWorker.state === 'redundant') {
        cleanup();
        reject(new Error('Metadata service worker became redundant'));
      }
    };

    const cleanup = () => {
      window.clearTimeout(timeout);
      initialWorker.removeEventListener('statechange', onStateChange);
    };

    initialWorker.addEventListener('statechange', onStateChange);
    onStateChange();
  });
}
