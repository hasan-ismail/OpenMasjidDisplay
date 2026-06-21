import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The control panel is served by the Node server, which also exposes /api and
// /ws. In dev (`npm run dev`) we proxy those to the server on :8080.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
