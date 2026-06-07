import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The camera app runs on :5174 and proxies API/websocket traffic to the
// Fastify server on :3000. getUserMedia works because localhost is a secure
// context (real HTTPS is only needed when running on other devices — Phase 8).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true, changeOrigin: true },
    },
  },
  optimizeDeps: {
    exclude: ['@practiceroom/shared'],
  },
});
