// Клиент API «Облака»
export interface UserInfo { id: number; login: string; role: string; quotaBytes: number; createdAt?: string }
export interface FolderDto { id: number; name: string; parentId: number | null; ownerId: number | null;
  isCommon: boolean; createdAt: string; access: string | null }
export interface FileDto { id: number; name: string; folderId: number; mime: string | null; size: number;
  ownerId: number | null; createdAt: string; kind: string; downloadUrl?: string; previewUrl?: string }
export interface ContentsDto { folder: FolderDto; breadcrumb: { id: number; name: string; isCommon: boolean }[];
  subfolders: FolderDto[]; files: FileDto[] }

export class ApiError extends Error {
  status: number;
  constructor(msg: string, status: number) { super(msg); this.status = status; }
}

async function handle(res: Response) {
  if (res.status === 507) { const j = await res.json().catch(() => ({})); throw new ApiError(j.error || 'Недостаточно места', 507); }
  if (!res.ok) {
    let msg = `Ошибка ${res.status}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch {}
    throw new ApiError(msg, res.status);
  }
  return res.json();
}

export const api = {
  get: (url: string) => fetch(url).then(handle),
  post: (url: string, body?: unknown) => fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }).then(handle),
  patch: (url: string, body: unknown) => fetch(url, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(handle),
  del: (url: string) => fetch(url, { method: 'DELETE' }).then(handle),
  upload: (folderId: number, files: FileList | File[]) => {
    const fd = new FormData();
    fd.append('folderId', String(folderId));
    for (const f of Array.from(files)) fd.append('files', f);
    return fetch('/api/files', { method: 'POST', body: fd }).then(handle);
  },
};

export function fmtSize(n: number): string {
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + ' ГБ';
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' МБ';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' КБ';
  return n + ' Б';
}
export function fmtDate(s: string): string {
  try { return new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z')).toLocaleString('ru-RU'); } catch { return s; }
}
