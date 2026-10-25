// Публикация папок по ссылке и приглашения пользователей
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import archiver from 'archiver';
import { q, q1, run, audit } from '../db.js';
import { getFolderAccess, can, canModifyObject, jsonError } from '../permissions.js';
import { fileDto } from './folders.js';

const router = Router();

function linkInfo(link, folder) {
  return { id: link.id, token: link.token, hasPassword: !!link.has_password,
           folderName: folder.name, folderId: folder.id, active: !!link.active, createdAt: link.created_at };
}

router.post('/publish', (req, res) => {
  const folderId = Number(req.body.folderId);
  const folder = q1(`SELECT * FROM folders WHERE id=? AND deleted_at IS NULL`, folderId);
  if (!folder) return res.status(404).json({ error: 'Папка не найдена' });
  const access = getFolderAccess(req.user, folder);
  if (!can(access, 'view')) return jsonError(res);
  const password = req.body.password ? String(req.body.password) : null;
  let link = q1(`SELECT * FROM public_links WHERE folder_id=? AND active=1`, folderId);
  if (link) {
    // обновляем пароль, если задан заново
    if (password != null) {
      run(`UPDATE public_links SET has_password=?, password_hash=? WHERE id=?`,
        password ? 1 : 0, password ? bcrypt.hashSync(password, 10) : null, link.id);
    }
  } else {
    const token = crypto.randomBytes(8).toString('hex');
    const r = run(`INSERT INTO public_links (folder_id, token, has_password, password_hash, created_by) VALUES (?,?,?,?,?)`,
      folderId, token, password ? 1 : 0, password ? bcrypt.hashSync(password, 10) : null, req.user.id);
    link = q1(`SELECT * FROM public_links WHERE id=?`, Number(r.lastInsertRowid));
  }
  audit(req.user.id, 'publish', 'folder', folderId, { token: link.token, withPassword: !!password });
  res.json({ url: `/share/${link.token}`, link: linkInfo(link, folder) });
});

router.post('/unpublish', (req, res) => {
  const folderId = Number(req.body.folderId);
  const links = q(`SELECT * FROM public_links WHERE folder_id=? AND active=1`, folderId);
  for (const l of links) run(`UPDATE public_links SET active=0 WHERE id=?`, l.id);
  audit(req.user.id, 'unpublish', 'folder', folderId, null);
  res.json({ ok: true });
});

// ---------- Публичный доступ по ссылке ----------
function getLink(req, res) {
  const link = q1(`SELECT * FROM public_links WHERE token=? AND active=1`, req.params.token);
  if (!link) { res.status(404).json({ error: 'Ссылка не найдена или отключена' }); return null; }
  const folder = q1(`SELECT * FROM folders WHERE id=? AND deleted_at IS NULL`, link.folder_id);
  if (!folder) { res.status(410).json({ error: 'Публикуемая папка удалена' }); return null; }
  return { link, folder };
}
function isUnlocked(req, link) {
  if (!link.has_password) return true;
  return !!q1(`SELECT 1 AS x FROM public_unlocks WHERE session_token=? AND link_id=?`, req.sessionToken, link.id);
}

router.get('/:token/info', (req, res) => {
  const g = getLink(req, res); if (!g) return;
  const { link, folder } = g;
  res.json({ needPassword: !!link.has_password && !isUnlocked(req, link),
             name: folder.name, unlocked: isUnlocked(req, link) });
});

router.post('/:token/unlock', (req, res) => {
  const g = getLink(req, res); if (!g) return;
  const { link } = g;
  if (!link.has_password) return res.json({ ok: true });
  if (!bcrypt.compareSync(String(req.body.password || ''), link.password_hash))
    return res.status(401).json({ error: 'Неверный пароль' });
  run(`INSERT OR REPLACE INTO public_unlocks (session_token, link_id) VALUES (?,?)`, req.sessionToken, link.id);
  res.json({ ok: true });
});

router.get('/:token/contents', (req, res) => {
  const g = getLink(req, res); if (!g) return;
  const { link, folder } = g;
  if (!isUnlocked(req, link)) return res.status(401).json({ error: 'Требуется пароль' });
  function build(fid, base) {
    const files = q(`SELECT * FROM files WHERE folder_id=? AND deleted_at IS NULL ORDER BY name`, fid).map(f => ({
      ...fileDto(f), downloadUrl: `/api/share/${link.token}/file/${f.id}`, previewUrl: `/api/share/${link.token}/preview/${f.id}`,
    }));
    const folders = q(`SELECT * FROM folders WHERE parent_id=? AND deleted_at IS NULL ORDER BY name`, fid).map(sf => ({
      id: sf.id, name: sf.name, path: path.posix.join(base, sf.name), children: build(sf.id, path.posix.join(base, sf.name)),
    }));
    return { folders, files };
  }
  res.json({ name: folder.name, ...build(folder.id, '') });
});

