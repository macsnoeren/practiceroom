import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During development the web app runs on :5173 and proxies API/websocket
// traffic to the Fastify server on :3000, so the browser only ever talks to
// one origin (no CORS surprises in the app itself).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  // The shared package ships TypeScript source; let Vite transform it on the
  // fly instead of trying to pre-bundle it.
  optimizeDeps: {
    exclude: ['@practiceroom/shared'],
  },
});
