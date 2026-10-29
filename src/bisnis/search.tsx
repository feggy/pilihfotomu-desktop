/**
 * Cari (⌘K): any booking or client from any tab, by name, phone, package,
 * place, invoice number or note — every word typed has to be in it. Arrow
 * keys and Enter, or a click; a booking opens its detail, a client their page.
 */

import { CalendarDays, Search, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { clientOf, nextSession, shortDate, titleOf } from './model';
import { useBisnis } from './store';
import { useEscape } from './ui';

type Hit = { kind: 'booking' | 'client'; id: string; title: string; sub: string; color?: string };

const MAX = 8;
const norm = (s: string) => s.toLocaleLowerCase('id').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** The button by the bell, and ⌘K anywhere in Kelola Bisnis. */
export function SearchButton({ onBooking, onClient }: { onBooking: (id: string) => void; onClient: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') (e.preventDefault(), setOpen(true));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={t('Cari booking atau klien (⌘K)')} aria-label={t('Cari')} className="flex size-9 items-center justify-center rounded-[10px] border border-line bg-panel text-muted hover:text-fg">
        <Search size={16} />
      </button>
      {open && <Palette onClose={() => setOpen(false)} onBooking={(id) => (setOpen(false), onBooking(id))} onClient={(id) => (setOpen(false), onClient(id))} />}
    </>
  );
}

function Palette({ onClose, onBooking, onClient }: { onClose: () => void; onBooking: (id: string) => void; onClient: (id: string) => void }) {
  const data = useBisnis((s) => s.data)!;
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEscape(onClose);

  // Each booking and client once, with everything it can be found by.
  const all = useMemo(() => {
    const bookings = [...data.bookings]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((b) => {
        const c = clientOf(data, b);
        const col = data.columns.find((x) => x.id === b.columnId);
        const next = nextSession(b) ?? b.sessions[0];
        const hit: Hit = { kind: 'booking', id: b.id, title: titleOf(data, b), sub: [b.packageName, next && shortDate(next.start.split('T')[0]!), col?.name].filter(Boolean).join(' · '), color: col?.color };
        const text = [hit.title, c?.name, c?.phone, c?.email, b.packageName, b.invoiceNo, b.notes, ...b.sessions.flatMap((s) => [s.label, s.location]), ...b.payments.map((p) => p.receiptNo ?? '')].join(' ');
        return { hit, text: norm(text) };
      });
    const clients = data.clients.map((c) => {
      const n = data.bookings.filter((b) => b.clientId === c.id).length;
      const hit: Hit = { kind: 'client', id: c.id, title: c.name || t('Tanpa nama'), sub: [c.phone, t('{n} booking', { n })].filter(Boolean).join(' · ') };
      return { hit, text: norm([c.name, c.phone, c.email, c.notes].join(' ')) };
    });
    return { bookings, clients };
  }, [data]);

  const words = norm(q).split(/\s+/).filter(Boolean);
  const match = (x: { text: string }) => words.every((w) => x.text.includes(w));
  // Nothing typed: the bookings touched last, to jump back to.
  const bookings = (words.length ? all.bookings.filter(match) : all.bookings).slice(0, MAX).map((x) => x.hit);
  const clients = words.length ? all.clients.filter(match).slice(0, MAX).map((x) => x.hit) : [];
  const hits = [...bookings, ...clients];
  useEffect(() => setActive(0), [q]);
  useEffect(() => list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }), [active]);

  const go = (h: Hit | undefined) => h && (h.kind === 'booking' ? onBooking(h.id) : onClient(h.id));
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(hits.length - 1, i + 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
    else if (e.key === 'Enter') (e.preventDefault(), go(hits[active]));
  };

  const row = (h: Hit, i: number) => (
    <button key={`${h.kind}-${h.id}`} data-i={i} type="button" onMouseMove={() => setActive(i)} onClick={() => go(h)} className={cx('flex items-center gap-3 rounded-lg px-3 py-2 text-left', i === active && 'bg-raised')}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-bg text-faint">{h.kind === 'booking' ? <CalendarDays size={14} /> : <User size={14} />}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium text-fg">{h.title}</span>
        <span className="flex items-center gap-1.5 truncate text-[11px] text-faint">
          {h.color && <span className="size-1.5 shrink-0 rounded-full" style={{ background: h.color }} />}
          {h.sub}
        </span>
      </span>
    </button>
  );
  const heading = (text: string) => <span className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-faint uppercase">{text}</span>;

  return createPortal(
    <div className="fixed inset-x-0 top-10 bottom-0 z-50 flex justify-center bg-black/60 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[60vh] w-[560px] max-w-full flex-col self-start overflow-hidden rounded-2xl border border-line bg-panel-2 shadow-2xl">
        <label className="flex items-center gap-3 border-b border-line-soft px-4">
          <Search size={16} className="shrink-0 text-faint" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder={t('Cari klien, paket, lokasi, nomor invoice…')} className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-faint" />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-faint">esc</kbd>
        </label>
        <div ref={list} className="flex min-h-0 flex-col overflow-y-auto p-1.5">
          {bookings.length > 0 && heading(words.length ? t('Booking') : t('Baru dibuka atau diubah'))}
          {bookings.map((h, i) => row(h, i))}
          {clients.length > 0 && heading(t('Klien'))}
          {clients.map((h, i) => row(h, bookings.length + i))}
          {hits.length === 0 && <span className="px-3 py-6 text-center text-xs text-faint">{words.length ? t('Tidak ada yang cocok dengan "{q}".', { q }) : t('Belum ada booking.')}</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
