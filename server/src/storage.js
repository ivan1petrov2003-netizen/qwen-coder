// Хранение файлов на диске сервера
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { q, q1, run } from './db.js';

// Путь на диске для нового файла (storage_path хранится абсолютным)
export function storePathFor(ownerId, originalName) {
  const ext = path.extname(originalName).slice(0, 12).toLowerCase();
  const dir = path.join(config.filesDir, String(ownerId ?? 'anon'));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`);
}

// Сколько байт занято пользователем (без удалённых)
export function usedBytes(userId) {
  const r = q1(`SELECT COALESCE(SUM(size),0) AS s FROM files WHERE owner_id=? AND deleted_at IS NULL`, userId);
  return Number(r.s);
}

export function checkQuota(user, incomingSize) {
  if (user.role === 'admin') return true;
  return usedBytes(user.id) + incomingSize <= user.quota_bytes;
}

export function removeStored(storagePath) {
  try { fs.unlinkSync(storagePath); } catch {}
}

// Мягкое удаление папки со всем содержимым (рекурсивно) — в корзину
export function softDeleteFolder(folderId) {
  run(`UPDATE folders SET deleted_at=datetime('now') WHERE id=? AND deleted_at IS NULL`, folderId);
  for (const c of q(`SELECT id FROM folders WHERE parent_id=? AND deleted_at IS NULL`, folderId)) {
    softDeleteFolder(c.id);
  }
  run(`UPDATE files SET deleted_at=datetime('now') WHERE folder_id=? AND deleted_at IS NULL`, folderId);
}

// Окончательное удаление папки со всем содержимым (файлы с диска)
export function hardDeleteFolder(folderId) {
  const files = q(`SELECT storage_path FROM files WHERE folder_id=?`, folderId);
  for (const f of files) removeStored(f.storage_path);
  run(`DELETE FROM files WHERE folder_id=?`, folderId);
  const children = q(`SELECT id FROM folders WHERE parent_id=?`, folderId);
  for (const c of children) hardDeleteFolder(c.id);
  run(`DELETE FROM public_links WHERE folder_id=?`, folderId);
  run(`DELETE FROM folder_invites WHERE folder_id=?`, folderId);
  run(`DELETE FROM folders WHERE id=?`, folderId);
}
