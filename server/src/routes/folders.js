// Маршруты папок: дерево, содержимое, умные представления, поиск, корзина, ZIP
import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import archiver from 'archiver';
import { q, q1, run, audit } from '../db.js';
import { getFolderAccess, can, canModifyObject, getRootFolderId, jsonError } from '../permissions.js';
import { softDeleteFolder, hardDeleteFolder } from '../storage.js';

const router = Router();
router.use((req, res, next) => { req.query = req.query ?? {}; next(); });

function folderDto(f, access) {
  return { id: f.id, name: f.name, parentId: f.parent_id, ownerId: f.owner_id,
           isCommon: !!f.is_common, createdAt: f.created_at, access };
}
function fileDto(f) {
  return { id: f.id, name: f.name, folderId: f.folder_id, mime: f.mime, size: Number(f.size),
           ownerId: f.owner_id, createdAt: f.created_at, kind: kindOf(f.mime, f.name) };
}
export function kindOf(mime, name) {
  const m = (mime || '') + ' ' + (name || '').toLowerCase();
  if ((mime || '').startsWith('image/')) return 'image';
  if ((mime || '').startsWith('video/')) return 'video';
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/.test(name || '')) return 'image';
  if (/\.(mp4|webm|mov|mkv|avi)$/.test(name || '')) return 'video';
  if (/\.(mp3|wav|ogg|flac|m4a)$/.test(name || '')) return 'audio';
  if (/\.(pdf|docx?|xlsx?|pptx?|txt|md)$/.test(name || '')) return 'document';
  if (/\.(zip|rar|7z|tar|gz)$/.test(name || '')) return 'archive';
  return 'file';
}

function breadcrumb(folder) {
  const crumbs = [];
  let cur = folder;
  let guard = 0;
  while (cur && guard++ < 100) {
    crumbs.unshift({ id: cur.id, name: cur.name, isCommon: !!cur.is_common });
    if (!cur.parent_id) break;
    cur = q1(`SELECT * FROM folders WHERE id=?`, cur.parent_id);
  }
  return crumbs;
}

function contentsOf(user, folderId) {
  const folder = q1(`SELECT * FROM folders WHERE id=? AND deleted_at IS NULL`, folderId);
  if (!folder) return null;
  const access = getFolderAccess(user, folder);
  if (!can(access, 'view')) return { forbidden: true };
  const subfolders = q(`SELECT * FROM folders WHERE parent_id=? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`, folderId)
    .map(f => folderDto(f, getFolderAccess(user, f)));
  const files = q(`SELECT * FROM files WHERE folder_id=? AND deleted_at IS NULL ORDER BY created_at DESC`, folderId)
    .map(fileDto);
  return { folder: folderDto(folder, access), breadcrumb: breadcrumb(folder), subfolders, files };
}

// ---------- Корни ----------
router.get('/root', (req, res) => {
  const rootId = getRootFolderId(req.user.id);
  if (!rootId) return res.status(500).json({ error: 'Корневая папка не найдена' });
  // Гостям показываем их корень «Мои файлы», пользователям — корень с системными папками
  const data = contentsOf(req.user, rootId);
  res.json(data || { error: 'Папка не найдена' });
});

router.get('/common', (req, res) => {
  const common = q1(`SELECT id FROM folders WHERE is_common=1 AND parent_id IS NULL LIMIT 1`);
  const data = contentsOf(req.user, common.id);
  res.json(data || { error: 'Общая папка не найдена' });
});

// ---------- Умные представления (до :id!) ----------
router.get('/aggregate', (req, res) => {
  const kind = String(req.query.kind || 'recent');
  const uid = req.user.id;
  let files = [];
  if (kind === 'image' || kind === 'video') {
    const like = kind === 'image' ? 'image/%' : 'video/%';
    files = q(`SELECT * FROM files WHERE owner_id=? AND deleted_at IS NULL AND mime LIKE ? ORDER BY created_at DESC LIMIT 500`, uid, like).map(fileDto);
  } else if (kind === 'media') {
    files = q(`SELECT * FROM files WHERE owner_id=? AND deleted_at IS NULL AND (mime LIKE 'image/%' OR mime LIKE 'video/%') ORDER BY created_at DESC LIMIT 200`, uid).map(fileDto);
  } else { // recent — все последние файлы пользователя
    files = q(`SELECT * FROM files WHERE owner_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200`, uid).map(fileDto);
  }
  res.json({ kind, files });
});

