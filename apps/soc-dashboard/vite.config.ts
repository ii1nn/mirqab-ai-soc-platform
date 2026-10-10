import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // TEMP QA OVERRIDE (restore-test verification, 2026-09-22): points at the
      // socat sidecar (mirqab-qa-proxy, host:13000) forwarding to the isolated
      // mirqab-backend-restore-test container. Revert to https://localhost
      // (the normal nginx entrypoint) after QA.
      '/api/v1': {
        target: 'http://localhost:13000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:13000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
