import { createBrowserRouter } from 'react-router-dom';
import { App } from './App';
import { Library } from './pages/Library';
import { Player } from './pages/Player';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      Component: App,
      children: [
        { index: true, Component: Library },
        { path: 'play/:id', Component: Player },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') },
);
