// Публикация папки по ссылке + приглашения пользователей
import React, { useEffect, useState } from 'react';
import { Modal } from './Modals';
import { api } from '../api';
import { useStore } from '../store';

const PERM_LABEL: Record<string, string> = { view: 'Просмотр', read: 'Чтение', write: 'Запись' };

export default function ShareDialog({ folderId, folderName, onClose }: {
  folderId: number; folderName: string; onClose: () => void }) {
  const { me, toast, loadShared } = useStore();
  // --- публикация ---
  const [link, setLink] = useState<any>(null);
  const [pwd, setPwd] = useState('');
  const [usePwd, setUsePwd] = useState(false);
  // --- приглашения ---
  const [invLogin, setInvLogin] = useState('');
  const [invPerm, setInvPerm] = useState('read');
  const [invites, setInvites] = useState<any[]>([]);
  const [err, setErr] = useState('');

  const isOwner = !!(me && !me.isGuest);
  const fullUrl = link ? `${location.origin}${link.url}` : '';

  const loadLink = () => { /* ссылка создаётся по запросу */ };
  useEffect(() => { loadLink(); }, []);
  useEffect(() => {
    if (isOwner) api.get('/api/share/invites').then(d =>
      setInvites((d.sent || []).filter((i: any) => i.folderId === folderId))).catch(() => {});
  }, [folderId, isOwner]);

  const publish = async () => {
    setErr('');
    try {
      const d = await api.post('/api/share/publish', { folderId, password: usePwd && pwd ? pwd : undefined });
      setLink(d.link); toast('Ссылка опубликована', 'ok');
    } catch (e: any) { setErr(e.message || String(e)); }
  };
  const unpublish = async () => {
    try { await api.post('/api/share/unpublish', { folderId }); setLink(null); toast('Публикация отключена', 'ok'); }
    catch (e: any) { toast(e.message || String(e), 'err'); }
  };
  const invite = async () => {
    setErr('');
    if (!invLogin.trim()) return;
    try {
      await api.post('/api/share/invite', { folderId, login: invLogin.trim(), permission: invPerm });
      toast(`Приглашён «${invLogin.trim()}» (${PERM_LABEL[invPerm]})`, 'ok');
      setInvLogin(''); loadShared();
      const d = await api.get('/api/share/invites');
      setInvites((d.sent || []).filter((i: any) => i.folderId === folderId));
    } catch (e: any) { setErr(e.message || String(e)); }
  };
  const revoke = async (id: number) => {
    try { await api.del(`/api/share/invite/${id}`); setInvites(v => v.filter(i => i.id !== id)); toast('Приглашение отозвано', 'ok'); }
    catch (e: any) { toast(e.message || String(e), 'err'); }
  };

  return (
    <Modal title={` Поделиться: ${folderName}`} onClose={onClose}>
      <div className="field">
        <label>Публичная ссылка (только просмотр и скачивание)</label>
        {!link ? (
          <>
            <div className="set-row" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 13 }}>Защитить паролем</span>
              <div className={'switch' + (usePwd ? ' on' : '')} onClick={() => setUsePwd(!usePwd)} />
            </div>
            {usePwd && <input type="password" placeholder="Пароль по ссылке" value={pwd} onChange={e => setPwd(e.target.value)} />}
            <div className="btn-row" style={{ marginTop: 8 }}><button className="btn primary" onClick={publish}>Опубликовать ссылку</button></div>
          </>
        ) : (
          <>
            <div className="link-copy">
              <input type="text" readOnly value={fullUrl} onFocus={e => e.target.select()} />
              <button className="btn" onClick={() => { navigator.clipboard?.writeText(fullUrl).then(() => toast('Ссылка скопирована', 'ok')).catch(() => {}); }}>Копировать</button>
            </div>
            <div className="btn-row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
              <span className="hint">{link.hasPassword ? 'с паролем' : 'без пароля'}</span>
              <button className="btn danger" onClick={unpublish}>Отключить ссылку</button>
            </div>
          </>
        )}
      </div>

      {isOwner ? (
        <div className="field">
          <label>Пригласить пользователя по логину</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type="text" placeholder="логин" value={invLogin} onChange={e => setInvLogin(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && invite()} style={{ flex: 1 }} />
            <select value={invPerm} onChange={e => setInvPerm(e.target.value)} style={{ width: 120 }}>
              <option value="view">Просмотр</option><option value="read">Чтение</option><option value="write">Запись</option>
            </select>
            <button className="btn primary" onClick={invite}>Пригласить</button>
          </div>
          {invites.length > 0 && (
            <table className="adm" style={{ marginTop: 10 }}>
              <thead><tr><th>Пользователь</th><th>Права</th><th></th></tr></thead>
              <tbody>{invites.map(i => (
                <tr key={i.id}><td>{i.inviteeLogin}</td>
                  <td>{PERM_LABEL[i.permission]}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn" style={{ padding: '2px 10px' }} onClick={() => revoke(i.id)}>Отозвать</button></td></tr>))}
              </tbody>
            </table>
          )}
          <p className="hint">Смена прав — пригласите тот же логин с новым правом. «Запись»: добавлять, изменять, удалять.</p>
        </div>
      ) : (
        <p className="hint">Приглашения доступны только владельцу папки из авторизованного аккаунта.</p>
      )}
      {err && <div className="err-text">{err}</div>}
      <div className="btn-row"><button className="btn" onClick={onClose}>Закрыть</button></div>
    </Modal>
  );
}
