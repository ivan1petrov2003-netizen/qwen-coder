// Логика прав доступа к папкам и файлам
import { q1 } from './db.js';

export const PERM_RANK = { view: 1, read: 2, write: 3 };

// Корень пользователя
export function getRootFolderId(userId) {
  const f = q1(`SELECT id FROM folders WHERE owner_id=? AND parent_id IS NULL LIMIT 1`, userId);
  return f ? f.id : null;
}

// Цепочка предков папки (от корня к самой папке)
export function folderChain(folder) {
  const chain = [];
  let cur = folder;
  let guard = 0;
  while (cur && guard++ < 100) {
    chain.unshift(cur);
    if (!cur.parent_id) break;
    cur = q1(`SELECT * FROM folders WHERE id=?`, cur.parent_id);
  }
  return chain;
}

export function isCommonSubtree(folder) {
  return folderChain(folder).some(f => f.is_common === 1);
}

// Эффективное право пользователя на папку: null | 'view' | 'read' | 'write' | 'owner'
export function getFolderAccess(user, folder) {
  if (!folder || folder.deleted_at) return null;
  if (user.role === 'admin') return 'owner';
  // Личная папка владельца — полные права (в т.ч. внутри общей это владелец)
  if (folder.owner_id === user.id) return 'owner';
  // Общая папка и её подпапки: просмотр/скачивание/создание — всем;
  // «common» означает, что изменять/удалять можно только свои объекты
  if (isCommonSubtree(folder)) return 'common';
  // Инвайты на саму папку или любого предка (наследуются вниз)
  const chain = folderChain(folder);
  let best = null;
  for (const f of chain) {
    const inv = q1(`SELECT permission FROM folder_invites WHERE folder_id=? AND invitee_id=?`, f.id, user.id);
    if (inv && (!best || PERM_RANK[inv.permission] > PERM_RANK[best])) best = inv.permission;
  }
  return best;
}

export function can(access, action) {
  if (!access) return false;
  if (access === 'owner' || access === 'write' || access === 'common') {
    return ['view', 'download', 'create', 'upload', 'modify', 'delete'].includes(action);
  }
  if (access === 'read') return ['view', 'download'].includes(action);
  if (access === 'view') return action === 'view';
  return false;
}

// Может ли пользователь изменить/удалить конкретный объект (файл или подпапку)
export function canModifyObject(user, access, objectOwnerId) {
  if (user.role === 'admin') return true;
  if (objectOwnerId === user.id) return true;          // владелец объекта
  if (access === 'owner') return true;                 // владелец дерева
  if (access === 'write') return true;                 // приглашение с правом записи
  return false;                                        // 'common' + чужой объект -> нет
}

export function jsonError(res, access, action) {
  res.status(403).json({ error: 'Недостаточно прав для этого действия' });
}
