import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: false,
      workbox: { globPatterns: ['**/*.{js,css,html,svg,webmanifest}'] },
    }),
  ],
});
