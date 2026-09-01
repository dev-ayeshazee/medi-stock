import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev the browser talks to the web origin and Vite proxies `/api` to the
// Fastify server, so no CORS is involved. Override the target with VITE_API_PROXY.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: { port: 4173 },
});
