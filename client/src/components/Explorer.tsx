// Проводник Windows 11: тайтлбар, вкладки, боковая панель, тулбар с хлебными крошками,
// содержимое (сетка/список), drag&drop-загрузка, горячие клавиши, контекстные меню.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, fmtSize, FolderDto, FileDto, ContentsDto } from '../api';
import { useStore } from '../store';
import FileGrid, { ContextMenu, MenuState, Viewer } from './FileGrid';
import { PromptModal, ConfirmModal } from './Modals';
import AuthModal from './AuthModal';
import ShareDialog from './ShareDialog';
import SettingsPanel from './SettingsPanel';
import AdminPanel from './AdminPanel';

// ---------- Вкладки ----------
type TabKind = 'pinned' | 'folder' | 'trash' | 'search' | 'aggregate';
interface Tab {
  id: number;
  kind: TabKind;
  title: string;
  pinned?: boolean;
  folderId?: number;      // обычная папка
  aggKind?: string;       // aggregate: image|video|media|recent
  target?: 'root' | 'common'; // special roots
  query?: string;         // search
}
let tabSeq = 0;
const mkTab = (t: Omit<Tab, 'id'>): Tab => ({ id: ++tabSeq, ...t });

const PINNED: Tab[] = [
  mkTab({ kind: 'aggregate', aggKind: 'recent', title: 'Главная', pinned: true }),
  mkTab({ kind: 'aggregate', aggKind: 'media', title: 'Галерея', pinned: true }),
];
const QUICK: Tab[] = [
  mkTab({ kind: 'folder', title: 'Загрузки' }),
  mkTab({ kind: 'folder', title: 'Документы' }),
  mkTab({ kind: 'aggregate', aggKind: 'image', title: 'Изображения' }),
  mkTab({ kind: 'aggregate', aggKind: 'video', title: 'Видео' }),
];

interface Content {
  loading: boolean;
  error?: string;
  contents?: ContentsDto;          // для folder/root/common/trash-parent
  files?: FileDto[];               // для aggregate/search
  subfolders?: (FolderDto & { path?: string })[];
  trashFiles?: FileDto[];
  trashFolders?: FolderDto[];
}

