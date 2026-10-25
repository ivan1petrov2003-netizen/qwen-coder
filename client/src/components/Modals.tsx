// Универсальная модалка + ввод имени (новая папка / переименование)
import React, { useEffect, useRef, useState } from 'react';

export function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'modal' + (wide ? ' viewer' : '')}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

export function PromptModal({ title, initial, onOk, onClose, okText = 'Создать' }: {
  title: string; initial: string; onOk: (v: string) => Promise<void> | void; onClose: () => void; okText?: string }) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const submit = async () => {
    if (!v.trim()) { setErr('Имя не может быть пустым'); return; }
    setBusy(true);
    try { await onOk(v.trim()); onClose(); }
    catch (e: any) { setErr(e.message || String(e)); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <div className="field"><input type="text" ref={ref} value={v}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()} autoFocus /></div>
      {err && <div className="err-text">{err}</div>}
      <div className="btn-row">
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={busy} onClick={submit}>{busy ? '…' : okText}</button>
      </div>
    </Modal>
  );
}

export function ConfirmModal({ title, text, onOk, onClose, danger }: {
  title: string; text: string; onOk: () => Promise<void>; onClose: () => void; danger?: boolean }) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await onOk(); onClose(); } catch (e: any) { setErr(e.message || String(e)); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ marginTop: 0 }}>{text}</p>
      {err && <div className="err-text">{err}</div>}
      <div className="btn-row">
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className={'btn primary' + (danger ? ' danger' : '')} disabled={busy} onClick={submit}>
          {busy ? '…' : 'ОК'}</button>
      </div>
    </Modal>
  );
}
