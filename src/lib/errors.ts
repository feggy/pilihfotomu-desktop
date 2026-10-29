/**
 * Errors written to the log on this computer (errlog.rs): uncaught ones, and
 * the ones the app shows the photographer. The same message within a few
 * seconds is written once, so a loop doesn't fill the file.
 */

import { api } from './api';

let last = { text: '', at: 0 };

export function logError(source: string, error: unknown) {
  const text = error instanceof Error ? `${error.message}${error.stack ? ` | ${error.stack.split('\n').slice(1, 4).join(' | ').trim()}` : ''}` : typeof error === 'string' ? error : JSON.stringify(error) ?? String(error);
  const now = Date.now();
  if (text === last.text && now - last.at < 5000) return;
  last = { text, at: now };
  api.logError(source, text).catch(() => {});
}

/** Every error nothing else caught, from the start. */
export function catchUncaught() {
  window.addEventListener('error', (e) => logError('ui', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => logError('ui-promise', e.reason));
}
