import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(__dirname, '..', '..');

export const config = {
  // Порт по умолчанию — 3000; переопределение: set PORT=4000 (Windows) или PORT=4000 (Linux/macOS)
  port: Number(process.env.PORT || 3000),
  // Каталог данных (БД + хранилище файлов)
  dataDir: process.env.OBLOKO_DATA || path.join(ROOT, 'data'),
  get dbPath() { return path.join(this.dataDir, 'cloud.db'); },
  get filesDir() { return path.join(this.dataDir, 'files'); },
  // Путь к фоновому видео, доступный фронтенду
  backgroundVideoUrl: '/background.mp4',
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000, // ~30 дней
  defaultQuotaBytes: 1024 * 1024 * 1024,  // 1 ГБ
  adminLogin: 'user',
  adminPassword: 'user123',
};
