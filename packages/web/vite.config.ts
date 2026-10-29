import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the game server runs separately on port 3000 and Vite proxies
// the socket connection to it. In production the server serves the built files.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: { target: 'es2022', sourcemap: false },
});
