/**
 * The board: a column per stage, a card per booking. Cards are dragged (held
 * and moved) to another column or another place in theirs, or moved a column along with
 * the arrows; a click opens the booking.
 */

import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { Fragment, useRef, useState } from 'react';

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

/**
 * A card being dragged. Done with pointer events, not HTML drag and drop:
 * the window takes drags for dropping files in (Tauri), so the webview's
 * own never fire.
 */
interface Drag {
  id: string;
  x: number;
  y: number;
  /** Where on the card it was taken, so it stays under the pointer there. */
  dx: number;
  dy: number;
  width: number;
}

export function Board({ onOpen, onNew }: { onOpen: (b: Booking) => void; onNew: (columnId: string) => void }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<{ column: string; before: string | null } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  // A drag ends with a click on the card under it; that one is not an open.
  const justDragged = useRef(false);
  const step = (b: Booking, by: number) => {
    const i = data.columns.findIndex((c) => c.id === b.columnId);
    const to = data.columns[i + by];
    if (to) update((d) => moveBooking(d, b.id, to.id, null));
  };

  /** Where a card let go at (x, y) goes: the column under it, before the card whose upper half it is on. */
  const targetAt = (x: number, y: number, id: string) => {
    const hit = document.elementsFromPoint(x, y);
    const column = hit.map((el) => (el as HTMLElement).closest<HTMLElement>('[data-column-id]')).find(Boolean)?.dataset.columnId;
    if (!column) return null;
    const cards = [...document.querySelectorAll<HTMLElement>(`[data-column-id="${column}"] [data-card-id]`)].filter((el) => el.dataset.cardId !== id);
    const before = cards.find((el) => {
      const r = el.getBoundingClientRect();
      return y < r.top + r.height / 2;
    });
    return { column, before: before?.dataset.cardId ?? null };
  };

  const start = (e: React.PointerEvent, b: Booking) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const card = e.currentTarget.getBoundingClientRect();
    const from = { x: e.clientX, y: e.clientY };
    let moving: Drag | null = null;
    let scroll = 0;
    let frame = 0;
    // Near the board's left or right edge, it scrolls that way while held there.
    const roll = () => {
      if (scroll && boardRef.current) boardRef.current.scrollLeft += scroll;
      frame = requestAnimationFrame(roll);
    };
    const move = (ev: PointerEvent) => {
      if (!moving) {
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 5) return;
        moving = { id: b.id, x: 0, y: 0, dx: from.x - card.left, dy: from.y - card.top, width: card.width };
        frame = requestAnimationFrame(roll);
      }
      moving = { ...moving, x: ev.clientX, y: ev.clientY };
      setDrag(moving);
      setOver(targetAt(ev.clientX, ev.clientY, b.id));
      const box = boardRef.current?.getBoundingClientRect();
      scroll = !box ? 0 : ev.clientX < box.left + 60 ? -12 : ev.clientX > box.right - 60 ? 12 : 0;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cancelAnimationFrame(frame);
      if (moving) {
        const to = targetAt(ev.clientX, ev.clientY, b.id);
        if (to) update((d) => moveBooking(d, b.id, to.column, to.before));
        justDragged.current = true;
        window.setTimeout(() => (justDragged.current = false), 0);
      }
      setDrag(null);
      setOver(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const dragged = drag && data.bookings.find((b) => b.id === drag.id);
  return (
    <div ref={boardRef} className={cx('flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 pt-4 pb-6 select-none lg:px-8', drag && 'cursor-grabbing')}>
      {data.columns.map((col, ci) => {
        const cards = data.bookings.filter((b) => b.columnId === col.id).sort((a, b) => a.order - b.order);
        const sum = cards.reduce((s, b) => s + totalOf(b), 0);
        const target = !!drag && over?.column === col.id;
        return (
          <section key={col.id} data-column-id={col.id} className={cx('flex w-[272px] shrink-0 flex-col rounded-2xl bg-panel', target && 'ring-2 ring-gold/60', col.inactive && 'opacity-80')}>
            <header className="flex items-center gap-2 px-3.5 pt-3 pb-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: col.color }} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{col.name}</span>
              <span className="text-[11px] text-faint tabular-nums">{cards.length}</span>
              <button type="button" onClick={() => onNew(col.id)} title={t('Booking baru di {col}', { col: col.name })} aria-label={t('Booking baru di {col}', { col: col.name })} className="rounded-md p-1 text-faint hover:bg-raised hover:text-fg">
                <Plus size={14} />
              </button>
            </header>
            {sum > 0 && !col.inactive && <span className="-mt-1 px-3.5 pb-2 text-[11px] text-faint tabular-nums">{rupiah(sum)}</span>}
            <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2.5 pb-3">
              {cards.map((b) => (
                <Fragment key={b.id}>
                  {target && over?.before === b.id && <span className="h-1 shrink-0 rounded-full bg-gold" />}
                  <div
                    role="button"
                    tabIndex={0}
                    data-card-id={b.id}
                    onPointerDown={(e) => start(e, b)}
                    onClick={() => !justDragged.current && onOpen(b)}
                    onKeyDown={(e) => e.key === 'Enter' && onOpen(b)}
                    className={cx('group cursor-pointer rounded-xl border border-line-soft bg-panel-2 p-3 transition-colors hover:border-line', drag?.id === b.id && 'opacity-40')}
                  >
                    <CardFace data={data} booking={b} onLeft={ci > 0 ? () => step(b, -1) : undefined} onRight={ci < data.columns.length - 1 ? () => step(b, 1) : undefined} />
                  </div>
                </Fragment>
              ))}
              {target && over?.before === null && cards.some((b) => b.id !== drag?.id) && <span className="h-1 shrink-0 rounded-full bg-gold" />}
              {cards.length === 0 && <span className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line-soft py-6 text-[11px] text-faint">{t('Seret kartu ke sini')}</span>}
            </div>
          </section>
        );
      })}
      {drag && dragged && (
        <div className="pointer-events-none fixed z-50 rotate-2 rounded-xl border border-gold/60 bg-panel-2 p-3 shadow-[0_16px_40px_rgb(0_0_0/0.5)]" style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width }}>
          <CardFace data={data} booking={dragged} />
        </div>
      )}
    </div>
  );
}

/** What a card shows: who, the package, the next session, payment; arrows to move it a column along. */
function CardFace({ data, booking: b, onLeft, onRight }: { data: BisnisData; booking: Booking; onLeft?: () => void; onRight?: () => void }) {
  const next = nextSession(b);
  const pay = payState(b);
  const clash = b.sessions.some((s) => clashesOf(data, b, s).length > 0) && !data.columns.find((c) => c.id === b.columnId)?.inactive;
  return (
    <span className="flex flex-col gap-1.5 text-left">
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
    </span>
  );
}
