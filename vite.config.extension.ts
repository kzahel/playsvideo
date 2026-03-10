import { copyFileSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const outDir = resolve(__dirname, 'dist-extension');

export default defineConfig({
  clearScreen: false,
  logLevel: 'error',
  publicDir: false,
  resolve: {
    alias: {
      playsvideo: resolve(__dirname, 'src/index.ts'),
    },
  },
  plugins: [
    react(),
    {
      name: 'extension-assets',
      writeBundle() {
        // Vite nests HTML under extension/ — flatten it
        const nested = resolve(outDir, 'extension/index.html');
        const flat = resolve(outDir, 'index.html');
        try {
          renameSync(nested, flat);
          rmSync(resolve(outDir, 'extension'), { recursive: true });
        } catch {
          // already flat
        }

        // Copy manifest.json
        copyFileSync(
          resolve(__dirname, 'extension/manifest.json'),
          resolve(outDir, 'manifest.json'),
        );

        // Copy icons
        const iconsDir = resolve(outDir, 'icons');
        mkdirSync(iconsDir, { recursive: true });
        for (const size of ['16', '48', '128']) {
          copyFileSync(
            resolve(__dirname, `extension/icons/icon-${size}.png`),
            resolve(iconsDir, `icon-${size}.png`),
          );
        }
      },
    },
  ],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'extension/index.html'),
        background: resolve(__dirname, 'extension/background.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