function shareFile(req, res, id, disposition) {
  const g = getLink(req, res); if (!g) return;
  const { link } = g;
  if (!isUnlocked(req, link)) return res.status(401).json({ error: 'Требуется пароль' });
  const file = q1(`SELECT * FROM files WHERE id=? AND deleted_at IS NULL`, Number(id));
  if (!file) return res.status(404).json({ error: 'Файл не найден' });
  // Файл должен лежать в дереве публикуемой папки
  let cur = q1(`SELECT * FROM folders WHERE id=?`, file.folder_id), ok = false, guard = 0;
  while (cur && guard++ < 100) { if (cur.id === link.folder_id) { ok = true; break; }
    cur = cur.parent_id ? q1(`SELECT * FROM folders WHERE id=?`, cur.parent_id) : null; }
  if (!ok) return res.status(403).json({ error: 'Файл вне публичной папки' });
  if (!fs.existsSync(file.storage_path)) return res.status(404).json({ error: 'Файл утрачен' });
  res.setHeader('Content-Type', file.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  fs.createReadStream(file.storage_path).pipe(res);
}
router.get('/:token/file/:id', (req, res) => shareFile(req, res, req.params.id, 'attachment'));
router.get('/:token/preview/:id', (req, res) => shareFile(req, res, req.params.id, 'inline'));

// ---------- Приглашения ----------
router.post('/invite', (req, res) => {
  const folderId = Number(req.body.folderId);
  const login = String(req.body.login || '').trim();
  const permission = ['view', 'read', 'write'].includes(req.body.permission) ? req.body.permission : 'read';
  const folder = q1(`SELECT * FROM folders WHERE id=? AND deleted_at IS NULL`, folderId);
  if (!folder) return res.status(404).json({ error: 'Папка не найдена' });
  const access = getFolderAccess(req.user, folder);
  if (access !== 'owner') return res.status(403).json({ error: 'Приглашать может только владелец папки' });
  if (req.isGuest) return res.status(401).json({ error: 'Гостям недоступны приглашения — зарегистрируйтесь' });
  const invitee = q1(`SELECT * FROM users WHERE login=? COLLATE NOCASE AND role IN ('user','admin')`, login);
  if (!invitee) return res.status(404).json({ error: `Пользователь «${login}» не найден` });
  if (invitee.id === req.user.id) return res.status(400).json({ error: 'Нельзя пригласить самого себя' });
  const existing = q1(`SELECT * FROM folder_invites WHERE folder_id=? AND invitee_id=?`, folderId, invitee.id);
  if (existing) run(`UPDATE folder_invites SET permission=?, granted_by=? WHERE id=?`, permission, req.user.id, existing.id);
  else run(`INSERT INTO folder_invites (folder_id, invitee_id, permission, granted_by) VALUES (?,?,?,?)`,
    folderId, invitee.id, permission, req.user.id);
  audit(req.user.id, 'invite', 'folder', folderId, { login, permission });
  res.json({ ok: true });
});

router.get('/invites', (req, res) => {
  // Инвайты, выданные мной (по моим папкам)
  const sent = q(`SELECT i.*, f.name AS folder_name, u.login AS invitee_login
                  FROM folder_invites i JOIN folders f ON f.id=i.folder_id JOIN users u ON u.id=i.invitee_id
                  WHERE f.owner_id=? ORDER BY i.created_at DESC`, req.user.id)
    .map(i => ({ id: i.id, folderId: i.folder_id, folderName: i.folder_name, inviteeLogin: i.invitee_login,
                 permission: i.permission, createdAt: i.created_at }));
  res.json({ sent });
});

// Смена права: повторный invite с тем же логином (UPSERT выше). Отзыв:
router.delete('/invite/:id', (req, res) => {
  const inv = q1(`SELECT i.*, f.owner_id FROM folder_invites i JOIN folders f ON f.id=i.folder_id WHERE i.id=?`, Number(req.params.id));
  if (!inv) return res.status(404).json({ error: 'Приглашение не найдено' });
  if (inv.owner_id !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'Отзывать может только владелец папки' });
  run(`DELETE FROM folder_invites WHERE id=?`, inv.id);
  audit(req.user.id, 'invite_revoke', 'folder', inv.folder_id, null);
  res.json({ ok: true });
});

router.get('/shared-with-me', (req, res) => {
  const rows = q(`SELECT i.*, f.name AS folder_name, o.login AS owner_login
                  FROM folder_invites i JOIN folders f ON f.id=i.folder_id LEFT JOIN users o ON o.id=f.owner_id
                  WHERE i.invitee_id=? ORDER BY i.created_at DESC`, req.user.id);
  res.json({ folders: rows.map(i => ({ id: i.id, folderId: i.folder_id, name: i.folder_name,
    ownerLogin: i.owner_login, permission: i.permission })) });
});

export default router;
