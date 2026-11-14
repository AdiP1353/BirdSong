import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
export default defineConfig({
  base: './',
  plugins: [preact()],
  server: {
    proxy: {
      '/ui': { target: 'ws://localhost:3200', ws: true },
      '/config.json': 'http://localhost:3200',
      '/api': 'http://localhost:3200',
      '/app': 'http://localhost:3200',
    },
  },
});
