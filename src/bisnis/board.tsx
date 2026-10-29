/**
 * The board: a column per stage, a card per booking. Cards are dragged to
 * another column or another place in theirs, or moved a column along with
 * the arrows; a click opens the booking.
 */

import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useState } from 'react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { PAY_COLOR, PAY_LABEL, balanceOf, clashesOf, nextSession, payState, rupiah, shortDate, timeOf, titleOf, totalOf } from './model';
import { useBisnis } from './store';
import type { BisnisData, Booking } from './types';

/** `id` put in column `columnId` before booking `before` (or last); the column numbered again. */
export function moveBooking(d: BisnisData, id: string, columnId: string, before: string | null): BisnisData {
  const moving = d.bookings.find((b) => b.id === id);
  if (!moving) return d;
  const column = d.bookings.filter((b) => b.columnId === columnId && b.id !== id).sort((a, b) => a.order - b.order);
  const at = before ? column.findIndex((b) => b.id === before) : -1;
  column.splice(at < 0 ? column.length : at, 0, { ...moving, columnId });
  const order = new Map(column.map((b, i) => [b.id, i]));
  const now = Date.now();
  return {
    ...d,
    bookings: d.bookings.map((b) => (order.has(b.id) ? { ...b, columnId, order: order.get(b.id)!, updatedAt: b.id === id ? now : b.updatedAt } : b)),
  };
}

export function Board({ onOpen, onNew }: { onOpen: (b: Booking) => void; onNew: (columnId: string) => void }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<{ column: string; before: string | null } | null>(null);
  const drop = () => {
    if (dragging && over) update((d) => moveBooking(d, dragging, over.column, over.before));
    setDragging(null);
    setOver(null);
  };
  const step = (b: Booking, by: number) => {
    const i = data.columns.findIndex((c) => c.id === b.columnId);
    const to = data.columns[i + by];
    if (to) update((d) => moveBooking(d, b.id, to.id, null));
  };

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 pt-4 pb-6 lg:px-8">
      {data.columns.map((col, ci) => {
        const cards = data.bookings.filter((b) => b.columnId === col.id).sort((a, b) => a.order - b.order);
        const sum = cards.reduce((s, b) => s + totalOf(b), 0);
        const target = over?.column === col.id;
        return (
          <section
            key={col.id}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              if (over?.column !== col.id || (e.target as HTMLElement).dataset.column) setOver({ column: col.id, before: null });
            }}
            onDrop={(e) => (e.preventDefault(), drop())}
            className={cx('flex w-[272px] shrink-0 flex-col rounded-2xl bg-panel', target && 'ring-2 ring-gold/60', col.inactive && 'opacity-80')}
          >
            <header className="flex items-center gap-2 px-3.5 pt-3 pb-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: col.color }} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{col.name}</span>
              <span className="text-[11px] text-faint tabular-nums">{cards.length}</span>
              <button type="button" onClick={() => onNew(col.id)} title={t('Booking baru di {col}', { col: col.name })} aria-label={t('Booking baru di {col}', { col: col.name })} className="rounded-md p-1 text-faint hover:bg-raised hover:text-fg">
                <Plus size={14} />
              </button>
            </header>
            {sum > 0 && !col.inactive && <span className="-mt-1 px-3.5 pb-2 text-[11px] text-faint tabular-nums">{rupiah(sum)}</span>}
            <div data-column={col.id} className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2.5 pb-3">
              {cards.map((b) => (
                <Card
                  key={b.id}
                  data={data}
                  booking={b}
                  dragging={dragging === b.id}
                  dropBefore={target && over?.before === b.id}
                  onOpen={() => onOpen(b)}
                  onDragStart={() => setDragging(b.id)}
                  onDragEnd={() => (setDragging(null), setOver(null))}
                  onDragOver={() => dragging && dragging !== b.id && setOver({ column: col.id, before: b.id })}
                  onLeft={ci > 0 ? () => step(b, -1) : undefined}
                  onRight={ci < data.columns.length - 1 ? () => step(b, 1) : undefined}
                />
              ))}
              {cards.length === 0 && <span data-column={col.id} className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line-soft py-6 text-[11px] text-faint">{t('Seret kartu ke sini')}</span>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Card({
  data,
  booking: b,
  dragging,
  dropBefore,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
  onLeft,
  onRight,
}: {
  data: BisnisData;
  booking: Booking;
  dragging: boolean;
  dropBefore: boolean;
  onOpen: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onLeft?: () => void;
  onRight?: () => void;
}) {
  const next = nextSession(b);
  const pay = payState(b);
  const clash = b.sessions.some((s) => clashesOf(data, b, s).length > 0) && !data.columns.find((c) => c.id === b.columnId)?.inactive;
  return (
    <>
      {dropBefore && <span className="h-1 shrink-0 rounded-full bg-gold" />}
      <div
        role="button"
        tabIndex={0}
        draggable
        onDragStart={(e) => (e.dataTransfer.setData('text/plain', b.id), (e.dataTransfer.effectAllowed = 'move'), onDragStart())}
        onDragEnd={onDragEnd}
        onDragOver={(e) => (e.preventDefault(), e.stopPropagation(), onDragOver())}
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        className={cx('group flex cursor-pointer flex-col gap-1.5 rounded-xl border border-line-soft bg-panel-2 p-3 text-left transition-colors hover:border-line', dragging && 'opacity-40')}
      >
        <span className="flex items-start gap-1.5">
          <span className="min-w-0 flex-1 text-[13px] leading-snug font-semibold">{titleOf(data, b)}</span>
          {clash && (
            <span title={t('Ada jadwal yang bentrok')}>
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-maybe" />
            </span>
          )}
        </span>
        {b.packageName && <span className="truncate text-[11px] text-muted">{b.packageName}</span>}
        <span className="flex items-center gap-1.5 text-[11px] text-faint">
          <CalendarDays size={12} className="shrink-0" />
          {next ? `${shortDate(next.start.split('T')[0]!)} · ${timeOf(next.start)}${b.sessions.length > 1 ? ` · ${t('{n} jadwal', { n: b.sessions.length })}` : ''}` : t('Belum ada jadwal')}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: PAY_COLOR[pay] }}>
            <span className="size-1.5 rounded-full" style={{ background: PAY_COLOR[pay] }} />
            {t(PAY_LABEL[pay])}
            {pay === 'dp' && <span className="font-normal text-faint">· {t('sisa {n}', { n: rupiah(balanceOf(b)) })}</span>}
          </span>
          <span className="flex opacity-0 transition-opacity group-hover:opacity-100">
            {onLeft && (
              <button type="button" onClick={(e) => (e.stopPropagation(), onLeft())} title={t('Pindah ke kolom sebelumnya')} aria-label={t('Pindah ke kolom sebelumnya')} className="rounded p-0.5 text-faint hover:bg-raised hover:text-fg">
                <ChevronLeft size={14} />
              </button>
            )}
            {onRight && (
              <button type="button" onClick={(e) => (e.stopPropagation(), onRight())} title={t('Pindah ke kolom berikutnya')} aria-label={t('Pindah ke kolom berikutnya')} className="rounded p-0.5 text-faint hover:bg-raised hover:text-fg">
                <ChevronRight size={14} />
              </button>
            )}
          </span>
        </span>
      </div>
    </>
  );
}
