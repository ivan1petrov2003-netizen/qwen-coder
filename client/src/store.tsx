// Глобальное состояние: сессия, настройки внешнего вида, уведомления (toast)
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, UserInfo } from './api';

export interface Appearance {
  theme: 'dark' | 'light';
  accent: string;
  opacity: number;      // 0..100 прозрачность панелей
  blur: number;         // px — эффект «стекло»
  dim: number;          // 0..100 приглушение фона
  showVideo: boolean;
}
export const defaultAppearance: Appearance = {
  theme: 'dark', accent: '#4cc2ff', opacity: 72, blur: 24, dim: 35, showVideo: true,
};

export interface Toast { id: number; text: string; kind: 'ok' | 'err' | 'info' }

interface Store {
  me: { user: UserInfo; isGuest: boolean; isAdmin: boolean; rootFolderId: number | null } | null;
  refreshMe: () => Promise<void>;
  login: (l: string, p: string) => Promise<void>;
  register: (l: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
  appearance: Appearance;
  setAppearance: (a: Partial<Appearance>) => void;
  saveAppearance: () => Promise<void>;
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind']) => void;
  bgVideoUrl: string;
  sharedWithMe: { folderId: number; name: string; ownerLogin: string; permission: string }[];
  loadShared: () => Promise<void>;
}

const Ctx = createContext<Store>(null as unknown as Store);
export const useStore = () => useContext(Ctx);

let toastId = 1;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Store['me']>(null);
  const [appearance, setAp] = useState<Appearance>(() => {
    try { return { ...defaultAppearance, ...JSON.parse(localStorage.getItem('obloko_appearance') || '{}') }; }
    catch { return defaultAppearance; }
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [bgVideoUrl, setBg] = useState('/background.mp4');
  const [sharedWithMe, setShared] = useState<Store['sharedWithMe']>([]);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = toastId++;
    setToasts(t => [...t, { id, text, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4200);
  }, []);

  const refreshMe = useCallback(async () => {
    const d = await api.get('/api/auth/me');
    setMe(d);
  }, []);

  useEffect(() => { refreshMe().catch(() => {}); }, [refreshMe]);
  useEffect(() => { api.get('/api/config').then(c => c.backgroundVideo && setBg(c.backgroundVideo)).catch(() => {}); }, []);

  // Загрузка сохранённых настроек для авторизованных
  useEffect(() => {
    if (me && !me.isGuest) {
      api.get('/api/settings').then(d => {
        if (d.settings) setAp(a => ({ ...a, ...d.settings }));
      }).catch(() => {});
    }
  }, [me?.user?.id, me?.isGuest]);

  const setAppearance = useCallback((patch: Partial<Appearance>) => {
    setAp(a => {
      const next = { ...a, ...patch };
      localStorage.setItem('obloko_appearance', JSON.stringify(next)); // гость — только локально
      return next;
    });
  }, []);

  const saveAppearance = useCallback(async () => {
    if (!me || me.isGuest) return; // настройки сохраняются только у авторизованных
    await api.patch('/api/settings', appearance).catch(e => toast(String(e.message || e), 'err'));
  }, [me, appearance, toast]);

  const login = useCallback(async (l: string, p: string) => {
    await api.post('/api/auth/login', { login: l, password: p });
    await refreshMe();
  }, [refreshMe]);

  const register = useCallback(async (l: string, p: string) => {
    await api.post('/api/auth/register', { login: l, password: p });
    await refreshMe();
  }, [refreshMe]);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    await refreshMe();
  }, [refreshMe]);

  const loadShared = useCallback(async () => {
    try { const d = await api.get('/api/share/shared-with-me'); setShared(d.folders); } catch {}
  }, []);
  useEffect(() => { if (me && !me.isGuest) loadShared(); }, [me?.user?.id, loadShared]);

  // Применение темы/акцента к документу
  useEffect(() => {
    const r = document.documentElement;
    r.dataset.theme = appearance.theme;
    r.style.setProperty('--accent', appearance.accent);
    r.style.setProperty('--panel-alpha', String(appearance.opacity / 100));
    r.style.setProperty('--blur', `${appearance.blur}px`);
    r.style.setProperty('--dim', String(appearance.dim / 100));
  }, [appearance]);

  return (
    <Ctx.Provider value={{ me, refreshMe, login, register, logout, appearance, setAppearance,
      saveAppearance, toasts, toast, bgVideoUrl, sharedWithMe, loadShared }}>
      {children}
    </Ctx.Provider>
  );
}
