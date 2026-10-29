/**
 * The calendar: every session of every booking by day — a month at a time,
 * or a week by the hour. Days off are shaded; a click on a free day starts a
 * booking on it, on a session opens its booking.
 */

import { Ban, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Segmented, cx } from '../components/ui';
import { t } from '../lib/i18n';
import { MONTHS, dayKey, newId, parseLocal, timeOf, titleOf, today } from './model';
import { useBisnis } from './store';
import type { BisnisData, Booking, Session } from './types';

const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
/** The week view's hours, top to bottom. */
const FIRST_HOUR = 6;
const LAST_HOUR = 23;
const HOUR_PX = 44;

type Item = { booking: Booking; session: Session; color: string; inactive: boolean };

/** Every session by the day it starts on (cancelled ones too, greyed). */
function byDay(data: BisnisData): Map<string, Item[]> {
  const out = new Map<string, Item[]>();
  for (const b of data.bookings) {
    const col = data.columns.find((c) => c.id === b.columnId);
    for (const s of b.sessions) {
      const day = s.start.split('T')[0]!;
      const list = out.get(day) ?? [];
      list.push({ booking: b, session: s, color: col?.color ?? '#8a9a93', inactive: !!col?.inactive });
      out.set(day, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.session.start.localeCompare(b.session.start));
  return out;
}

/** Monday of the week `d` is in. */
const monday = (d: Date) => {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export function Calendar({ onOpen, onNewOn }: { onOpen: (b: Booking) => void; onNewOn: (day: string) => void }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const [view, setView] = useState<'bulan' | 'minggu'>('bulan');
  const [anchor, setAnchor] = useState(() => new Date());
  const items = useMemo(() => byDay(data), [data]);
  const blocked = useMemo(() => new Map(data.blocked.map((d) => [d.date, d])), [data.blocked]);
  const now = today();

  const toggleBlocked = (day: string) =>
    update((d) => {
      const has = d.blocked.find((x) => x.date === day);
      return { ...d, blocked: has ? d.blocked.filter((x) => x !== has) : [...d.blocked, { id: newId(), date: day, note: '' }].sort((a, b) => a.date.localeCompare(b.date)) };
    });
  const move = (by: number) => setAnchor((a) => (view === 'bulan' ? new Date(a.getFullYear(), a.getMonth() + by, 1) : addDays(a, by * 7)));
  const start = view === 'bulan' ? monday(new Date(anchor.getFullYear(), anchor.getMonth(), 1)) : monday(anchor);
  const weekEnd = addDays(start, 6);
  const today_ = new Date();
  const showingToday = view === 'bulan' ? anchor.getFullYear() === today_.getFullYear() && anchor.getMonth() === today_.getMonth() : today_ >= start && today_ < addDays(start, 7);
  const title =
    view === 'bulan'
      ? `${t(MONTHS[anchor.getMonth()]!)} ${anchor.getFullYear()}`
      : `${start.getDate()} ${t(MONTHS[start.getMonth()]!).slice(0, 3)} – ${weekEnd.getDate()} ${t(MONTHS[weekEnd.getMonth()]!).slice(0, 3)} ${weekEnd.getFullYear()}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pt-4 pb-6 lg:px-8">
      {/* The period on the left; going back, to today and on as one control by the view switch, as in a calendar app. */}
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 truncate text-[17px] font-semibold">{title}</span>
        <span className="flex h-9 items-center rounded-[10px] border border-line bg-panel p-0.5">
          <button type="button" onClick={() => move(-1)} aria-label={t('Sebelumnya')} title={t('Sebelumnya')} className="flex h-full items-center rounded-lg px-2 text-muted hover:bg-raised hover:text-fg">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => setAnchor(new Date())} disabled={showingToday} className="h-full rounded-lg px-3 text-xs font-medium text-fg hover:bg-raised disabled:text-faint disabled:hover:bg-transparent">
            {t('Hari ini')}
          </button>
          <button type="button" onClick={() => move(1)} aria-label={t('Berikutnya')} title={t('Berikutnya')} className="flex h-full items-center rounded-lg px-2 text-muted hover:bg-raised hover:text-fg">
            <ChevronRight size={16} />
          </button>
        </span>
        <span className="w-48">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'bulan', label: t('Bulan') },
              { value: 'minggu', label: t('Minggu') },
            ]}
          />
        </span>
      </div>

      {view === 'bulan' ? (
        <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-[auto_repeat(6,minmax(0,1fr))] overflow-hidden rounded-2xl border border-line-soft">
          {WEEKDAYS.map((d) => (
            <span key={d} className="border-b border-line-soft bg-panel px-2 py-1.5 text-[11px] font-medium text-faint">
              {t(d)}
            </span>
          ))}
          {Array.from({ length: 42 }, (_, i) => {
            const date = addDays(start, i);
            const day = dayKey(date);
            const list = items.get(day) ?? [];
            const off = blocked.get(day);
            const outside = date.getMonth() !== anchor.getMonth();
            return (
              <div
                key={day}
                onClick={(e) => e.target === e.currentTarget && onNewOn(day)}
                className={cx(
                  'group relative flex min-h-0 cursor-pointer flex-col gap-0.5 overflow-hidden border-r border-b border-line-soft p-1.5 hover:bg-panel',
                  i % 7 === 6 && 'border-r-0',
                  off && 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(201_106_106/0.08)_6px_12px)]',
                )}
              >
                <span className="pointer-events-none flex items-center justify-between">
                  <span className={cx('flex size-6 items-center justify-center rounded-full text-xs tabular-nums', day === now ? 'bg-gold font-semibold text-ink' : outside ? 'text-faint/60' : 'text-muted')}>{date.getDate()}</span>
                  {off && <span className="truncate text-[10px] text-reject">{off.note || t('Libur')}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => toggleBlocked(day)}
                  title={off ? t('Batalkan libur') : t('Tandai libur')}
                  aria-label={off ? t('Batalkan libur') : t('Tandai libur')}
                  className="absolute top-1.5 right-1.5 hidden rounded p-0.5 text-faint group-hover:block hover:text-reject"
                >
                  <Ban size={12} />
                </button>
                {list.slice(0, 3).map((it) => (
                  <button
                    key={it.session.id}
                    type="button"
                    onClick={() => onOpen(it.booking)}
                    className={cx('flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] hover:bg-raised', it.inactive && 'line-through opacity-50')}
                  >
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: it.color }} />
                    <span className="shrink-0 text-faint tabular-nums">{timeOf(it.session.start)}</span>
                    <span className="truncate">{titleOf(data, it.booking)}</span>
                  </button>
                ))}
                {list.length > 3 && (
                  <button type="button" onClick={() => (setAnchor(date), setView('minggu'))} className="px-1 text-left text-[10px] text-gold-text hover:underline">
                    {t('+{n} lagi', { n: list.length - 3 })}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line-soft">
          <div className="grid shrink-0 grid-cols-[48px_repeat(7,minmax(0,1fr))] border-b border-line-soft bg-panel">
            <span />
            {Array.from({ length: 7 }, (_, i) => {
              const date = addDays(start, i);
              const day = dayKey(date);
              const off = blocked.get(day);
              return (
                <button key={day} type="button" onClick={() => onNewOn(day)} className="flex flex-col items-start gap-0.5 border-l border-line-soft px-2 py-1.5 text-left hover:bg-raised">
                  <span className="text-[11px] text-faint">{t(WEEKDAYS[i]!)}</span>
                  <span className={cx('text-sm font-semibold tabular-nums', day === now && 'text-gold-text')}>{date.getDate()}</span>
                  {off && <span className="truncate text-[10px] text-reject">{off.note || t('Libur')}</span>}
                </button>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="relative grid grid-cols-[48px_repeat(7,minmax(0,1fr))]" style={{ height: (LAST_HOUR - FIRST_HOUR) * HOUR_PX }}>
              <div className="relative">
                {Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, h) => (
                  <span key={h} className="absolute right-2 -translate-y-1/2 text-[10px] text-faint tabular-nums" style={{ top: h * HOUR_PX }}>
                    {h ? `${String(FIRST_HOUR + h).padStart(2, '0')}:00` : ''}
                  </span>
                ))}
              </div>
              {Array.from({ length: 7 }, (_, i) => {
                const date = addDays(start, i);
                const day = dayKey(date);
                const list = items.get(day) ?? [];
                return (
                  <div
                    key={day}
                    onClick={(e) => e.target === e.currentTarget && onNewOn(day)}
                    className={cx('relative cursor-pointer border-l border-line-soft', blocked.has(day) && 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(201_106_106/0.08)_6px_12px)]')}
                    style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_PX - 1}px, var(--color-line-soft) ${HOUR_PX - 1}px ${HOUR_PX}px)` }}
                  >
                    {list.map((it, k) => {
                      const s = parseLocal(it.session.start);
                      const e = parseLocal(it.session.end);
                      const top = Math.max(0, (s.getHours() + s.getMinutes() / 60 - FIRST_HOUR) * HOUR_PX);
                      const endH = e.getDate() !== s.getDate() ? LAST_HOUR : e.getHours() + e.getMinutes() / 60;
                      const height = Math.max(22, (Math.min(LAST_HOUR, endH) - FIRST_HOUR) * HOUR_PX - top);
                      // Side by side when they overlap; simple halves are enough at this size.
                      const overlapping = list.filter((o) => parseLocal(o.session.start) < e && parseLocal(o.session.end) > s);
                      const col = overlapping.indexOf(it);
                      const w = 100 / Math.max(1, overlapping.length);
                      return (
                        <button
                          key={it.session.id + k}
                          type="button"
                          onClick={() => onOpen(it.booking)}
                          className={cx('absolute flex flex-col overflow-hidden rounded-md border-l-[3px] bg-raised px-1.5 py-1 text-left text-[11px] hover:brightness-110', it.inactive && 'opacity-50')}
                          style={{ top, height, left: `calc(${col * w}% + 2px)`, width: `calc(${w}% - 4px)`, borderColor: it.color }}
                        >
                          <span className="truncate font-semibold">{titleOf(data, it.booking)}</span>
                          <span className="truncate text-faint tabular-nums">
                            {timeOf(it.session.start)}–{timeOf(it.session.end)}
                            {it.session.label ? ` · ${it.session.label}` : ''}
                          </span>
                          {it.session.location && <span className="truncate text-faint">{it.session.location}</span>}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <p className="text-[11px] text-faint">{t('Klik tanggal kosong untuk booking baru. Arahkan ke tanggal lalu klik ikon di pojok kanan atasnya untuk menandai libur.')}</p>
    </div>
  );
}
