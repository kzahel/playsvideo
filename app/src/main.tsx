import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes';
import './app.css';

const serviceWorkerUrl = import.meta.env.DEV ? '/app/sw-dev.js' : '/app/sw.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(serviceWorkerUrl, { type: 'module' });
}
