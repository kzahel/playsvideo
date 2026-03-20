import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './routes';
import { registerAppServiceWorker } from './service-worker.js';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />,
);

if ('serviceWorker' in navigator) {
  void registerAppServiceWorker();
}
