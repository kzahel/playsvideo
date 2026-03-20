import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  clearScreen: false,
  logLevel: 'error',
  build: {
    outDir: 'dist-site',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        player: resolve(__dirname, 'player.html'),
        debug: resolve(__dirname, 'debug.html'),
      },
    },
  },
  server: {
    port: 4200,
    host: '0.0.0.0',
    allowedHosts: ['playsvideo.graehlarts.com', 'local.playsvideo.com'],
  },
  appType: 'mpa',
  plugins: [
    {
      name: 'clean-urls',
      configureServer(server) {
        const { port, host } = server.config.server;
        server.httpServer?.once('listening', () => {
          console.log(`http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`);
        });
        server.middlewares.use((req, _res, next) => {
          if (req.url === '/player' || req.url === '/player/') {
            req.url = '/player.html';
          } else if (req.url === '/debug' || req.url === '/debug/') {
            req.url = '/debug.html';
          }
          next();
        });
      },
    },
  ],
});
