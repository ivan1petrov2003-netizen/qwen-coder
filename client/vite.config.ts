import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite: dev-сервер клиента + прокси API на Express (порт 3001)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
      '/background.mp4': 'http://localhost:3001',
    },
  },
});
