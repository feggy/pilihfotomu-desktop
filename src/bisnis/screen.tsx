/**
 * Kelola Bisnis: bookings from the first question to the last delivery, the
 * calendar, packages and the rest — tabs over one set of data, kept offline.
 */

import { ArrowLeft, CalendarDays, FileText, KanbanSquare, MessageCircle, Package as PackageIcon, Plus, Settings2, TriangleAlert, Users, Wallet, Sparkles, SlidersHorizontal, LayoutTemplate, ShieldAlert, LayoutDashboard, List, ListChecks } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { TitleBar } from '../components/title-bar';
import { Segmented, cx } from '../components/ui';
import { t } from '../lib/i18n';
import { useKreasi } from '../kreasi/store';
import { useApp } from '../store';
import { clientOf } from './model';
import { lastBackupAt } from './backup';
import { Board } from './board';
import { BookingsList } from './bookings-list';
import { BookingDetail } from './booking-detail';
import { BookingEditor, newBooking, type BookingAction } from './booking-editor';
import { Calendar } from './calendar';
import { Clients } from './clients';
import { Finance } from './finance';
import { InvoiceDialog } from './invoice-dialog';
import { MessagesTab } from './messages-tab';
import { Overview } from './overview';
import { Packages } from './packages';
import { ReceiptDialog } from './receipt-dialog';
import { ReminderBell } from './reminder-bell';
import { SendDialog } from './send-dialog';
import { Settings } from './settings';
import { useBisnis } from './store';
import type { Booking } from './types';
import { btnPrimary } from './ui';

export type BisnisTab = 'ringkasan' | 'booking' | 'kalender' | 'klien' | 'paket' | 'pesan' | 'keuangan' | 'pengaturan';

const TABS: { id: BisnisTab; label: string; icon: typeof KanbanSquare }[] = [
  { id: 'ringkasan', label: 'Ringkasan', icon: LayoutDashboard },
  { id: 'booking', label: 'Booking', icon: ListChecks },
  { id: 'kalender', label: 'Kalender', icon: CalendarDays },
  { id: 'klien', label: 'Klien', icon: Users },
  { id: 'paket', label: 'Paket', icon: PackageIcon },
  { id: 'pesan', label: 'Pesan', icon: MessageCircle },
  { id: 'keuangan', label: 'Keuangan', icon: Wallet },
  { id: 'pengaturan', label: 'Pengaturan', icon: Settings2 },
];

