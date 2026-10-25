// Настройки внешнего вида (сохраняются только у авторизованных)
import React from 'react';
import { Modal } from './Modals';
import { useStore, defaultAppearance } from '../store';

const ACCENTS = ['#4cc2ff', '#7ad7f0', '#6ccb7c', '#ffb84d', '#ff6b5e', '#c986fb', '#5aa7ff'];

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { appearance: a, setAppearance, saveAppearance, me, toast } = useStore();
  const guest = !me || me.isGuest;
  const sw = (k: 'showVideo', label: string) => (
    <div className="set-row"><span>{label}</span>
      <div className={'switch' + (a[k] ? ' on' : '')} onClick={() => setAppearance({ [k]: !a[k] } as any)} /></div>
  );
  return (
    <Modal title="Персонализация" onClose={onClose}>
      <div className="settings-body">
        <div className="set-row"><span>Тема</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={'chip' + (a.theme === 'dark' ? ' active' : '')} onClick={() => setAppearance({ theme: 'dark' })}>Тёмная</button>
            <button className={'chip' + (a.theme === 'light' ? ' active' : '')} onClick={() => setAppearance({ theme: 'light' })}>Светлая</button>
          </div></div>
        <div className="set-row"><span>Акцентный цвет</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {ACCENTS.map(c => <div key={c} onClick={() => setAppearance({ accent: c })}
              style={{ width: 20, height: 20, borderRadius: 6, background: c, cursor: 'pointer',
                outline: a.accent === c ? '2px solid var(--text)' : '1px solid var(--border)' }} />)}
            <input type="color" value={a.accent} onChange={e => setAppearance({ accent: e.target.value })} />
          </div></div>
        <div className="set-row"><span style={{ whiteSpace: 'nowrap' }}>Прозрачность панелей</span>
          <input type="range" min={30} max={100} value={a.opacity}
            onChange={e => setAppearance({ opacity: Number(e.target.value) })} /></div>
        <div className="set-row"><span style={{ whiteSpace: 'nowrap' }}>Эффект «стекло» (blur)</span>
          <input type="range" min={0} max={40} value={a.blur}
            onChange={e => setAppearance({ blur: Number(e.target.value) })} /></div>
        <div className="set-row"><span style={{ whiteSpace: 'nowrap' }}>Приглушение фона</span>
          <input type="range" min={0} max={85} value={a.dim}
            onChange={e => setAppearance({ dim: Number(e.target.value) })} /></div>
        {sw('showVideo', 'Фоновое видео')}
        {guest && <p className="hint">Вы в гостевом режиме: настройки действуют только в этой сессии и не сохраняются на сервере.</p>}
      </div>
      <div className="btn-row" style={{ justifyContent: 'space-between' }}>
        <button className="btn" onClick={() => setAppearance(defaultAppearance)}>Сбросить</button>
        <div style={{ display: 'flex', gap: 8 }}>
          {!guest && <button className="btn primary" onClick={async () => { await saveAppearance(); toast('Настройки сохранены', 'ok'); }}>Сохранить</button>}
          <button className="btn" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </Modal>
  );
}