router.get('/search', (req, res) => {
  const s = String(req.query.q || '').trim();
  if (!s) return res.json({ folders: [], files: [] });
  const like = `%${s}%`;
  const uid = req.user.id;
  // Свои + общие (видимые)
  const folders = q(`SELECT * FROM folders WHERE deleted_at IS NULL AND (owner_id=? OR is_common=1 OR id IN
      (SELECT folder_id FROM folder_invites WHERE invitee_id=?)) AND name LIKE ? ORDER BY name LIMIT 60`, uid, uid, like)
    .map(f => ({ ...folderDto(f, getFolderAccess(req.user, f)), path: breadcrumb(f).map(c => c.name).join(' / ') }));
  const files = q(`SELECT * FROM files WHERE deleted_at IS NULL AND (owner_id=? OR owner_id IS NULL OR folder_id IN
      (SELECT id FROM folders WHERE is_common=1)) AND name LIKE ? ORDER BY name LIMIT 60`, uid, like).map(fileDto);
  res.json({ folders, files });
});

router.get('/trash', (req, res) => {
  const uid = req.user.id;
  const isAdmin = req.user.role === 'admin';
  const ownerCond = isAdmin ? `1=1` : `(f.owner_id=? OR f.owner_id IS NULL)`;
  const params = isAdmin ? [] : [uid];
  const files = q(`SELECT f.*, (SELECT name FROM folders WHERE id=f.folder_id) AS folderName
                   FROM files f WHERE f.deleted_at IS NOT NULL AND ${ownerCond} ORDER BY f.deleted_at DESC LIMIT 300`, ...params).map(fileDto);
  const folders = q(`SELECT * FROM folders WHERE deleted_at IS NOT NULL AND owner_id=? ORDER BY deleted_at DESC LIMIT 300`, uid)
    .map(f => folderDto(f, 'owner'));
  res.json({ files, folders });
});

function restoreItem(user, type, id) {
  if (type === 'file') {
    const f = q1(`SELECT * FROM files WHERE id=?`, id);
    if (!f) return 'not_found';
    if (user.role !== 'admin' && f.owner_id !== user.id) return 'forbidden';
    run(`UPDATE files SET deleted_at=NULL WHERE id=?`, id);
    return 'ok';
  }
  const f = q1(`SELECT * FROM folders WHERE id=?`, id);
  if (!f) return 'not_found';
  if (user.role !== 'admin' && f.owner_id !== user.id) return 'forbidden';
  // Восстанавливаем только если предки живы; иначе переносим в корзину-корень не можем — просто поднимаем
  run(`UPDATE folders SET deleted_at=NULL WHERE id=?`, id);
  for (const fl of q(`SELECT id FROM files WHERE folder_id=?`, id)) run(`UPDATE files SET deleted_at=NULL WHERE id=?`, fl.id);
  return 'ok';
}

router.post('/trash/restore', (req, res) => {
  const { type, id } = req.body || {};
  const r = restoreItem(req.user, type, Number(id));
  if (r === 'not_found') return res.status(404).json({ error: 'Элемент не найден' });
  if (r === 'forbidden') return res.status(403).json({ error: 'Нельзя восстановить чужой элемент' });
  audit(req.user.id, 'trash_restore', type, Number(id), null);
  res.json({ ok: true });
});

router.post('/trash/remove', (req, res) => {
  const { type, id } = req.body || {};
  const fid = Number(id);
  if (type === 'file') {
    const f = q1(`SELECT * FROM files WHERE id=?`, fid);
    if (!f) return res.status(404).json({ error: 'Файл не найден' });
    if (req.user.role !== 'admin' && f.owner_id !== req.user.id) return res.status(403).json({ error: 'Чужой файл' });
    try { fs.unlinkSync(f.storage_path); } catch {}
    run(`DELETE FROM files WHERE id=?`, fid);
  } else {
    const f = q1(`SELECT * FROM folders WHERE id=?`, fid);
    if (!f) return res.status(404).json({ error: 'Папка не найдена' });
    if (req.user.role !== 'admin' && f.owner_id !== req.user.id) return res.status(403).json({ error: 'Чужая папка' });
    hardDeleteFolder(fid);
  }
  audit(req.user.id, 'trash_remove', type, fid, null);
  res.json({ ok: true });
});

router.post('/trash/empty', (req, res) => {
  const uid = req.user.id;
  const isAdmin = req.user.role === 'admin';
  const files = isAdmin
    ? q(`SELECT * FROM files WHERE deleted_at IS NOT NULL`)
    : q(`SELECT * FROM files WHERE deleted_at IS NOT NULL AND owner_id=?`, uid);
  for (const f of files) { try { fs.unlinkSync(f.storage_path); } catch {} }
  if (isAdmin) run(`DELETE FROM files WHERE deleted_at IS NOT NULL`);
  else run(`DELETE FROM files WHERE deleted_at IS NOT NULL AND owner_id=?`, uid);
  const folders = isAdmin
    ? q(`SELECT id FROM folders WHERE deleted_at IS NOT NULL AND parent_id IS NULL`)
    : q(`SELECT id FROM folders WHERE deleted_at IS NOT NULL AND owner_id=?`, uid);
  for (const f of folders) hardDeleteFolder(f.id);
  audit(uid, 'trash_empty', null, null, null);
  res.json({ ok: true });
});

