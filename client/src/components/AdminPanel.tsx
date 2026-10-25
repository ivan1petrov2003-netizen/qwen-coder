// Панель администратора: сводка, пользователи, содержимое папок, журнал аудита
import React, { useEffect, useState, useCallback } from 'react';
import { Modal } from './Modals';
import { api, fmtSize, fmtDate } from '../api';
import { useStore } from '../store';

const ACTION_LABEL: Record<string, string> = {
  register: 'регистрация', login: 'вход', logout: 'выход',
  folder_create: 'создание папки', folder_update: 'изменение папки', folder_delete: 'удаление папки',
  file_upload: 'загрузка файла', file_update: 'изменение файла', file_delete: 'удаление файла',
  publish: 'публикация ссылки', unpublish: 'снятие публикации',
  invite: 'приглашение', invite_revoke: 'отзыв приглашения',
  trash_restore: 'восстановление из корзины', trash_remove: 'окончательное удаление', trash_empty: 'очистка корзины',
  admin_delete_user: 'удаление пользователя (админ)',
};

export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const { toast } = useStore();
  const [tab, setTab] = useState<'overview' | 'users' | 'audit'>('overview');
  const [ov, setOv] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [audit, setAuditList] = useState<any[]>([]);
  const [treeFor, setTreeFor] = useState<number | null>(null);
  const [tree, setTree] = useState<any[]>([]);
  const [contents, setContents] = useState<{ folderId: number; data: any } | null>(null);

  const load = useCallback(() => {
    api.get('/api/admin/overview').then(setOv).catch(e => toast(e.message, 'err'));
    api.get('/api/admin/users').then(d => setUsers(d.users)).catch(() => {});
    api.get('/api/admin/audit').then(d => setAuditList(d.entries)).catch(() => {});
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const openTree = async (uid: number) => {
    if (treeFor === uid) { setTreeFor(null); return; }
    setTreeFor(uid); setContents(null);
    try { const d = await api.get(`/api/admin/users/${uid}/folders`); setTree(d.roots); }
    catch (e: any) { toast(e.message, 'err'); }
  };
  const openFolder = async (fid: number) => {
    try { const d = await api.get(`/api/admin/folders/${fid}/contents`); setContents({ folderId: fid, data: d }); }
    catch (e: any) { toast(e.message, 'err'); }
  };
  const delUser = async (u: any) => {
    if (!confirm(`Удалить пользователя «${u.login}» со всеми файлами?`)) return;
    try { await api.del(`/api/admin/users/${u.id}`); toast(`Пользователь «${u.login}» удалён`, 'ok'); load(); }
    catch (e: any) { toast(e.message, 'err'); }
  };

  const renderTree = (nodes: any[], depth = 0): any => nodes.map(n => (
    <div key={n.id}>
      <div className="tree-folder" style={{ marginLeft: depth * 16 }} onClick={() => openFolder(n.id)}>
        📁 {n.name}{n.isCommon ? ' (общая)' : ''}
      </div>
      {n.children && renderTree(n.children, depth + 1)}
    </div>
  ));

  return (
    <Modal title="Панель администратора" onClose={onClose} wide>
      <div className="admin-tabs">
        <button className={'chip' + (tab === 'overview' ? ' active' : '')} onClick={() => setTab('overview')}>Сводка</button>
        <button className={'chip' + (tab === 'users' ? ' active' : '')} onClick={() => setTab('users')}>Пользователи</button>
        <button className={'chip' + (tab === 'audit' ? ' active' : '')} onClick={() => setTab('audit')}>Журнал действий</button>
      </div>

      {tab === 'overview' && ov && (
        <div className="stat-cards">
          <div className="stat-card"><div className="v">{ov.users}</div><div className="t">пользователей</div></div>
          <div className="stat-card"><div className="v">{ov.guests}</div><div className="t">гостевых сессий</div></div>
          <div className="stat-card"><div className="v">{ov.folders}</div><div className="t">папок</div></div>
          <div className="stat-card"><div className="v">{ov.files}</div><div className="t">файлов</div></div>
          <div className="stat-card"><div className="v">{fmtSize(ov.bytes)}</div><div className="t">занято на диске</div></div>
        </div>
      )}

      {tab === 'users' && (
        <>
          <table className="adm">
            <thead><tr><th>Логин</th><th>Роль</th><th>Занято</th><th>Квота</th><th>Прогресс</th><th>Создан</th><th></th></tr></thead>
            <tbody>{users.map(u => (
              <tr key={u.id}>
                <td>{u.login}</td><td>{u.role}</td><td>{fmtSize(u.usedBytes)}</td><td>{fmtSize(u.quotaBytes)}</td>
                <td style={{ width: 90 }}><div className="progress"><i style={{ width: `${Math.min(100, u.usedBytes / Math.max(1, u.quotaBytes) * 100)}%` }} /></div></td>
                <td>{fmtDate(u.createdAt)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn" style={{ padding: '2px 9px' }} onClick={() => openTree(u.id)}>
                    {treeFor === u.id ? 'Скрыть' : 'Папки'}</button>{' '}
                  {u.role !== 'admin' && <button className="btn danger" style={{ padding: '2px 9px' }} onClick={() => delUser(u)}>Удалить</button>}
                </td>
              </tr>))}
            </tbody>
          </table>
          {treeFor != null && <div style={{ marginTop: 10 }} className="share-tree">{renderTree(tree)}</div>}
          {contents && (
            <div style={{ marginTop: 10 }} className="share-tree">
              <b>Содержимое: {contents.data.folder.name}</b>
              <table className="adm">
                <thead><tr><th>Имя</th><th>Тип</th><th>Размер</th></tr></thead>
                <tbody>
                  {contents.data.subfolders.map((f: any) => <tr key={'f' + f.id}><td>📁 {f.name}</td><td>папка</td><td>—</td></tr>)}
                  {contents.data.files.map((f: any) => <tr key={'i' + f.id}><td>📄 {f.name}</td><td>{f.kind}</td><td>{fmtSize(f.size)}</td></tr>)}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'audit' && (
        <table className="adm">
          <thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Объект</th><th>Детали</th></tr></thead>
          <tbody>{audit.map(a => (
            <tr key={a.id}><td>{fmtDate(a.createdAt)}</td><td>{a.userLogin}</td>
              <td>{ACTION_LABEL[a.action] || a.action}</td>
              <td>{a.targetType} #{a.targetId ?? '—'}</td>
              <td style={{ color: 'var(--text-dim)' }}>{a.meta || ''}</td></tr>))}
          </tbody>
        </table>
      )}
      <div className="btn-row"><button className="btn" onClick={onClose}>Закрыть</button></div>
    </Modal>
  );
}
