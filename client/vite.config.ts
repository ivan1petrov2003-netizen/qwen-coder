import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite: dev-сервер клиента + прокси API на Express.
// Порт сервера берётся из переменной окружения PORT (по умолчанию 3000).
const backendPort = process.env.PORT || '3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://localhost:${backendPort}`,
      '/background.mp4': `http://localhost:${backendPort}`,
    },
  },
});
