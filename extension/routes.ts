import { createHashRouter } from 'react-router-dom';
import { App } from '../app/src/App';
import { Catalog } from '../app/src/pages/Catalog';
import { Activity } from '../app/src/pages/Activity';
import { Devices } from '../app/src/pages/Devices';
import { FilePlayer } from '../app/src/pages/FilePlayer';
import { MediaBrowser, MoviesBrowser, ShowsBrowser } from '../app/src/pages/MediaBrowser';
import { Movie } from '../app/src/pages/Movie';
import { Player } from '../app/src/pages/Player';
import { Settings } from '../app/src/pages/Settings';
import { TvShow } from '../app/src/pages/TvShow';

export const router = createHashRouter([
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
      { path: 'activity', Component: Activity },
      { path: 'play/:id', Component: Player },
      { path: 'play-file', Component: FilePlayer },
    ],
  },
]);