/** `open`: a booking to show at once (from a reminder on Beranda). */
export function BisnisScreen({ open }: { open?: string }) {
  const go = useApp((s) => s.go);
  const { data, error, load } = useBisnis();
  const [tab, setTab] = useState<BisnisTab>('ringkasan');
  // Booking as a table or as the board: two tools over the same bookings.
  const [view, setView] = useState<'daftar' | 'board'>('daftar');
  const [editing, setEditing] = useState<Booking | null>(null);
  // A booking opened from a list: its detail first; Edit opens the form over it.
  const [viewing, setViewing] = useState<string | null>(null);
  const view_ = (b: Booking) => setViewing(b.id);
  const [invoice, setInvoice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ bookingId: string; paymentId: string } | null>(null);
  // Buat konten for this booking: its client's name and first shoot day fill the templates.
  const openKreasi = (bookingId: string) => {
    const d = useBisnis.getState().data;
    const b = d?.bookings.find((x) => x.id === bookingId);
    if (!d || !b) return;
    const first = [...b.sessions].sort((x, y) => x.start.localeCompare(y.start))[0];
    useKreasi.getState().setClient({ name: clientOf(d, b)?.name ?? b.title, date: first ? Date.parse(`${first.start.split('T')[0]}T00:00:00Z`) / 1000 : null });
    go({ name: 'kreasi', back: { name: 'bisnis' } });
  };
  const [message, setMessage] = useState<{ bookingId: string | null; phone?: string; name?: string; template?: string } | null>(null);
  const actions: BookingAction[] = [
    { key: 'invoice', label: t('Invoice'), icon: <FileText size={13} />, run: setInvoice },
    { key: 'wa', label: t('WhatsApp'), icon: <MessageCircle size={13} />, run: (bookingId) => setMessage({ bookingId }) },
    { key: 'pilih', label: t('Pilih foto##mode'), icon: <Sparkles size={13} />, run: () => go({ name: 'pilih' }) },
    { key: 'edit', label: t('Edit foto'), icon: <SlidersHorizontal size={13} />, run: () => go({ name: 'edit', back: { name: 'bisnis' } }) },
    { key: 'konten', label: t('Buat konten'), icon: <LayoutTemplate size={13} />, run: openKreasi },
  ];
  useEffect(() => {
    load().then(() => {
      const b = open && useBisnis.getState().data?.bookings.find((x) => x.id === open);
      if (b) setViewing(b.id);
    });
  }, [load, open]);

  let body: ReactNode = null;
  if (data) {
    if (tab === 'ringkasan') body = <Overview onOpen={view_} onEdit={setEditing} onMessage={(bookingId, template) => setMessage({ bookingId, template })} onStage={() => (setTab('booking'), setView('board'))} />;
    else if (tab === 'booking')
      body = (
        <>
          <div className="flex shrink-0 items-center gap-3 px-6 pt-4 lg:px-8">
            <span className="w-52">
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: 'daftar', label: <><List size={14} /> {t('Daftar')}</> },
                  { value: 'board', label: <><KanbanSquare size={14} /> {t('Board')}</> },
                ]}
              />
            </span>
          </div>
          {view === 'daftar' ? <BookingsList onOpen={view_} /> : <Board onOpen={view_} onNew={(col) => setEditing(newBooking(data, col))} />}
        </>
      );
    else if (tab === 'kalender') body = <Calendar onOpen={view_} onNewOn={(day) => setEditing(newBooking(data, data.columns[0]?.id ?? '', day))} />;
    else if (tab === 'klien')
      body = (
        <Clients
          onOpen={view_}
          onNew={(clientId) => setEditing({ ...newBooking(data, data.columns[0]?.id ?? ''), clientId })}
          onMessage={(c, bookingId) => setMessage({ bookingId, phone: c.phone, name: c.name })}
        />
      );
    else if (tab === 'paket') body = <Packages />;
    else if (tab === 'pesan') body = <MessagesTab />;
    else if (tab === 'keuangan') body = <Finance onOpen={view_} />;
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
          {data && <ReminderBell onOpen={view_} />}
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
      {data && tab !== 'pengaturan' && <BackupNotice onSetUp={() => setTab('pengaturan')} />}
      {body}
      {viewing && (
        <BookingDetail
          bookingId={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => setEditing(data?.bookings.find((b) => b.id === viewing) ?? null)}
          onReceipt={(paymentId) => setReceipt({ bookingId: viewing, paymentId })}
          actions={actions}
        />
      )}
      {receipt && <ReceiptDialog {...receipt} onClose={() => setReceipt(null)} />}
      {editing && <BookingEditor key={editing.id} initial={editing} onClose={() => setEditing(null)} actions={actions} />}
      {invoice && <InvoiceDialog bookingId={invoice} onClose={() => setInvoice(null)} />}
      {message && <SendDialog {...message} onClose={() => setMessage(null)} />}
    </div>
  );
}

const FORTNIGHT = 14 * 86_400_000;

/**
 * Everything here lives on this computer only: once there is something to
 * lose and no recent backup, say so — not again for two weeks if put off.
 */
function BackupNotice({ onSetUp }: { onSetUp: () => void }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const now = Date.now();
  const last = lastBackupAt(data);
  const later = data.settings.backupNoticeAt;
  if (!data.bookings.length || (last && now - last < FORTNIGHT) || (later && now - later < FORTNIGHT)) return null;
  return (
    <div className="mx-6 mt-3 flex items-center gap-3 rounded-xl border border-maybe/50 bg-maybe/[0.06] px-4 py-2.5 text-xs lg:mx-8">
      <ShieldAlert size={16} className="shrink-0 text-maybe" />
      <span className="min-w-0 flex-1 text-muted">
        {last ? t('Backup terakhir lebih dari 2 minggu lalu.') : t('Belum ada backup.')} {t('Data Kelola Bisnis hanya ada di komputer ini: kalau komputernya rusak atau hilang, datanya ikut hilang.')}
      </span>
      <button type="button" onClick={onSetUp} className="shrink-0 font-semibold text-gold-text hover:underline">
        {t('Atur backup')}
      </button>
      <button type="button" onClick={() => update((d) => ({ ...d, settings: { ...d.settings, backupNoticeAt: Date.now() } }))} className="shrink-0 text-faint hover:text-fg">
        {t('Nanti')}
      </button>
    </div>
  );
}
