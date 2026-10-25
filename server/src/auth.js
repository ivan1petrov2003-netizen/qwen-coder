// Аутентификация: сессии в cookie, гостевые сессии, bcrypt-хэши
import crypto from 'node:crypto';
import { q1, run, audit } from './db.js';
import { config } from './config.js';

const COOKIE = 'obloko_session';

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, token) {
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(config.sessionTtlMs / 1000)}`);
}

export function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + config.sessionTtlMs).toISOString();
  run(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)`, token, userId, expires);
  setCookie(res, token);
  return token;
}

export function destroySession(res, token) {
  if (token) run(`DELETE FROM sessions WHERE token=?`, token);
  res.setHeader('Set-Cookie', `${COOKIE}=deleted; HttpOnly; Path=/; Max-Age=0`);
}

export function ensureGuest(req, res) {
  // Гость: анонимная запись users(role='guest') + сессия
  const login = `guest_${crypto.randomBytes(4).toString('hex')}`;
  const r = run(`INSERT INTO users (login, password_hash, role, quota_bytes) VALUES (?, NULL, 'guest', ?)`,
    login, config.defaultQuotaBytes);
  const userId = Number(r.lastInsertRowid);
  run(`INSERT INTO folders (owner_id, parent_id, name, is_common) VALUES (?, NULL, 'Мои файлы', 0)`, userId);
  const token = createSession(res, userId);
  return { token, userId };
}

// Middleware: гарантирует req.user (может быть гостем)
export function sessionMiddleware(req, res, next) {
  const token = parseCookies(req)[COOKIE];
  let effectiveToken = token;
  let sess = token ? q1(`SELECT * FROM sessions WHERE token=? AND expires_at > datetime('now')`, token) : null;
  if (!sess) {
    // Нет валидной сессии — создаём гостя
    const g = ensureGuest(req, res);
    effectiveToken = g.token;
    sess = q1(`SELECT * FROM sessions WHERE token=?`, effectiveToken);
  }
  const user = q1(`SELECT id, login, role, quota_bytes, created_at FROM users WHERE id=?`, sess.user_id);
  req.user = user;              // {id, login, role, quota_bytes}
  req.sessionToken = effectiveToken;
  req.isGuest = user.role === 'guest';
  req.isAdmin = user.role === 'admin';
  next();
}

export function requireAuth(req, res, next) {
  if (req.isGuest) return res.status(401).json({ error: 'Требуется вход в аккаунт' });
  next();
}

export function publicUser(u) {
  return { id: u.id, login: u.login, role: u.role, quotaBytes: u.quota_bytes, createdAt: u.created_at };
}
