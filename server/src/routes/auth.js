// Маршруты аутентификации: регистрация, вход, выход, «кто я»
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { q1, run, audit } from '../db.js';
import { createSession, destroySession, publicUser, requireAuth } from '../auth.js';
import { getRootFolderId } from '../permissions.js';
import { config } from '../config.js';

const router = Router();

router.post('/register', (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  if (!/^[A-Za-z0-9_.\-\u0430-\u044fА-Яа-я]{2,32}$/.test(login))
    return res.status(400).json({ error: 'Логин: 2–32 символа (буквы, цифры, _ . -)' });
  if (password.length < 4)
    return res.status(400).json({ error: 'Пароль должен быть не короче 4 символов' });
  if (q1(`SELECT id FROM users WHERE login=? COLLATE NOCASE`, login))
    return res.status(409).json({ error: 'Такой логин уже занят' });

  const hash = bcrypt.hashSync(password, 10);
  const r = run(`INSERT INTO users (login, password_hash, role, quota_bytes) VALUES (?, ?, 'user', ?)`,
    login, hash, config.defaultQuotaBytes);
  const userId = Number(r.lastInsertRowid);
  // Личный корень + системные папки
  const rootName = `${login}`;
  const rr = run(`INSERT INTO folders (owner_id, parent_id, name, is_common) VALUES (?, NULL, ?, 0)`, userId, rootName);
  const rootId = Number(rr.lastInsertRowid);
  for (const name of ['Загрузки', 'Документы', 'Изображения', 'Видео']) {
    run(`INSERT INTO folders (owner_id, parent_id, name, is_common) VALUES (?, ?, ?, 0)`, userId, rootId, name);
  }
  // Перенос данных гостя в новый аккаунт: «Мои файлы» становится папкой внутри корня
  if (req.isGuest) {
    const guestRoot = getRootFolderId(req.user.id);
    if (guestRoot) {
      run(`UPDATE files SET owner_id=? WHERE owner_id=?`, userId, req.user.id);
      run(`UPDATE folders SET owner_id=? WHERE owner_id=?`, userId, req.user.id);
      run(`UPDATE folders SET parent_id=? WHERE id=? AND parent_id IS NULL`, rootId, guestRoot);
    }
    run(`DELETE FROM sessions WHERE user_id=?`, req.user.id);
    run(`DELETE FROM settings WHERE user_id=?`, req.user.id);
    run(`DELETE FROM users WHERE id=?`, req.user.id);
  }
  audit(userId, 'register', 'user', userId, { login });
  createSession(res, userId);
  const user = q1(`SELECT * FROM users WHERE id=?`, userId);
  res.json({ user: publicUser(user) });
});

router.post('/login', (req, res) => {
  const login = String(req.body.login || '').trim();
  const password = String(req.body.password || '');
  const user = q1(`SELECT * FROM users WHERE login=? COLLATE NOCASE AND role != 'guest'`, login);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  // Если был гостевой вход — переносим данные гостя
  if (req.isGuest && req.user.id !== user.id) {
    const guestRoot = getRootFolderId(req.user.id);
    const myRoot = getRootFolderId(user.id);
    if (guestRoot && myRoot) {
      run(`UPDATE files SET owner_id=? WHERE owner_id=?`, user.id, req.user.id);
      run(`UPDATE folders SET owner_id=? WHERE owner_id=?`, user.id, req.user.id);
      // Подпенываем гостевой корень внутрь корня пользователя, если он ещё не удалён
      run(`UPDATE folders SET parent_id=? WHERE id=? AND parent_id IS NULL`, myRoot, guestRoot);
    }
    run(`DELETE FROM sessions WHERE user_id=?`, req.user.id);
    run(`DELETE FROM users WHERE id=?`, req.user.id);
  }
  audit(user.id, 'login', 'user', user.id, null);
  createSession(res, user.id);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  if (!req.isGuest) audit(req.user.id, 'logout', 'user', req.user.id, null);
  destroySession(res, req.sessionToken);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({
    user: publicUser(req.user),
    isGuest: req.isGuest,
    isAdmin: req.isAdmin,
    rootFolderId: getRootFolderId(req.user.id),
  });
});

export default router;
