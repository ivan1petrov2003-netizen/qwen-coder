// Корневой компонент: фон (видео + вуаль), маршрутизация «проводник / публичная ссылка», тосты
import React from 'react';
import { StoreProvider, useStore } from './store';
import Explorer from './components/Explorer';
import ShareView from './components/ShareView';

function Background() {
  const { appearance, bgVideoUrl } = useStore();
  return (
    <div className="bg-layer">
      {appearance.showVideo && (
        <video className="bg-video" src={bgVideoUrl} autoPlay muted loop playsInline />)}
      <div className="bg-veil" />
    </div>
  );
}

function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toasts">
      {toasts.map(t => <div key={t.id} className={'toast ' + t.kind}>{t.text}</div>)}
    </div>
  );
}

function Shell() {
  const { me } = useStore();
  const shareMatch = location.pathname.match(/^\/share\/([A-Za-z0-9]+)/);
  return (
    <>
      <Background />
      <div className="app-shell">
        {!me
          ? <div className="win" style={{ display: 'grid', placeItems: 'center' }}><div className="empty">Загрузка Облака…</div></div>
          : shareMatch ? <ShareView token={shareMatch[1]} /> : <Explorer />}
      </div>
      <Toasts />
    </>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
