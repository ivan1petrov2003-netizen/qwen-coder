// Маршруты файлов: загрузка (multer), скачивание, превью, переименование/перемещение, удаление
import { Router } from 'express';
import fs from 'node:fs';
import multer from 'multer';
import { q1, run, audit } from '../db.js';
import { getFolderAccess, can, canModifyObject, jsonError } from '../permissions.js';
import { storePathFor, checkQuota, usedBytes } from '../storage.js';
import { config } from '../config.js';

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const folderId = Number(req.body.folderId);
      const folder = q1(`SELECT * FROM folders WHERE id=? AND deleted_at IS NULL`, folderId);
      if (!folder) return cb(new Error('Папка не найдена'));
      const access = getFolderAccess(req.user, folder);
      if (!can(access, 'upload')) return cb(new Error('Недостаточно прав для загрузки в эту папку'));
      const ownerId = req.user.id; // файл всегда принадлежит загрузившему
      const dir = `${config.filesDir}/${ownerId}`;
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      cb(null, `${Date.now()}_${Math.random().toString(16).slice(2)}_${Buffer.from(file.originalname, 'latin1').toString('utf8').replace(/[\\/:*?"<>|]/g, '_')}`);
    },
  }),
  limits: { fileSize: 512 * 1024 * 1024 },
});

router.post('/', upload.array('files', 50), (req, res) => {
  const folderId = Number(req.body.folderId);
  const folder = q1(`SELECT * FROM folders WHERE id=? AND deleted_at IS NULL`, folderId);
  if (!folder) { cleanup(); return res.status(404).json({ error: 'Папка не найдена' }); }
  const access = getFolderAccess(req.user, folder);
  if (!can(access, 'upload')) { cleanup(); return res.status(403).json({ error: 'Недостаточно прав для загрузки' }); }
  const totalSize = (req.files || []).reduce((s, f) => s + f.size, 0);
  if (!checkQuota(req.user, totalSize)) {
    cleanup();
    return res.status(507).json({ error: `Недостаточно места: свободно ${formatBytes(Math.max(0, req.user.quota_bytes - usedBytes(req.user.id)))} из ${formatBytes(req.user.quota_bytes)}` });
  }
  const created = [];
  for (const f of (req.files || [])) {
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    let finalName = name, i = 2;
    while (q1(`SELECT id FROM files WHERE folder_id=? AND name=? COLLATE NOCASE AND deleted_at IS NULL`, folderId, finalName)) {
      const dot = name.lastIndexOf('.');
      finalName = dot > 0 ? `${name.slice(0, dot)} (${i})${name.slice(dot)}` : `${name} (${i})`;
      i++;
    }
    const r = run(`INSERT INTO files (owner_id, folder_id, name, mime, size, storage_path) VALUES (?,?,?,?,?,?)`,
      req.user.id, folderId, finalName, f.mimetype, f.size, f.path);
    created.push({ id: Number(r.lastInsertRowid), name: finalName });
    audit(req.user.id, 'file_upload', 'file', Number(r.lastInsertRowid), { name: finalName, size: f.size });
  }
  function cleanup() { for (const f of (req.files || [])) try { fs.unlinkSync(f.path); } catch {} }
  res.json({ created });
});

function formatBytes(n) {
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' ГБ';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' МБ';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' КБ';
  return n + ' Б';
}

function getFile(id) { return q1(`SELECT * FROM files WHERE id=?`, id); }
function fileAccess(req, file) {
  if (req.user.role === 'admin') return 'owner';
  if (file.owner_id === req.user.id) return 'owner';
  const folder = q1(`SELECT * FROM folders WHERE id=?`, file.folder_id);
  return folder ? getFolderAccess(req.user, folder) : null;
}

function sendFile(req, res, file, disposition) {
  if (!fs.existsSync(file.storage_path)) return res.status(404).json({ error: 'Файл утрачен на сервере' });
  res.setHeader('Content-Type', file.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  fs.createReadStream(file.storage_path).pipe(res);
}

router.get('/:id/download', (req, res) => {
  const file = getFile(Number(req.params.id));
  if (!file || file.deleted_at) return res.status(404).json({ error: 'Файл не найден' });
  const access = fileAccess(req, file);
  if (!can(access, 'download')) return jsonError(res);
  sendFile(req, res, file, 'attachment');
});

router.get('/:id/preview', (req, res) => {
  const file = getFile(Number(req.params.id));
  if (!file || file.deleted_at) return res.status(404).json({ error: 'Файл не найден' });
  const access = fileAccess(req, file);
  if (!can(access, 'view')) return jsonError(res);
  sendFile(req, res, file, 'inline');
});

router.patch('/:id', (req, res) => {
  const file = getFile(Number(req.params.id));
  if (!file || file.deleted_at) return res.status(404).json({ error: 'Файл не найден' });
  const access = fileAccess(req, file);
  if (!canModifyObject(req.user, access, file.owner_id)) return jsonError(res);
  if (req.body.name != null) {
    const name = String(req.body.name).trim();
    if (!name || name.length > 200) return res.status(400).json({ error: 'Некорректное имя файла' });
    run(`UPDATE files SET name=? WHERE id=?`, name, file.id);
  }
  if (req.body.folderId != null) {
    const dest = q1(`SELECT * FROM folders WHERE id=? AND deleted_at IS NULL`, Number(req.body.folderId));
    if (!dest) return res.status(404).json({ error: 'Папка-назначения не найдена' });
    const destAccess = getFolderAccess(req.user, dest);
    if (!can(destAccess, 'create')) return jsonError(res);
    run(`UPDATE files SET folder_id=? WHERE id=?`, dest.id, file.id);
  }
  audit(req.user.id, 'file_update', 'file', file.id, req.body);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const file = getFile(Number(req.params.id));
  if (!file || file.deleted_at) return res.status(404).json({ error: 'Файл не найден' });
  const access = fileAccess(req, file);
  if (!canModifyObject(req.user, access, file.owner_id)) return jsonError(res);
  run(`UPDATE files SET deleted_at=datetime('now') WHERE id=?`, file.id);
  audit(req.user.id, 'file_delete', 'file', file.id, { name: file.name });
  res.json({ ok: true });
});

export default router;
