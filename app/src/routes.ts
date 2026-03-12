import { createBrowserRouter } from 'react-router-dom';
import { App } from './App';
import { Library } from './pages/Library';
import { Player } from './pages/Player';
import { FilePlayer } from './pages/FilePlayer';
import { MediaBrowser, MoviesBrowser, ShowsBrowser } from './pages/MediaBrowser';
import { TvShow } from './pages/TvShow';
import { Movie } from './pages/Movie';

export const router = createBrowserRouter(
  [
    {
      path: '/',
      Component: App,
      children: [
        { index: true, Component: Library },
        { path: 'media', Component: MediaBrowser },
        { path: 'shows', Component: ShowsBrowser },
        { path: 'movies', Component: MoviesBrowser },
        { path: 'tv/:showId', Component: TvShow },
        { path: 'movie/:movieId', Component: Movie },
        { path: 'play/:id', Component: Player },
        { path: 'play-file', Component: FilePlayer },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') },
);
