// SQLite через встроенный модуль node:sqlite (Node >= 22.5)
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.filesDir, { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ---------- Схема ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user',           -- user | guest | admin
  quota_bytes INTEGER NOT NULL DEFAULT 1073741824,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_common INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS public_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  has_password INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS folder_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  invitee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'read',     -- view | read | write
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(folder_id, invitee_id)
);
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS public_unlocks (
  session_token TEXT NOT NULL,
  link_id INTEGER NOT NULL REFERENCES public_links(id) ON DELETE CASCADE,
  unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (session_token, link_id)
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id INTEGER,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// ---------- Сиды: администратор и общая папка ----------
const hasAdmin = db.prepare(`SELECT id FROM users WHERE role='admin' LIMIT 1`).get();
if (!hasAdmin) {
  const hash = bcrypt.hashSync(config.adminPassword, 10);
  db.prepare(`INSERT INTO users (login, password_hash, role, quota_bytes) VALUES (?, ?, 'admin', ?)`)
    .run(config.adminLogin, hash, 100 * 1024 * 1024 * 1024); // админу — 100 ГБ
  console.log(`[seed] создан администратор "${config.adminLogin}"`);
}
const hasCommon = db.prepare(`SELECT id FROM folders WHERE is_common=1 AND parent_id IS NULL LIMIT 1`).get();
if (!hasCommon) {
  db.prepare(`INSERT INTO folders (owner_id, parent_id, name, is_common) VALUES (NULL, NULL, 'Общая папка', 1)`).run();
  console.log('[seed] создана общая папка');
}

// ---------- Хелперы ----------
export function q(sql, ...params) { return db.prepare(sql).all(...params); }
export function q1(sql, ...params) { return db.prepare(sql).get(...params); }
export function run(sql, ...params) { return db.prepare(sql).run(...params); }

export function audit(userId, action, targetType = null, targetId = null, meta = null) {
  run(`INSERT INTO audit (user_id, action, target_type, target_id, meta) VALUES (?,?,?,?,?)`,
    userId, action, targetType, targetId, meta ? JSON.stringify(meta) : null);
}
