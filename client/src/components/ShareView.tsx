// Публичная страница по ссылке: пароль → дерево папки → просмотр/скачивание
import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtSize } from '../api';
import { useStore } from '../store';

interface ShareNode { folders: { id: number; name: string; path: string; children: any }[]; files: any[] }

function TreeNode({ node, depth, onPreview }: { node: ShareNode; depth: number; onPreview: (f: any) => void }) {
  const [open, setOpen] = useState(depth === 0);
  return (
    <div className="tree-node">
      {depth > 0 && (
        <div className="tree-folder" style={{ marginLeft: depth * 18 }} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} 📁 {node.name}
        </div>)}
      {open && (
        <>
          <div style={{ marginLeft: (depth + 1) * 18 }}>
            {(node.files || []).map((f: any) => (
              <div className="tree-file" key={f.id} onDoubleClick={() => (f.kind === 'image' || f.kind === 'video') && onPreview(f)}>
                {f.kind === 'image' ? '🖼' : f.kind === 'video' ? '🎬' : '📄'} {f.name}
                <span style={{ color: 'var(--text-dim)' }}>{fmtSize(f.size)}</span>
                {(f.kind === 'image' || f.kind === 'video') &&
                  <button className="btn" style={{ padding: '1px 9px' }} onClick={() => onPreview(f)}>Открыть</button>}
                <a className="btn" style={{ padding: '1px 9px', textDecoration: 'none' }} href={f.downloadUrl}>Скачать</a>
              </div>))}
          </div>
          {(node.folders || []).map((sf: any) =>
            <TreeNode key={sf.id} depth={depth + 1} onPreview={onPreview}
              node={{ ...sf.children, name: sf.name }} />)}
        </>)}
    </div>
  );
}

export default function ShareView({ token }: { token: string }) {
  const { toast } = useStore();
  const [state, setState] = useState<'loading' | 'password' | 'ready' | 'error'>('loading');
  const [name, setName] = useState('');
  const [data, setData] = useState<ShareNode | null>(null);
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<any>(null);

  const loadContents = () => api.get(`/api/share/${token}/contents`).then(d => { setData(d); setState('ready'); });

  useEffect(() => {
    api.get(`/api/share/${token}/info`).then(async (info: any) => {
      setName(info.name);
      if (info.needPassword) setState('password');
      else await loadContents();
    }).catch(e => { setErr(e.message); setState('error'); });
  }, [token]);

  const unlock = async () => {
    setErr('');
    try { await api.post(`/api/share/${token}/unlock`, { password: pwd }); await loadContents(); }
    catch (e: any) { setErr(e.message || String(e)); }
  };

  return (
    <div className="win share-page">
      <div className="titlebar">
        <div className="logo">☁️ Облако — публичная папка{state === 'ready' ? `: ${name}` : ''}</div>
        <div className="tb-btns" style={{ marginLeft: 'auto' }}>
          <button className="tb-btn" onClick={() => { location.href = '/'; }} title="В проводник">🏠</button>
        </div>
      </div>
      <div className="win-body" style={{ flexDirection: 'column', padding: 16, overflow: 'auto' }}>
        {state === 'loading' && <div className="empty">Загрузка…</div>}
        {state === 'error' && <div className="empty">⚠️ {err}</div>}
        {state === 'password' && (
          <div style={{ maxWidth: 340, margin: '40px auto' }}>
            <h3 style={{ marginTop: 0 }}>🔒 Папка защищена паролем</h3>
            <div className="field"><input type="password" placeholder="Пароль" value={pwd} autoFocus
              onChange={e => setPwd(e.target.value)} onKeyDown={e => e.key === 'Enter' && unlock()} /></div>
            {err && <div className="err-text">{err}</div>}
            <button className="btn primary" onClick={unlock}>Открыть</button>
          </div>
        )}
        {state === 'ready' && data && (
          <div className="share-tree">
            <TreeNode depth={-1} node={{ ...data, name } as any} onPreview={setPreview} />
          </div>
        )}
      </div>
      {preview && (
        <div className="overlay" onMouseDown={e => e.target === e.currentTarget && setPreview(null)}>
          <div className="modal viewer">
            <h3>{preview.name}</h3>
            {preview.kind === 'image'
              ? <img src={preview.previewUrl} alt={preview.name} />
              : <video src={preview.previewUrl} controls autoPlay />}
            <div className="btn-row">
              <a className="btn" href={preview.downloadUrl}>Скачать</a>
              <button className="btn" onClick={() => setPreview(null)}>Закрыть</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
