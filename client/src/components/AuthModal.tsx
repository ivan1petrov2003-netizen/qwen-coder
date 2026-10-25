// Окно входа/регистрации
import React, { useState } from 'react';
import { Modal } from './Modals';
import { useStore } from '../store';

export default function AuthModal({ onClose }: { onClose: () => void }) {
  const { login, register, toast } = useStore();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [l, setL] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setErr('');
    try {
      if (mode === 'login') await login(l.trim(), p);
      else await register(l.trim(), p);
      toast(mode === 'login' ? `Добро пожаловать, ${l.trim()}!` : 'Аккаунт создан — вход выполнен', 'ok');
      onClose();
    } catch (e: any) { setErr(e.message || String(e)); setBusy(false); }
  };

  return (
    <Modal title={mode === 'login' ? 'Вход в Облако' : 'Регистрация'} onClose={onClose}>
      <div className="field">
        <label>Логин</label>
        <input type="text" value={l} onChange={e => setL(e.target.value)} autoFocus
          onKeyDown={e => e.key === 'Enter' && submit()} placeholder={mode === 'register' ? 'например, masha' : ''} />
      </div>
      <div className="field">
        <label>Пароль</label>
        <input type="password" value={p} onChange={e => setP(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && submit()} />
      </div>
      {mode === 'register' && <p className="hint">После регистрации вы сразу попадёте в проводник. Данные текущего гостевого сеанса перенесутся в аккаунт.</p>}
      {err && <div className="err-text">{err}</div>}
      <div className="btn-row" style={{ justifyContent: 'space-between' }}>
        <button className="btn" style={{ border: 0, background: 'transparent', color: 'var(--accent)' }}
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(''); }}>
          {mode === 'login' ? 'Создать аккаунт →' : '← Уже есть аккаунт'}
        </button>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onClose}>Как гость</button>
          <button className="btn primary" disabled={busy} onClick={submit}>
            {busy ? '…' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
        </div>
      </div>
    </Modal>
  );
}
