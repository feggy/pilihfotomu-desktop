import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './app';
import './styles.css';

async function start() {
  // Opened in a plain browser during development: fake the Rust side.
  if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) {
    await (await import('./dev/mock')).installMock();
  }
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

start();
