// Сетка/список элементов + контекстное меню + просмотрщик
import React from 'react';
import { fmtSize, fmtDate } from '../api';
import type { FileDto, FolderDto } from '../api';

export function fileIcon(f: FileDto) {
  switch (f.kind) {
    case 'image': return '🖼️'; case 'video': return '🎬'; case 'audio': return '🎵';
    case 'document': return '📄'; case 'archive': return '🗜️'; default: return '📃';
  }
}

export interface MenuState { x: number; y: number; items: { label: string; danger?: boolean; onClick: () => void }[] }

export function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const style: React.CSSProperties = { left: Math.min(menu.x, window.innerWidth - 230), top: Math.min(menu.y, window.innerHeight - menu.items.length * 36 - 20) };
  return (
    <div className="ctx-menu" style={style}>
      {menu.items.map((it, i) => (
        <div key={i} className={'ctx-item' + (it.danger ? ' danger' : '')}
          onClick={() => { it.onClick(); onClose(); }}>{it.label}</div>))}
    </div>
  );
}

interface Props {
  view: 'grid' | 'list';
  subfolders: FolderDto[]; files: FileDto[];
  selected: Set<string>; // 'f<id>' | 'd<id>'
  canWrite: boolean; trashMode?: boolean;
  previewUrl: (f: FileDto) => string;
  onOpenFolder: (f: FolderDto) => void;
  onOpenFile: (f: FileDto) => void;
  onSelect: (key: string, multi: boolean) => void;
  onContext: (e: React.MouseEvent, kind: 'file' | 'folder', item: any) => void;
  onBackgroundContext: (e: React.MouseEvent) => void;
  onRename?: (kind: 'file' | 'folder', item: any) => void;
}

export default function FileGrid(p: Props) {
  const isSel = (k: string) => p.selected.has(k);
  const click = (e: React.MouseEvent, k: string, dbl: () => void) => {
    if (e.detail === 2) { dbl(); return; }
    p.onSelect(k, e.ctrlKey || e.metaKey);
  };
  const thumb = (f: FileDto) =>
    f.kind === 'image'
      ? <img src={p.previewUrl(f)} loading="lazy" alt="" onError={e => (e.target as HTMLImageElement).style.display = 'none'} />
      : f.kind === 'video'
        ? <video src={p.previewUrl(f) + '#t=0.5'} preload="metadata" muted playsInline />
        : <span className="big-ico">{fileIcon(f)}</span>;

  if (p.view === 'list') {
    return (
      <div className="list-view" onContextMenu={p.onBackgroundContext}>
        <div className="list-head"><span>Имя</span><span>Размер</span><span>Тип</span><span>Дата изменения</span></div>
        {p.subfolders.map(d => (
          <div key={'d' + d.id} className={'list-row' + (isSel('d' + d.id) ? ' sel' : '')}
            onClick={e => click(e, 'd' + d.id, () => p.onOpenFolder(d))}
            onContextMenu={e => { e.preventDefault(); p.onContext(e, 'folder', d); }}>
            <span className="nm">📁 {d.name}{d.isCommon && !p.trashMode ? '' : ''}</span>
            <span>—</span><span>Папка с файлами</span><span>{fmtDate(d.createdAt)}</span>
          </div>))}
        {p.files.map(f => (
          <div key={'f' + f.id} className={'list-row' + (isSel('f' + f.id) ? ' sel' : '')}
            onClick={e => click(e, 'f' + f.id, () => p.onOpenFile(f))}
            onContextMenu={e => { e.preventDefault(); p.onContext(e, 'file', f); }}>
            <span className="nm">{fileIcon(f)} {f.name}</span>
            <span>{fmtSize(f.size)}</span><span>{(f.mime || f.kind)}</span><span>{fmtDate(f.createdAt)}</span>
          </div>))}
      </div>
    );
  }
  return (
    <div className="grid" onContextMenu={p.onBackgroundContext}>
      {p.subfolders.map(d => (
        <div key={'d' + d.id} className={'item' + (isSel('d' + d.id) ? ' sel' : '')}
          onClick={e => click(e, 'd' + d.id, () => p.onOpenFolder(d))}
          onContextMenu={e => { e.preventDefault(); p.onContext(e, 'folder', d); }}>
          <div className="thumb"><span className="big-ico folder-ico">📁</span></div>
          <div className="name">{d.name}</div>
        </div>))}
      {p.files.map(f => (
        <div key={'f' + f.id} className={'item' + (isSel('f' + f.id) ? ' sel' : '')}
          onClick={e => click(e, 'f' + f.id, () => p.onOpenFile(f))}
          onContextMenu={e => { e.preventDefault(); p.onContext(e, 'file', f); }}>
          <div className="thumb">{thumb(f)}</div>
          <div className="name">{f.name}</div>
        </div>))}
    </div>
  );
}

export function Viewer({ file, url, onClose, downloadHref }: {
  file: FileDto; url: string; onClose: () => void; downloadHref: string }) {
  const media = file.kind === 'image' ? <img src={url} alt={file.name} />
    : file.kind === 'video' ? <video src={url} controls autoPlay /> : null;
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal viewer">
        <h3>{file.name}</h3>
        {media || (
          <div className="info-card">
            <span className="k">Тип</span><span>{file.mime || file.kind}</span>
            <span className="k">Размер</span><span>{fmtSize(file.size)}</span>
            <span className="k">Создан</span><span>{fmtDate(file.createdAt)}</span>
            <span className="k">Просмотр</span><span>Недоступен для этого формата</span>
          </div>
        )}
        <div className="btn-row">
          <a className="btn primary" href={downloadHref}>Скачать</a>
          <button className="btn" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
