import { useEffect, useState } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppRoot } from '@telegram-apps/telegram-ui';
import { SearchPage } from './pages/SearchPage';
import { ResultsPage } from './pages/ResultsPage';
import { colorScheme, uiPlatform, webApp } from './lib/telegram';

export function App() {
  const [appearance, setAppearance] = useState(colorScheme);

  // Follow Telegram's theme switch, and the OS preference when run in a browser.
  useEffect(() => {
    const sync = () => setAppearance(colorScheme());
    const app = webApp();
    app?.onEvent('themeChanged', sync);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', sync);
    return () => {
      app?.offEvent('themeChanged', sync);
      media.removeEventListener('change', sync);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
  }, [appearance]);

  return (
    <AppRoot appearance={appearance} platform={uiPlatform()}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<SearchPage />} />
          <Route path="/d/:domain" element={<ResultsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AppRoot>
  );
}
