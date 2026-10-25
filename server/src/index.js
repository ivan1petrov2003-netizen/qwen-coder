// Точка входа Express-сервера «Облако»
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { sessionMiddleware } from './auth.js';
import authRoutes from './routes/auth.js';
import folderRoutes from './routes/folders.js';
import fileRoutes from './routes/files.js';
import shareRoutes from './routes/sharing.js';
import settingsRoutes from './routes/settings.js';
import adminRoutes from './routes/admin.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// API
app.use('/api/auth', sessionMiddleware, authRoutes);
app.use('/api/folders', sessionMiddleware, folderRoutes);
app.use('/api/files', sessionMiddleware, fileRoutes);
app.use('/api/share', sessionMiddleware, shareRoutes);
app.use('/api/settings', sessionMiddleware, settingsRoutes);
app.use('/api/admin', sessionMiddleware, adminRoutes);
app.get('/api/config', (req, res) => res.json({ backgroundVideo: config.backgroundVideoUrl }));

// Статика собранного клиента (если есть) и фоновое видео
const clientDist = path.join(ROOT, 'client', 'dist');
if (fs.existsSync(clientDist)) app.use(express.static(clientDist));
const videoFile = path.join(ROOT, 'background.mp4');
if (fs.existsSync(videoFile)) {
  app.get(config.backgroundVideoUrl, (req, res) => {
    const range = req.headers.range;
    const stat = fs.statSync(videoFile);
    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : stat.size - 1;
      res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': 'video/mp4' });
      fs.createReadStream(videoFile, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Type', 'video/mp4');
      fs.createReadStream(videoFile).pipe(res);
    }
  });
}

// SPA fallback
app.get(/^\/(?!api).*/, (req, res, next) => {
  const idx = path.join(clientDist, 'index.html');
  if (fs.existsSync(idx)) return res.sendFile(idx);
  res.status(200).send('<pre>Клиент не собран. Используйте Vite (порт 5173) или npm run build -w client.</pre>');
});

// Обработчик ошибок JSON/multer
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(400).json({ error: err.message || 'Ошибка сервера' });
});

app.listen(config.port, () => {
  console.log(`Сервер «Облако» запущен: http://localhost:${config.port}`);
});
