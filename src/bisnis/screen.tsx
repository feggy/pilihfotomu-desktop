/**
 * Kelola Bisnis: bookings from the first question to the last delivery, the
 * calendar, packages and the rest — tabs over one set of data, kept offline.
 */

import { ArrowLeft, CalendarDays, FileText, KanbanSquare, Package as PackageIcon, Plus, Settings2, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { TitleBar } from '../components/title-bar';
import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { useApp } from '../store';
import { Board } from './board';
import { BookingEditor, newBooking, type BookingAction } from './booking-editor';
import { Calendar } from './calendar';
import { InvoiceDialog } from './invoice-dialog';
import { Packages } from './packages';
import { Settings } from './settings';
import { useBisnis } from './store';
import type { Booking } from './types';
import { btnPrimary } from './ui';

export type BisnisTab = 'board' | 'kalender' | 'paket' | 'pengaturan';

const TABS: { id: BisnisTab; label: string; icon: typeof KanbanSquare }[] = [
  { id: 'board', label: 'Board', icon: KanbanSquare },
  { id: 'kalender', label: 'Kalender', icon: CalendarDays },
  { id: 'paket', label: 'Paket', icon: PackageIcon },
  { id: 'pengaturan', label: 'Pengaturan', icon: Settings2 },
];

export function BisnisScreen() {
  const go = useApp((s) => s.go);
  const { data, error, load } = useBisnis();
  const [tab, setTab] = useState<BisnisTab>('board');
  const [editing, setEditing] = useState<Booking | null>(null);
  const [invoice, setInvoice] = useState<string | null>(null);
  const actions: BookingAction[] = [{ key: 'invoice', label: t('Invoice'), icon: <FileText size={13} />, run: setInvoice }];
  useEffect(() => {
    load();
  }, [load]);

  let body: ReactNode = null;
  if (data) {
    if (tab === 'board') body = <Board onOpen={setEditing} onNew={(col) => setEditing(newBooking(data, col))} />;
    else if (tab === 'kalender') body = <Calendar onOpen={setEditing} onNewOn={(day) => setEditing(newBooking(data, data.columns[0]?.id ?? '', day))} />;
    else if (tab === 'paket') body = <Packages />;
    else body = <Settings />;
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar title={t('Kelola Bisnis')} />
      <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-line-soft px-6 py-3 lg:px-8">
        <button type="button" onClick={() => go({ name: 'home' })} aria-label={t('Kembali')} className="text-muted hover:text-fg">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-[20px] font-semibold">{t('Kelola Bisnis')}</h1>
        <nav className="flex gap-1 rounded-[10px] bg-panel p-[3px]">
          {TABS.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => setTab(x.id)}
              className={cx('flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px]', tab === x.id ? 'border border-line bg-raised font-semibold text-fg' : 'font-medium text-muted hover:text-fg')}
            >
              <x.icon size={14} /> {t(x.label)}
            </button>
          ))}
        </nav>
        <span className="ml-auto flex items-center gap-2">
          {data && (
            <button type="button" onClick={() => setEditing(newBooking(data, data.columns[0]?.id ?? ''))} className={btnPrimary}>
              <Plus size={15} /> {t('Booking')}
            </button>
          )}
        </span>
      </div>
      {error && (
        <p className="mx-6 mt-3 flex items-center gap-2 rounded-lg border border-reject/50 bg-reject/[0.06] px-3 py-2 text-xs text-reject lg:mx-8">
          <TriangleAlert size={14} /> {t('Data Kelola Bisnis tidak bisa dibaca atau disimpan: {e}', { e: error })}
        </p>
      )}
      {body}
      {editing && <BookingEditor key={editing.id} initial={editing} onClose={() => setEditing(null)} actions={actions} />}
      {invoice && <InvoiceDialog bookingId={invoice} onClose={() => setInvoice(null)} />}
    </div>
  );
}
