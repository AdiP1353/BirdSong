import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
export default defineConfig({
  base: './',
  plugins: [preact()],
  server: {
    proxy: {
      '/ui': { target: 'ws://localhost:7070', ws: true },
      '/config.json': 'http://localhost:7070',
    },
  },
});
