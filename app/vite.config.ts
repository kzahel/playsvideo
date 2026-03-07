import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/app/',
  plugins: [react()],
  resolve: {
    alias: {
      playsvideo: path.resolve(__dirname, '../src/index.ts'),
    },
  },
  server: {
    port: 4201,
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
});