// ---------- Создание / переименование / перемещение / удаление ----------
router.post('/', (req, res) => {
  const parentId = Number(req.body.parentId);
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 120) return res.status(400).json({ error: 'Некорректное имя папки' });
  const parent = q1(`SELECT * FROM folders WHERE id=? AND deleted_at IS NULL`, parentId);
  if (!parent) return res.status(404).json({ error: 'Родительская папка не найдена' });
  const access = getFolderAccess(req.user, parent);
  if (!can(access, 'create')) return jsonError(res);
  const dup = q1(`SELECT id FROM folders WHERE parent_id=? AND name=? COLLATE NOCASE AND deleted_at IS NULL`, parentId, name);
  if (dup) return res.status(409).json({ error: 'Папка с таким именем уже существует' });
  const r = run(`INSERT INTO folders (owner_id, parent_id, name, is_common) VALUES (?,?,?,?)`,
    req.user.id, parentId, name, parent.is_common);
  audit(req.user.id, 'folder_create', 'folder', Number(r.lastInsertRowid), { name });
  res.json({ id: Number(r.lastInsertRowid), name });
});

router.patch('/:id', (req, res) => {
  const id = Number(req.params.id);
  const folder = q1(`SELECT * FROM folders WHERE id=? AND deleted_at IS NULL`, id);
  if (!folder) return res.status(404).json({ error: 'Папка не найдена' });
  const access = getFolderAccess(req.user, folder);
  if (!canModifyObject(req.user, access, folder.owner_id)) return jsonError(res);
  const newName = req.body.name != null ? String(req.body.name).trim() : null;
  if (newName != null) {
    if (!newName || newName.length > 120) return res.status(400).json({ error: 'Некорректное имя' });
    run(`UPDATE folders SET name=? WHERE id=?`, newName, id);
  }
  if (req.body.parentId != null) {
    const destId = Number(req.body.parentId);
    if (destId && destId !== id) {
      const dest = q1(`SELECT * FROM folders WHERE id=? AND deleted_at IS NULL`, destId);
      if (!dest) return res.status(404).json({ error: 'Папка-назначения не найдена' });
      const destAccess = getFolderAccess(req.user, dest);
      if (!can(destAccess, 'create')) return jsonError(res);
      // запрет перемещения внутрь себя
      let up = dest, guard = 0;
      while (up && guard++ < 100) { if (up.id === id) return res.status(400).json({ error: 'Нельзя переместить папку внутрь неё же' });
        up = up.parent_id ? q1(`SELECT * FROM folders WHERE id=?`, up.parent_id) : null; }
      run(`UPDATE folders SET parent_id=? WHERE id=?`, destId, id);
    }
  }
  audit(req.user.id, 'folder_update', 'folder', id, req.body);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const folder = q1(`SELECT * FROM folders WHERE id=? AND deleted_at IS NULL`, id);
  if (!folder) return res.status(404).json({ error: 'Папка не найдена' });
  if (folder.parent_id == null && !folder.is_common)
    return res.status(400).json({ error: 'Корневую папку удалять нельзя' });
  const access = getFolderAccess(req.user, folder);
  if (!canModifyObject(req.user, access, folder.owner_id)) return jsonError(res);
  softDeleteFolder(id);
  audit(req.user.id, 'folder_delete', 'folder', id, { name: folder.name });
  res.json({ ok: true });
});

// ---------- Содержимое и ZIP ----------
router.get('/:id', (req, res) => {
  const data = contentsOf(req.user, Number(req.params.id));
  if (!data) return res.status(404).json({ error: 'Папка не найдена' });
  if (data.forbidden) return jsonError(res);
  res.json(data);
});

function collectZipEntries(folderId, base, out) {
  const files = q(`SELECT * FROM files WHERE folder_id=? AND deleted_at IS NULL`, folderId);
  for (const f of files) out.push({ abs: f.storage_path, name: path.posix.join(base, f.name) });
  const subs = q(`SELECT * FROM folders WHERE parent_id=? AND deleted_at IS NULL`, folderId);
  for (const s of subs) collectZipEntries(s.id, path.posix.join(base, s.name), out);
}

router.get('/:id/download-zip', (req, res) => {
  const id = Number(req.params.id);
  const folder = q1(`SELECT * FROM folders WHERE id=? AND deleted_at IS NULL`, id);
  if (!folder) return res.status(404).json({ error: 'Папка не найдена' });
  const access = getFolderAccess(req.user, folder);
  if (!can(access, 'download')) return jsonError(res);
  const entries = [];
  collectZipEntries(id, '', entries);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(folder.name)}.zip`);
  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.on('error', (e) => { console.error(e); try { res.end(); } catch {} });
  archive.pipe(res);
  for (const e of entries) { try { archive.file(e.abs, { name: e.name }); } catch {} }
  archive.finalize();
});

export { fileDto, folderDto, contentsOf };
export default router;
