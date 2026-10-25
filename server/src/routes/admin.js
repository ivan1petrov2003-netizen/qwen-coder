// Панель администратора: сводка, пользователи, любые папки, аудит
import { Router } from 'express';
import fs from 'node:fs';
import { q, q1, run, audit } from '../db.js';
import { usedBytes } from '../storage.js';
import { fileDto } from './folders.js';

const router = Router();

// Все маршруты — только для администратора
router.use((req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' });
  next();
});

router.get('/overview', (req, res) => {
  const users = q1(`SELECT COUNT(*) AS c FROM users WHERE role IN ('user','admin')`).c;
  const guests = q1(`SELECT COUNT(*) AS c FROM users WHERE role='guest'`).c;
  const folders = q1(`SELECT COUNT(*) AS c FROM folders WHERE deleted_at IS NULL`).c;
  const files = q1(`SELECT COUNT(*) AS c FROM files WHERE deleted_at IS NULL`).c;
  const bytes = q1(`SELECT COALESCE(SUM(size),0) AS c FROM files WHERE deleted_at IS NULL`).c;
  res.json({ users: Number(users), guests: Number(guests), folders: Number(folders), files: Number(files), bytes: Number(bytes) });
});

router.get('/users', (req, res) => {
  const rows = q(`SELECT * FROM users WHERE role IN ('user','admin','guest') ORDER BY role DESC, created_at DESC LIMIT 500`);
  res.json({ users: rows.map(u => ({
    id: u.id, login: u.login, role: u.role, quotaBytes: u.quota_bytes,
    usedBytes: usedBytes(u.id), createdAt: u.created_at,
  })) });
});

router.delete('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить самого себя' });
  const u = q1(`SELECT * FROM users WHERE id=?`, id);
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  if (u.role === 'admin' && q1(`SELECT COUNT(*) AS c FROM users WHERE role='admin'`).c <= 1)
    return res.status(400).json({ error: 'Нельзя удалить последнего администратора' });
  // Удаляем файлы с диска
  for (const f of q(`SELECT storage_path FROM files WHERE owner_id=?`, id)) { try { fs.unlinkSync(f.storage_path); } catch {} }
  run(`DELETE FROM users WHERE id=?`, id); // каскадно удалит папки/файлы/инвайты/сессии
  audit(req.user.id, 'admin_delete_user', 'user', id, { login: u.login });
  res.json({ ok: true });
});

router.get('/users/:id/folders', (req, res) => {
  const id = Number(req.params.id);
  const roots = q(`SELECT * FROM folders WHERE owner_id=? AND parent_id IS NULL`, id);
  function map(f) {
    return { id: f.id, name: f.name, isCommon: !!f.is_common,
      children: q(`SELECT * FROM folders WHERE parent_id=? AND deleted_at IS NULL ORDER BY name`, f.id).map(map) };
  }
  res.json({ roots: roots.map(map) });
});

router.get('/folders/:id/contents', (req, res) => {
  const id = Number(req.params.id);
  const folder = q1(`SELECT * FROM folders WHERE id=?`, id);
  if (!folder) return res.status(404).json({ error: 'Папка не найдена' });
  res.json({
    folder: { id: folder.id, name: folder.name },
    subfolders: q(`SELECT * FROM folders WHERE parent_id=? AND deleted_at IS NULL ORDER BY name`, id)
      .map(f => ({ id: f.id, name: f.name })),
    files: q(`SELECT * FROM files WHERE folder_id=? AND deleted_at IS NULL ORDER BY name`, id).map(fileDto),
  });
});

router.get('/audit', (req, res) => {
  const rows = q(`SELECT a.*, u.login AS user_login FROM audit a LEFT JOIN users u ON u.id=a.user_id
                  ORDER BY a.id DESC LIMIT 200`);
  res.json({ entries: rows.map(a => ({ id: a.id, userLogin: a.user_login || '?', action: a.action,
    targetType: a.target_type, targetId: a.target_id, meta: a.meta, createdAt: a.created_at })) });
});

export default router;
