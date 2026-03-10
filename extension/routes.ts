import { createHashRouter } from 'react-router-dom';
import { App } from '../app/src/App';
import { Library } from '../app/src/pages/Library';
import { Player } from '../app/src/pages/Player';
import { FilePlayer } from '../app/src/pages/FilePlayer';

export const router = createHashRouter([
  {
    path: '/',
    Component: App,
    children: [
      { index: true, Component: Library },
      { path: 'play/:id', Component: Player },
      { path: 'play-file', Component: FilePlayer },
    ],
  },
]);
