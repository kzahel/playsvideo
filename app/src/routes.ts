import { createBrowserRouter } from 'react-router-dom';
import { App } from './App';
import { Catalog } from './pages/Catalog';
import { Player } from './pages/Player';
import { FilePlayer } from './pages/FilePlayer';
import { MediaBrowser, MoviesBrowser, ShowsBrowser } from './pages/MediaBrowser';
import { TvShow } from './pages/TvShow';
import { Movie } from './pages/Movie';
import { Settings } from './pages/Settings';
import { Devices } from './pages/Devices';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      Component: App,
      children: [
        { index: true, Component: Catalog },
        { path: 'media', Component: MediaBrowser },
        { path: 'shows', Component: ShowsBrowser },
        { path: 'movies', Component: MoviesBrowser },
        { path: 'tv/:showId', Component: TvShow },
        { path: 'movie/:movieId', Component: Movie },
        { path: 'settings', Component: Settings },
        { path: 'devices', Component: Devices },
        { path: 'play/:id', Component: Player },
        { path: 'play-file', Component: FilePlayer },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/+$/, '') },
);
