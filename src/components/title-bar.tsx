import { House, Settings } from 'lucide-react';
import type { ReactNode } from 'react';

import { t } from '../lib/i18n';
import { useApp } from '../store';
import { cx } from './ui';

export const isMac = navigator.userAgent.includes('Mac');

/**
 * The window's top strip. On macOS the native title bar is hidden (overlay
 * style), so this is where the window is dragged from and the traffic
 * lights sit on its left.
 */
export function TitleBar({ title = 'pilihfotomu', right }: { title?: ReactNode; right?: ReactNode }) {
  const screen = useApp((s) => s.screen);
  const go = useApp((s) => s.go);
  return (
    <header
      data-tauri-drag-region
      className={cx(
        'grid h-10 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-line-soft bg-panel pr-3',
        isMac ? 'pl-20' : 'pl-4',
      )}
    >
      <div data-tauri-drag-region className="flex items-center">
        {screen.name !== 'home' && screen.name !== 'progress' && (
          <button
            type="button"
            onClick={() => go({ name: 'home' })}
            title={t('Beranda')}
            aria-label={t('Beranda')}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-faint hover:bg-raised hover:text-fg"
          >
            <House size={14} /> {t('Beranda')}
          </button>
        )}
      </div>
      <div data-tauri-drag-region className="truncate text-[13px] font-medium text-muted">
        {title}
      </div>
      <div className="flex items-center justify-end gap-2">
        {right}
        {screen.name !== 'settings' && (
          <button
            type="button"
            onClick={() => go({ name: 'settings', back: screen })}
            title={`${t('Pengaturan')} (${isMac ? '⌘' : 'Ctrl+'},)`}
            aria-label={t('Pengaturan')}
            className="inline-flex size-7 items-center justify-center rounded-md text-faint hover:bg-raised hover:text-fg"
          >
            <Settings size={15} />
          </button>
        )}
      </div>
    </header>
  );
}
