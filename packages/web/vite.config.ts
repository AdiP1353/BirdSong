import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  // `npm run dev` with a hub on 3200: speech to text asks the hub that served the page.
  server: { proxy: { '/config.json': 'http://localhost:3200', '/api': 'http://localhost:3200' } },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: { globPatterns: ['**/*.{js,css,html,svg,webmanifest}'] },
    }),
  ],
});
