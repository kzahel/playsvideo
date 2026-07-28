import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { setAppContext } from '../app/src/context';
import { ensureDeviceId } from '../app/src/device.js';
import {
  getStoredThemePreference,
  getSystemPrefersDark,
  resolveThemePreference,
} from '../app/src/settings.js';
import { router } from './routes';
import 'video.js/dist/video-js.css';
import '../app/src/app.css';

setAppContext('extension');

document.documentElement.setAttribute(
  'data-theme',
  resolveThemePreference(getStoredThemePreference(), getSystemPrefersDark()),
);

void ensureDeviceId();

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />,
);
