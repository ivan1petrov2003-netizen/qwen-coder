// Настройки внешнего вида: сохраняются только для авторизованных
import { Router } from 'express';
import { q1, run } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

router.get('/', (req, res) => {
  if (req.isGuest) return res.json({ settings: null });
  const row = q1(`SELECT data FROM settings WHERE user_id=?`, req.user.id);
  res.json({ settings: row ? JSON.parse(row.data) : null });
});

router.patch('/', requireAuth, (req, res) => {
  const data = req.body || {};
  const json = JSON.stringify(data).slice(0, 20000);
  run(`INSERT INTO settings (user_id, data) VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data`,
    req.user.id, json);
  res.json({ ok: true });
});

export default router;