export default function Explorer() {
  const { me, toast, sharedWithMe } = useStore();
  const isAdmin = !!me?.isAdmin;

  // --- вкладки ---
  const initialTabs = useMemo(() => [...PINNED, mkTab({ kind: 'folder', title: 'Мои файлы', target: 'root' })], []);
  const [tabs, setTabs] = useState<Tab[]>(initialTabs);
  const [activeId, setActiveId] = useState<number>(initialTabs[2].id);
  const activeTab = tabs.find(t => t.id === activeId) ?? tabs[0];

  // --- содержимое активной вкладки ---
  const [content, setContent] = useState<Content>({ loading: true });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [dragOver, setDragOver] = useState(false);

  // --- меню/модалки ---
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; initial: string; onOk: (v: string) => Promise<void> } | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; text: string; danger?: boolean; onOk: () => Promise<void> } | null>(null);
  const [shareTarget, setShareTarget] = useState<{ id: number; name: string } | null>(null);
  const [viewer, setViewer] = useState<{ file: FileDto; href: string } | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [moveSrc, setMoveSrc] = useState<{ kind: 'file' | 'folder'; item: any } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const contentReq = useRef(0);

  // ---------- загрузка содержимого ----------
  const load = useCallback(async (tab: Tab) => {
    const req = ++contentReq.current;
    setContent(c => ({ ...c, loading: true }));
    setSelected(new Set());
    try {
      if (tab.kind === 'aggregate') {
        const d = await api.get(`/api/folders/aggregate?kind=${tab.aggKind}`);
        if (req !== contentReq.current) return;
        setContent({ loading: false, files: d.files.map((f: FileDto) => ({ ...f, downloadUrl: `/api/files/${f.id}/download`, previewUrl: `/api/files/${f.id}/preview` })) });
      } else if (tab.kind === 'search') {
        const d = await api.get(`/api/folders/search?q=${encodeURIComponent(tab.query || '')}`);
        if (req !== contentReq.current) return;
        setContent({ loading: false, subfolders: d.folders, files: d.files });
      } else if (tab.kind === 'trash') {
        const d = await api.get('/api/folders/trash');
        if (req !== contentReq.current) return;
        setContent({ loading: false, trashFiles: d.files, trashFolders: d.folders });
      } else { // folder / root / common
        const url = tab.target === 'root' ? '/api/folders/root' : tab.target === 'common' ? '/api/folders/common' : `/api/folders/${tab.folderId}`;
        const d: ContentsDto = await api.get(url);
        if (req !== contentReq.current) return;
        if ((d as any).error) throw new Error((d as any).error);
        setContent({ loading: false, contents: d });
        // обновим название вкладки по последнему элементу пути
        const last = d.breadcrumb[d.breadcrumb.length - 1];
        if (last && !tab.pinned) setTabs(ts => ts.map(t => t.id === tab.id ? { ...t, title: last.name, folderId: last.id } : t));
      }
    } catch (e: any) {
      if (req !== contentReq.current) return;
      setContent({ loading: false, error: e.message || String(e) });
    }
  }, []);

  useEffect(() => { if (activeTab) load(activeTab); }, [activeId]); // eslint-disable-line

  const reload = () => activeTab && load(activeTab);

  // ---------- открытие вкладок ----------
  const openTab = (t: Omit<Tab, 'id'>) => {
    // если такое представление уже открыто — активируем
    const ex = tabs.find(x => x.title === t.title && x.kind === t.kind && x.folderId === t.folderId && x.aggKind === t.aggKind && x.target === t.target);
    if (ex) { setActiveId(ex.id); return; }
    const nt = mkTab(t);
    setTabs(ts => [...ts, nt]);
    setActiveId(nt.id);
  };
  const openFolder = (f: FolderDto) => openTab({ kind: 'folder', title: f.name, folderId: f.id });
  const closeTab = (id: number) => {
    setTabs(ts => {
      const idx = ts.findIndex(t => t.id === id);
      const next = ts.filter(t => t.id !== id);
      if (!next.length) return ts;
      if (id === activeId) setActiveId(next[Math.max(0, idx - 1)].id);
      return next;
    });
  };

  // ---------- права текущей папки ----------
  const curFolder = content.contents?.folder;
  const canWrite = !!curFolder && ['owner', 'write', 'common'].includes(curFolder.access || '');
  const isTrash = activeTab?.kind === 'trash';

  // ---------- действия ----------
  const doDeleteFile = async (f: FileDto) => {
    try { await api.del(`/api/files/${f.id}`); toast(`«${f.name}» перемещён в корзину`, 'ok'); reload(); }
    catch (e: any) { toast(e.message || String(e), 'err'); }
  };
  const doDeleteFolder = async (d: FolderDto) => {
    try { await api.del(`/api/folders/${d.id}`); toast(`Папка «${d.name}» перемещена в корзину`, 'ok'); reload(); }
    catch (e: any) { toast(e.message || String(e), 'err'); }
  };
  const newFolder = () => {
    if (!canWrite || !curFolder) return toast('Нельзя создавать папки здесь', 'err');
    setPrompt({ title: 'Новая папка', initial: 'Новая папка', onOk: async (name) => {
      await api.post('/api/folders', { parentId: curFolder.id, name });
      toast(`Папка «${name}» создана`, 'ok'); reload();
    }});
  };
  const rename = (kind: 'file' | 'folder', item: any) => {
    setPrompt({ title: 'Переименовать', initial: item.name, okTextCustom: undefined as any, onOk: async (name) => {
      if (kind === 'file') await api.patch(`/api/files/${item.id}`, { name });
      else await api.patch(`/api/folders/${item.id}`, { name });
      toast('Переименовано', 'ok'); reload();
    }} as any);
  };
  const uploadHere = async (files: FileList | File[]) => {
    if (!curFolder) return;
    if (!canWrite) return toast('Нет прав на запись в эту папку', 'err');
    try {
      const d = await api.upload(curFolder.id, files);
      toast(`Загружено файлов: ${d.uploaded?.length ?? Array.from(files).length}`, 'ok');
      reload();
    } catch (e: any) { toast(e.message || String(e), 'err'); }
  };
  const restore = async (type: 'file' | 'folder', id: number) => {
    try { await api.post('/api/folders/trash/restore', { type, id }); toast('Восстановлено', 'ok'); reload(); }
    catch (e: any) { toast(e.message || String(e), 'err'); }
  };
  const removeForever = async (type: 'file' | 'folder', id: number) => {
    try { await api.post('/api/folders/trash/remove', { type, id }); toast('Удалено навсегда', 'ok'); reload(); }
    catch (e: any) { toast(e.message || String(e), 'err'); }
  };
  const emptyTrash = () => setConfirm({ title: 'Очистить корзину', text: 'Все элементы в корзине будут удалены безвозвратно.', danger: true,
    onOk: async () => { await api.post('/api/folders/trash/empty'); toast('Корзина очищена', 'ok'); reload(); } });

  // выбор папки назначения для перемещения
  const moveTo = async (destId: number) => {
    if (!moveSrc) return;
    try {
      if (moveSrc.kind === 'file') await api.patch(`/api/files/${moveSrc.item.id}`, { folderId: destId });
      else await api.patch(`/api/folders/${moveSrc.item.id}`, { parentId: destId });
      toast('Перемещено', 'ok');
    } catch (e: any) { toast(e.message || String(e), 'err'); }
    setMoveSrc(null); reload();
  };

  // выделение всех выбранных -> удаление
  const deleteSelected = () => {
    if (!selected.size) return;
    const items = [...selected];
    setConfirm({ title: 'Удалить выделенное', text: `Элементов: ${items.length}. Переместить в корзину?`, danger: true,
      onOk: async () => {
        for (const k of items) {
          const id = Number(k.slice(1));
          try { if (k[0] === 'f') await api.del(`/api/files/${id}`); else await api.del(`/api/folders/${id}`); }
          catch (e: any) { toast(e.message || String(e), 'err'); }
        }
        toast('Перемещено в корзину', 'ok'); reload();
      }});
  };
  const renameSelected = () => {
    if (selected.size !== 1) return;
    const k = [...selected][0];
    const id = Number(k.slice(1));
    const item = k[0] === 'f' ? content.files?.find(f => f.id === id) ?? content.contents?.files.find(f => f.id === id)
                              : content.subfolders?.find(d => d.id === id) ?? content.contents?.subfolders.find(d => d.id === id);
    if (item) rename(k[0] as 'file' | 'folder', item);
  };

  // ---------- контекстное меню ----------
  const onContext = (e: React.MouseEvent, kind: 'file' | 'folder', item: any) => {
    e.preventDefault();
    const key = (kind === 'file' ? 'f' : 'd') + item.id;
    if (!selected.has(key)) setSelected(new Set([key]));
    const items: MenuState['items'] = [];
    if (isTrash) {
      items.push({ label: '↩️ Восстановить', onClick: () => restore(kind, item.id) });
      items.push({ label: '❌ Удалить навсегда', danger: true, onClick: () => removeForever(kind, item.id) });
    } else if (kind === 'folder') {
      items.push({ label: '📂 Открыть', onClick: () => activeTab?.target ? navigate(item.id) : openFolder(item) });
      if (canWrite) items.push({ label: '✏️ Переименовать (F2)', onClick: () => rename('folder', item) });
      if (canWrite && item.ownerId === me?.user.id) items.push({ label: '🔗 Поделиться…', onClick: () => setShareTarget({ id: item.id, name: item.name }) });
      if (canWrite && item.ownerId === me?.user.id) items.push({ label: '📦 Переместить в…', onClick: () => { setMoveSrc({ kind: 'folder', item }); navigate(item.parentId ?? me!.rootFolderId!); } });
      if (canWrite) items.push({ label: '⬇️ Скачать ZIP', onClick: () => { location.href = `/api/folders/${item.id}/download-zip`; } });
      if (canWrite) items.push({ label: '🗑️ Удалить (Delete)', danger: true, onClick: () => doDeleteFolder(item) });
    } else {
      items.push({ label: '👁️ Открыть', onClick: () => openFile(item) });
      items.push({ label: '⬇️ Скачать', onClick: () => { location.href = `/api/files/${item.id}/download`; } });
      if (canWrite && item.ownerId === me?.user.id) items.push({ label: '✏️ Переименовать (F2)', onClick: () => rename('file', item) });
      if (canWrite && item.ownerId === me?.user.id) items.push({ label: '📦 Переместить в…', onClick: () => { setMoveSrc({ kind: 'file', item }); navigate(me!.rootFolderId!); } });
      if (canWrite && item.ownerId === me?.user.id) items.push({ label: '🗑️ Удалить (Delete)', danger: true, onClick: () => doDeleteFile(item) });
    }
    if (!items.length) items.push({ label: 'Нет доступных действий', onClick: () => {} });
    setMenu({ x: e.clientX, y: e.clientY, items });
  };
  const onBackgroundContext = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.item, .list-row')) return;
    e.preventDefault();
    const items: MenuState['items'] = [];
    if (isTrash) items.push({ label: '🧹 Очистить корзину', danger: true, onClick: emptyTrash });
    if (canWrite) {
      items.push({ label: '🆕 Создать папку (Ctrl+N)', onClick: newFolder });
      items.push({ label: '⬆️ Загрузить файлы…', onClick: () => fileInputRef.current?.click() });
    }
    if (!items.length) return;
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const navigate = (folderId: number) => {
    setTabs(ts => ts.map(t => t.id === activeId ? { ...t, kind: 'folder', folderId, target: undefined, title: '…' } : t));
    const t = tabs.find(x => x.id === activeId)!;
    load({ ...t, kind: 'folder', folderId, target: undefined });
    // если идёт перемещение — завершаем его в этой папке
    if (moveSrc) { /* подтверждение через баннер сверху */ }
  };

  const openFile = (f: FileDto) => {
    const base = activeTab?.kind === 'aggregate' || activeTab?.kind === 'search' || isTrash;
    const href = f.downloadUrl || `/api/files/${f.id}/download`;
    const prev = f.previewUrl || `/api/files/${f.id}/preview`;
    if (base && (f.kind === 'image' || f.kind === 'video')) setViewer({ file: f, href: prev });
    else if (f.kind === 'image' || f.kind === 'video') setViewer({ file: f, href: prev });
    else if (base) setViewer({ file: f, href: prev });
    else location.href = href;
  };

  // ---------- drag & drop ----------
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files?.length) uploadHere(e.dataTransfer.files);
  };

  // ---------- горячие клавиши ----------
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newFolder(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); searchRef.current?.focus(); }
      else if (!typing && e.key === 'Delete') { e.preventDefault(); deleteSelected(); }
      else if (!typing && e.key === 'F2') { e.preventDefault(); renameSelected(); }
      else if (e.key === 'Escape') { setMenu(null); setViewer(null); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // ---------- поиск ----------
  const doSearch = (q: string) => {
    if (!q.trim()) return;
    openTab({ kind: 'search', title: `Поиск: ${q}`, query: q.trim() });
  };

  // ---------- рендер ----------
  const crumbs = content.contents?.breadcrumb ?? [];
  const selCount = selected.size;

  return (
    <div className="win" onDragOver={e => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
      onDragLeave={e => { if (e.currentTarget === e.target) setDragOver(false); }} onDrop={onDrop}>
      {/* Тайтлбар */}
      <div className="titlebar">
        <div className="logo"><CloudLogo /> Облако</div>
        <div className="searchbox">
          <span style={{ opacity: .6 }}>🔍</span>
          <input ref={searchRef} placeholder="Поиск по Облаку  (Ctrl+F)"
            onKeyDown={e => e.key === 'Enter' && doSearch((e.target as HTMLInputElement).value)} />
        </div>
        <div className="tb-btns">
          {me?.isGuest && <button className="btn ghost-sm" onClick={() => setShowAuth(true)}>Войти</button>}
          {me && !me.isGuest && (
            <div className="user-chip" onClick={() => setShowAuth(true)} title={`${me.user.login} · клик — выйти`}>
              👤 {me.user.login}{isAdmin ? ' (админ)' : ''}
            </div>)}
          {isAdmin && <button className="tb-btn" title="Администрирование" onClick={() => setShowAdmin(true)}>🛡️</button>}
          <button className="tb-btn" title="Персонализация" onClick={() => setShowSettings(true)}>🎨</button>
          <button className="tb-btn" title="Свернуть">—</button>
          <button className="tb-btn" title="Развернуть">▢</button>
          <button className="tb-btn close" title="Закрыть" onClick={() => toast('Приятного дня! Окно проводника не закрывается 🙂', 'info')}>✕</button>
        </div>
      </div>

      {/* Вкладки */}
      <div className="tabstrip">
        {PINNED.map(t => renderTab(t))}
        {QUICK.map(t => renderTab({ ...t, pinned: true }))}
        {mkQuickSpecial()}
        {tabs.filter(t => !t.pinned).map(t => renderTab(t))}
        <button className="tab-add" title="Новая вкладка (мои файлы)"
          onClick={() => openTab({ kind: 'folder', title: 'Мои файлы', target: 'root' })}>＋</button>
      </div>

      <div className="win-body">
        {/* Боковая панель */}
        <aside className="sidebar">
          <div className="side-title">Быстрый доступ</div>
          {PINNED.map(t => renderSide(t))}
          {QUICK.slice(0, 2).map(t => renderSide({ ...t, target: undefined, folderId: undefined }))}
          <div className="side-item" onClick={() => openSystem('Загрузки')}><span className="ico">⬇️</span>Загрузки</div>
          <div className="side-item" onClick={() => openSystem('Документы')}><span className="ico">📄</span>Документы</div>
          {QUICK.slice(2).map(t => renderSide(t))}
          <div className="side-item" onClick={() => openTab({ kind: 'folder', title: 'Общая папка', target: 'common' })}>
            <span className="ico">🌍</span>Общая папка</div>
          <div className="side-item" onClick={() => openTab({ kind: 'trash', title: 'Корзина' })}>
            <span className="ico">🗑️</span>Корзина</div>

          {!!sharedWithMe.length && (<><div className="side-title">Доступно другим… → от других</div>
            {sharedWithMe.map(s => (
              <div key={s.folderId} className="side-item" onClick={() => openFolder({ id: s.folderId, name: s.name } as FolderDto)}>
                <span className="ico">🤝</span>{s.name}</div>))}</>)}

          <div className="side-title">Учётная запись</div>
          {me && !me.isGuest ? (
            <>
              <div className="side-info">{me.user.login}</div>
              <div className="quota-box">
                <QuotaBar />
              </div>
              <div className="side-item" onClick={() => { api.post('/api/auth/logout').then(() => window.location.reload()); }}>
                <span className="ico">🚪</span>Выйти</div>
            </>) : (
            <div className="side-item" onClick={() => setShowAuth(true)}><span className="ico">👤</span>Войти / зарегистрироваться</div>)}
        </aside>

        {/* Основная область */}
        <section className="main-pane">
          <div className="toolbar">
            <button className="tbtn" disabled={!crumbs.length || content.contents?.folder.parentId == null}
              onClick={() => { const p = content.contents?.folder.parentId; if (p) navigate(p); else if (curFolder?.parentId == null) reload(); }}>←</button>
            <button className="tbtn" title="Обновить" onClick={reload}>⟳</button>
            <div className="crumbs">
              {crumbs.map((c, i) => (
                <React.Fragment key={c.id}>
                  {i > 0 && <span className="crumb-sep">›</span>}
                  <span className="crumb" onClick={() => navigate(c.id)}>{c.isCommon ? '🌍 ' : ''}{c.name}</span>
                </React.Fragment>))}
              {!crumbs.length && <span className="crumb">{activeTab?.title}</span>}
            </div>
            <div style={{ flex: 1 }} />
            {selCount > 0 && <span style={{ fontSize: 12, opacity: .8 }}>Выбрано: {selCount}</span>}
            <button className="tbtn" disabled={!canWrite} onClick={newFolder} title="Новая папка (Ctrl+N)">🆕 Новая папка</button>
            <button className="tbtn" disabled={!canWrite} onClick={() => fileInputRef.current?.click()} title="Загрузить файлы">⬆️ Передать</button>
            {isTrash && <button className="tbtn" onClick={emptyTrash}>🧹 Очистить корзину</button>}
            <button className="tbtn" onClick={() => setView(v => v === 'grid' ? 'list' : 'grid')} title="Вид">{view === 'grid' ? '☰' : '▦'}</button>
          </div>

          {moveSrc && (
            <div className="drop-hint">
              📦 Перемещение: «{moveSrc.item.name}» — откройте папку-назначение и нажмите{' '}
              <button className="btn primary sm" onClick={() => curFolder && moveTo(curFolder.id)}>Переместить сюда</button>{' '}
              <button className="btn sm" onClick={() => setMoveSrc(null)}>Отмена</button>
            </div>)}

          <div className="content" onMouseDown={() => setMenu(null)}>
            {content.loading && <div className="empty">Загрузка…</div>}
            {content.error && <div className="empty">⚠️ {content.error}</div>}
            {!content.loading && !content.error && (
              <FileGrid
                view={view}
                subfolders={content.subfolders ?? content.contents?.subfolders ?? []}
                files={content.files ?? content.contents?.files ?? []}
                selected={selected}
                canWrite={canWrite}
                previewUrl={f => f.previewUrl || `/api/files/${f.id}/preview`}
                onOpenFolder={(d) => { if (moveSrc && curFolder) { /* показываем переход */ openFolder(d); } else openFolder(d); }}
                onOpenFile={openFile}
                onSelect={(k, multi) => setSelected(s => {
                  if (!multi) return s.has(k) && s.size === 1 ? new Set() : new Set([k]);
                  const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n;
                })}
                onContext={onContext}
                onBackgroundContext={onBackgroundContext}
              />)}
            {isTrash && !content.loading && ((content.trashFiles?.length || content.trashFolders?.length) ? (
              <div className="trash-cols">
                <FileGrid view={view} subfolders={content.trashFolders ?? []} files={[]} selected={selected} canWrite
                  previewUrl={f => `/api/files/${f.id}/preview`}
                  onOpenFolder={() => {}} onOpenFile={() => {}} onSelect={() => {}}
                  onContext={(e, _k, it) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: [
                    { label: '↩️ Восстановить', onClick: () => restore('folder', it.id) },
                    { label: '❌ Удалить навсегда', danger: true, onClick: () => removeForever('folder', it.id) }] }); }}
                  onBackgroundContext={onBackgroundContext} />
                <FileGrid view={view} subfolders={[]} files={content.trashFiles ?? []} selected={selected} canWrite
                  previewUrl={f => `/api/files/${f.id}/preview`}
                  onOpenFolder={() => {}} onOpenFile={() => {}} onSelect={() => {}}
                  onContext={(e, _k, it) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, items: [
                    { label: '↩️ Восстановить', onClick: () => restore('file', it.id) },
                    { label: '❌ Удалить навсегда', danger: true, onClick: () => removeForever('file', it.id) }] }); }}
                  onBackgroundContext={onBackgroundContext} />
              </div>) : <div className="empty">🗑️ Корзина пуста</div>)}
            {isTrash && !content.loading && !(content.trashFiles?.length || content.trashFolders?.length) && null}
            {!isTrash && !content.loading && !content.error &&
              !(content.subfolders?.length ?? content.contents?.subfolders.length ?? 0) &&
              !(content.files?.length ?? content.contents?.files.length ?? 0) && (
              <div className="empty">Здесь пока пусто.{canWrite ? ' Создайте папку или перетащите файлы (Ctrl+N).' : ''}</div>)}
            {dragOver && <div className="drop-overlay">⬆️ Отпустите файлы для загрузки в «{curFolder?.name ?? 'текущую папку'}»</div>}
          </div>

          <div className="statusbar">
            <span>{(content.files?.length ?? content.contents?.files.length ?? 0) + (content.trashFiles?.length ?? 0)} файлов ·
              {' '}{fmtSize((content.files ?? content.contents?.files ?? []).reduce((a, f) => a + f.size, 0))}</span>
            <span>{me?.isGuest ? 'Гостевой режим — данные живут на сервере до выхода' : `Вы вошли как ${me?.user.login}`}</span>
          </div>
        </section>
      </div>

      {/* Скрытый input для загрузки */}
      <input ref={fileInputRef} type="file" multiple hidden onChange={e => { e.target.files && uploadHere(e.target.files); e.target.value = ''; }} />

      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {viewer && <Viewer file={viewer.file} url={viewer.href} onClose={() => setViewer(null)}
        downloadHref={viewer.file.downloadUrl || `/api/files/${viewer.file.id}/download`} />}
      {prompt && <PromptModal title={prompt.title} initial={prompt.initial} onClose={() => setPrompt(null)} onOk={prompt.onOk} />}
      {confirm && <ConfirmModal title={confirm.title} text={confirm.text} danger={confirm.danger} onOk={confirm.onOk} onClose={() => setConfirm(null)} />}
      {shareTarget && <ShareDialog folderId={shareTarget.id} folderName={shareTarget.name} onClose={() => setShareTarget(null)} />}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </div>
  );

  // ---------- вспомогательные рендеры ----------
  function renderTab(t: Tab) {
    const isActive = activeId === t.id;
    return (
      <div key={t.id} className={'tab' + (isActive ? ' active' : '')} onClick={() => setActiveId(t.id)}
        onAuxClick={e => e.button === 1 && !t.pinned && closeTab(t.id)}>
        {t.pinned && <span className="pin">📌</span>}
        <span className="tt">{t.title}</span>
        {!t.pinned && <span className="x" onClick={e => { e.stopPropagation(); closeTab(t.id); }}>✕</span>}
      </div>);
  }
  function mkQuickSpecial() {
    return (
      <React.Fragment>
        <div className="tab pinned-static" onClick={() => openTab({ kind: 'folder', title: 'Общая папка', target: 'common' })}><span className="pin">📌</span>🌍 Общая папка</div>
        <div className="tab pinned-static" onClick={() => openTab({ kind: 'trash', title: 'Корзина' })}><span className="pin">📌</span>🗑️ Корзина</div>
      </React.Fragment>);
  }
  function renderSide(t: Tab) {
    const isActive = activeTab && activeTab.title === t.title && activeTab.kind === t.kind;
    return (
      <div key={t.id} className={'side-item' + (isActive ? ' active' : '')} onClick={() => openTab(t)}>
        <span className="ico">{sideIcon(t)}</span>{t.title}
      </div>);
  }
  function sideIcon(t: Tab) {
    if (t.aggKind === 'recent') return '🏠';
    if (t.aggKind === 'media') return '✨';
    if (t.aggKind === 'image') return '🖼️';
    if (t.aggKind === 'video') return '🎬';
    return '📁';
  }
  function openSystem(name: string) {
    // системные папки пользователя лежат в корне — найдём их по имени
    api.get('/api/folders/root').then((d: ContentsDto) => {
      const f = d.subfolders.find(s => s.name === name);
      if (f) openFolder(f); else toast(`Папка «${name}» не найдена`, 'err');
    }).catch(e => toast(String(e.message || e), 'err'));
  }
}

function CloudLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A5.5 5.5 0 0 1 17.4 10 3.8 3.8 0 0 1 17 18H7z"
        fill="var(--accent)" opacity=".9" />
    </svg>);
}

// Полоса использования квоты
function QuotaBar() {
  const [st, setSt] = useState<{ used: number; quota: number } | null>(null);
  useEffect(() => { api.get('/api/auth/me').then(() => api.get('/api/folders/root')).catch(() => {}); }, []);
  useEffect(() => {
    fetch('/api/settings/quota').then(r => r.ok ? r.json() : null).then(d => d && setSt(d)).catch(() => {});
  }, []);
  if (!st) return <div style={{ fontSize: 11, opacity: .6 }}>Квота: …</div>;
  const pct = Math.min(100, Math.round(st.used / Math.max(1, st.quota) * 100));
  return (
    <div>
      <div style={{ fontSize: 11, opacity: .8, marginBottom: 4 }}>Хранилище: {fmtSize(st.used)} из {fmtSize(st.quota)} ({pct}%)</div>
      <div className="quota-track"><div className="quota-fill" style={{ width: pct + '%' }} /></div>
    </div>);
}
