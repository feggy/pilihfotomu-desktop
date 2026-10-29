import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './app';
import { catchUncaught } from './lib/errors';
import { watchTheme } from './lib/theme';
import './styles.css';

// The webview's own menu (Reload, Inspect Element) isn't part of the app.
// Text fields keep theirs, for copy and paste. Development keeps it all.
if (!import.meta.env.DEV) {
  window.addEventListener('contextmenu', (e) => {
    const el = e.target as HTMLElement | null;
    if (!el?.closest('input, textarea, [contenteditable="true"]')) e.preventDefault();
  });
}

async function start() {
  // Opened in a plain browser during development: fake the Rust side.
  if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) {
    await (await import('./dev/mock')).installMock();
  }
  catchUncaught();
  watchTheme();
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

start();
