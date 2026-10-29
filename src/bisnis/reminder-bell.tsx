/** The bell in Kelola Bisnis's header: what needs doing today and soon, each one opening its booking. */

import { Bell, CalendarClock, Send, Wallet, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { remindersOf, type Reminder } from './reminders';
import { useBisnis } from './store';
import type { Booking } from './types';

const ICON = { shoot: CalendarClock, due: Wallet, kirim: Send } as const;

export function ReminderBell({ onOpen }: { onOpen: (b: Booking) => void }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const [open, setOpen] = useState(false);
  // Read again each minute: "tomorrow" becomes "today" without a change to the data.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const list = useMemo(() => remindersOf(data), [data, tick]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const dismiss = (r: Reminder) => update((d) => ({ ...d, dismissed: [...d.dismissed, r.key].slice(-500) }));
  const urgent = list.some((r) => r.urgent);

  return (
    <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t('Pengingat')}
        aria-label={t('Pengingat')}
        className={cx('relative flex size-9 items-center justify-center rounded-[10px] border border-line bg-panel text-muted hover:text-fg', open && 'border-gold text-fg')}
      >
        <Bell size={16} />
        {list.length > 0 && (
          <span className={cx('absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white', urgent ? 'bg-reject' : 'bg-gold')}>
            {list.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute top-11 right-0 z-30 flex max-h-[460px] w-[360px] flex-col overflow-hidden rounded-xl border border-line bg-panel-2 shadow-2xl">
          <span className="border-b border-line-soft px-4 py-2.5 text-xs font-semibold">{t('Pengingat')}</span>
          <div className="flex min-h-0 flex-col overflow-y-auto p-1.5">
            {list.length === 0 && <span className="px-3 py-6 text-center text-xs text-faint">{t('Tidak ada yang perlu diingat hari ini dan besok.')}</span>}
            {list.map((r) => {
              const Icon = ICON[r.kind];
              return (
                <div key={r.key} className="group flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-raised">
                  <Icon size={15} className={cx('mt-0.5 shrink-0', r.urgent ? 'text-reject' : 'text-gold-text')} />
                  <button type="button" onClick={() => (setOpen(false), onOpen(r.booking))} className="flex min-w-0 flex-1 flex-col text-left">
                    <span className="text-[13px] font-medium">{r.title}</span>
                    <span className="text-[11px] text-faint">{r.detail}</span>
                  </button>
                  <button type="button" onClick={() => dismiss(r)} title={t('Sembunyikan pengingat ini')} aria-label={t('Sembunyikan pengingat ini')} className="mt-0.5 shrink-0 text-faint opacity-0 group-hover:opacity-100 hover:text-fg">
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
