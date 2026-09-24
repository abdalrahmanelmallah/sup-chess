import React, { useState, useEffect } from 'react';
import Lobby from './components/Lobby';
import Auth from './components/Auth';
import { apiUrl } from './api';
import './styles/globals.css';

function App() {
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(() => {
    const defaults = {
      theme: 'dark', board: 'midnight', orientation: 'auto', boardLabels: true,
      moveAnimation: true, premoves: true, premoveLimit: 5, clockWarning: true,
      soundEnabled: true, soundVolume: 65, soundStyle: 'classic', moveHighlights: true,
      reducedMotion: false, confirmResign: true
    };
    try {
      const saved = localStorage.getItem('sup_settings');
      return saved ? { ...defaults, ...JSON.parse(saved) } : defaults;
    } catch {
      return defaults;
    }
  });

  useEffect(() => {
    const resolvedTheme = settings.theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
      : settings.theme;
    document.documentElement.dataset.theme = resolvedTheme;
    localStorage.setItem('sup_settings', JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const savedUser = localStorage.getItem('sup_user');
    const token = localStorage.getItem('sup_token');
    if (!savedUser || !token) return;

    fetch(apiUrl('/api/me'), { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((verifiedUser) => {
        localStorage.setItem('sup_user', JSON.stringify(verifiedUser));
        setUser(verifiedUser);
      })
      .catch(() => {
        localStorage.removeItem('sup_token');
        localStorage.removeItem('sup_user');
      });
  }, []);

  if (!user) {
    return <Auth
      onAuthSuccess={(userData) => setUser(userData)}
      onPlayAsGuest={() => setUser({ id: 'guest', username: 'Guest', rating: 0, isGuest: true })}
    />;
  }

  return (
    <div className="App">
      <Lobby user={user} settings={settings} onSettingsChange={setSettings} onUserChange={(nextUser) => {
        localStorage.setItem('sup_user', JSON.stringify(nextUser));
        setUser(nextUser);
      }} onLogout={async () => {
        const token = localStorage.getItem('sup_token');
        if (token && !user.isGuest) {
          await fetch(apiUrl('/api/logout'), { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
        }
        localStorage.removeItem('sup_token');
        localStorage.removeItem('sup_user');
        setUser(null);
      }} />
    </div>
  );
}

export default App;
