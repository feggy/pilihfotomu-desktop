/**
 * Date and time fields drawn by the app instead of the system's: the same
 * look everywhere (and on every OS), Monday-first weeks and Indonesian
 * month names. The pop-up opens on the page itself (a portal, fixed to the
 * field), so a scrolling dialog doesn't cut it off.
 */

import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { t } from '../lib/i18n';
import { cx } from './ui';

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];
const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

let closedAt = -1e9;
/** A pop-up was just closed by this press: a dialog's backdrop under it leaves the press at that, not closing too. */
export const popoverJustClosed = () => performance.now() - closedAt < 400;

/** A pop-up under (or, without room, over) `anchor`; closed by a click elsewhere or Escape. */
export function Popover({ anchor, onClose, width, children, className = 'p-3' }: { anchor: RefObject<HTMLElement | null>; onClose: () => void; width: number; children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      const h = box.current?.offsetHeight ?? 320;
      if (!r) return;
      const below = r.bottom + 6 + h <= window.innerHeight - 8;
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)), top: below ? r.bottom + 6 : Math.max(8, r.top - 6 - h) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, width]);
  // Closed by a press anywhere else: pointerdown, since a canvas or slider that
  // prevents it there means no mousedown ever comes. And when the window loses focus.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return;
      closedAt = performance.now();
      close.current();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), close.current());
    const blur = () => close.current();
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', blur);
    };
  }, [anchor]);
  return createPortal(
    <div
      ref={box}
      onMouseDown={(e) => e.stopPropagation()}
      className={cx('fixed z-[60] rounded-xl border border-line bg-panel-2 shadow-2xl', className)}
      style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

const fieldCls = 'flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-bg px-2.5 text-left text-[13px] outline-none focus:border-gold';

/** A day, "YYYY-MM-DD" ('' for none): shown as "30 Okt 2026", picked on a calendar. */
export function DateInput({
  value,
  onChange,
  placeholder,
  clearable = true,
  className,
}: {
  value: string;
  onChange: (day: string) => void;
  placeholder?: string;
  /** "Hapus" in the calendar, for an optional day. */
  clearable?: boolean;
  className?: string;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const picked = parse(value);
  const [month, setMonth] = useState(() => picked ?? new Date());
  useEffect(() => {
    if (open) setMonth(picked ?? new Date());
  }, [open]);
  const today = key(new Date());
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - ((first.getDay() + 6) % 7));
  const pick = (d: string) => (onChange(d), setOpen(false));

  return (
    <>
      <button ref={anchor} type="button" onClick={() => setOpen((v) => !v)} className={cx(fieldCls, open && 'border-gold', className)}>
        <CalendarDays size={14} className="shrink-0 text-faint" />
        <span className={cx('min-w-0 flex-1 truncate tabular-nums', !picked && 'text-faint')}>
          {picked ? `${picked.getDate()} ${t(MONTHS[picked.getMonth()]!).slice(0, 3)} ${picked.getFullYear()}` : (placeholder ?? t('Pilih tanggal'))}
        </span>
      </button>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={264}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label={t('Bulan sebelumnya')} className="rounded-md p-1 text-muted hover:bg-raised hover:text-fg">
              <ChevronLeft size={15} />
            </button>
            <span className="text-[13px] font-semibold">
              {t(MONTHS[month.getMonth()]!)} {month.getFullYear()}
            </span>
            <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label={t('Bulan berikutnya')} className="rounded-md p-1 text-muted hover:bg-raised hover:text-fg">
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((d) => (
              <span key={d} className="py-1 text-[10px] font-medium text-faint">
                {t(d)}
              </span>
            ))}
            {Array.from({ length: 42 }, (_, i) => {
              const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
              const k = key(d);
              const outside = d.getMonth() !== month.getMonth();
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => pick(k)}
                  className={cx(
                    'flex h-8 items-center justify-center rounded-md text-xs tabular-nums',
                    k === value ? 'bg-gold font-semibold text-ink' : k === today ? 'font-semibold text-gold-text ring-1 ring-gold/50 hover:bg-raised' : outside ? 'text-faint/50 hover:bg-raised' : 'text-fg hover:bg-raised',
                  )}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-line-soft pt-2">
            <button type="button" onClick={() => pick(today)} className="rounded-md px-2 py-1 text-xs font-medium text-gold-text hover:bg-raised">
              {t('Hari ini')}
            </button>
            {clearable && value && (
              <button type="button" onClick={() => pick('')} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-raised hover:text-fg">
                {t('Hapus')}
              </button>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}

/** "HH:mm" as typed ("930", "9.30", "09:30") or picked from a list every 15 minutes. */
export function TimeInput({ value, onChange, className }: { value: string; onChange: (time: string) => void; className?: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(value);
  useEffect(() => setTyped(value), [value]);
  // The chosen time in view when the list opens.
  useEffect(() => {
    if (open) requestAnimationFrame(() => list.current?.querySelector('[data-on]')?.scrollIntoView({ block: 'center' }));
  }, [open]);
  const commit = (s: string) => {
    const digits = s.replace(/\D/g, '');
    if (!digits) return setTyped(value);
    const h = Number(digits.length <= 2 ? digits : digits.slice(0, digits.length - 2));
    const m = digits.length <= 2 ? 0 : Number(digits.slice(-2));
    if (h > 23 || m > 59) return setTyped(value);
    const next = `${pad(h)}:${pad(m)}`;
    setTyped(next);
    if (next !== value) onChange(next);
  };
  const times = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`);
  return (
    <>
      <div ref={anchor} className={cx(fieldCls, 'cursor-text focus-within:border-gold', className)}>
        <Clock size={14} className="shrink-0 text-faint" />
        <input
          value={typed}
          inputMode="numeric"
          onFocus={(e) => (setOpen(true), e.currentTarget.select())}
          onChange={(e) => setTyped(e.target.value)}
          onBlur={() => commit(typed)}
          onKeyDown={(e) => e.key === 'Enter' && (commit(typed), setOpen(false), e.currentTarget.blur())}
          className="w-full min-w-0 bg-transparent tabular-nums outline-none"
        />
      </div>
      {open && (
        <Popover anchor={anchor} onClose={() => setOpen(false)} width={120}>
          <div ref={list} className="-m-1.5 flex max-h-56 flex-col overflow-y-auto">
            {times.map((x) => (
              <button
                key={x}
                type="button"
                data-on={x === value || undefined}
                onClick={() => (setTyped(x), onChange(x), setOpen(false))}
                className={cx('rounded-md px-3 py-1.5 text-left text-xs tabular-nums', x === value ? 'bg-gold font-semibold text-ink' : 'text-fg hover:bg-raised')}
              >
                {x}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
