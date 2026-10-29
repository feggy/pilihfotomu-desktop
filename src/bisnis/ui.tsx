/** Small pieces every Kelola Bisnis screen uses: fields, a money box, a dialog. */

import { X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { popoverJustClosed } from '../components/date-picker';
import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { parseMoney } from './model';

/** For an email (or anything typed as written): no capital first letter, no autocorrect — the WebView adds both otherwise. */
export const PLAIN = { autoCapitalize: 'off', autoCorrect: 'off', spellCheck: false } as const;

export const inputCls = 'h-9 w-full rounded-lg border border-line bg-bg px-2.5 text-[13px] text-fg outline-none placeholder:text-faint focus:border-gold';

/** A field with its name over it. Not a <label>: a click on the name would open a date picker or a list. */
export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: ReactNode }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1 text-[11px] font-medium text-muted', className)}>
      <span className="cursor-default select-none">{label}</span>
      {children}
      {hint && <span className="text-[11px] font-normal text-faint">{hint}</span>}
    </div>
  );
}

/** Rupiah typed with its thousands dots shown as you type; the number out. */
export function MoneyInput({ value, onChange, className, placeholder }: { value: number; onChange: (n: number) => void; className?: string; placeholder?: string }) {
  const shown = value ? new Intl.NumberFormat('id-ID').format(value) : '';
  return (
    <span className={cx('relative flex items-center', className)}>
      <span className="pointer-events-none absolute left-2.5 text-[13px] text-faint">Rp</span>
      <input inputMode="numeric" value={shown} placeholder={placeholder ?? '0'} onChange={(e) => onChange(parseMoney(e.target.value))} className={cx(inputCls, 'pl-8 tabular-nums')} />
    </span>
  );
}

/**
 * A text box that saves when it loses focus (or Enter), not on every key: one undo-free write per edit.
 * `live`: every key goes to `onCommit` (for a draft kept until Simpan, so its bar shows as you type — and goes when typed back).
 */
export function LazyInput({ value, onCommit, className, placeholder, email, plain, live }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string; email?: boolean; plain?: boolean; live?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      {...(email ? { type: 'email', ...PLAIN } : plain ? PLAIN : {})}
      value={v}
      placeholder={placeholder}
      onChange={(e) => (setV(e.target.value), live && onCommit(e.target.value))}
      onBlur={() => (live ? v !== value && setV(value) : v !== value && onCommit(v))}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      className={className ?? inputCls}
    />
  );
}

/**
 * A whole number typed as digits (no system spinner), saved when the box is
 * left or on Enter and kept within min…max; a unit ("menit", "%") inside it.
 * An emptied box goes back to what it was.
 */
export function NumberInput({ value, onCommit, min = 0, max = Number.MAX_SAFE_INTEGER, unit, className, live }: { value: number; onCommit: (n: number) => void; min?: number; max?: number; unit?: string; className?: string; live?: boolean }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const digits = v.replace(/\D/g, '');
    const n = digits ? Math.min(max, Math.max(min, Number(digits))) : value;
    setV(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <span className={cx('relative flex items-center', className)}>
      <input
        inputMode="numeric"
        value={v}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '');
          setV(digits);
          // Live: a number in range goes to the draft as typed; the rest waits for the box to be left.
          if (live && digits && Number(digits) >= min && Number(digits) <= max && Number(digits) !== value) onCommit(Number(digits));
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        className={cx(inputCls, unit && 'pr-14', 'tabular-nums')}
      />
      {unit && <span className="pointer-events-none absolute right-2.5 text-[13px] text-faint">{unit}</span>}
    </span>
  );
}

/** Minutes, at least 15. */
export const MinutesInput = ({ value, onCommit }: { value: number; onCommit: (minutes: number) => void }) => <NumberInput value={value} onCommit={onCommit} min={15} unit={t('menit')} />;

/** A longer text that saves when it loses focus (`live`: on every key, as LazyInput). */
export function TextArea({ value, onCommit, rows = 3, placeholder, live }: { value: string; onCommit: (v: string) => void; rows?: number; placeholder?: string; live?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      value={v}
      rows={rows}
      placeholder={placeholder}
      onChange={(e) => (setV(e.target.value), live && onCommit(e.target.value))}
      onBlur={() => !live && v !== value && onCommit(v)}
      className={cx(inputCls, 'h-auto resize-y py-2')}
    />
  );
}

/** What is open, oldest first; Escape closes only the last (a dialog over the booking drawer, not the drawer under it). */
const escapes: (() => void)[] = [];
let listening = false;

/** `onEscape` on Escape while `active`, unless something opened later is still open over it. */
export function useEscape(onEscape: () => void, active = true) {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const run = () => latest.current();
    escapes.push(run);
    if (!listening) {
      listening = true;
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || e.defaultPrevented || !escapes.length) return;
        e.preventDefault();
        escapes.at(-1)!();
      });
    }
    return () => void escapes.splice(escapes.indexOf(run), 1);
  }, [active]);
}

/**
 * A dialog over the page. With `dirty` (a form with changes not saved),
 * Escape, a click outside or × ask first instead of throwing the changes
 * away; Batal in the form's own footer still just closes.
 */
export function Dialog({ title, onClose, children, footer, width = 560, dirty = false }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; dirty?: boolean }) {
  const [asking, setAsking] = useState(false);
  const leave = () => (dirty ? setAsking(true) : onClose());
  useEscape(() => (asking ? setAsking(false) : leave()));
  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => !popoverJustClosed() && leave()}>
      <div
        role="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        className="relative flex max-h-full max-w-full flex-col rounded-[18px] border border-line bg-panel shadow-2xl"
        style={{ width }}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line-soft px-6 py-4">
          <h2 className="min-w-0 truncate text-lg font-semibold">{title}</h2>
          <button type="button" onClick={leave} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>
        <div className="flex min-h-0 flex-col gap-5 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-line-soft px-6 py-3.5">{footer}</div>}
        {asking && (
          <div className="absolute inset-0 flex items-center justify-center rounded-[18px] bg-black/60 p-6">
            <div className="flex w-[360px] max-w-full flex-col gap-3 rounded-2xl border border-line bg-panel-2 p-5 shadow-2xl">
              <span className="text-[15px] font-semibold">{t('Perubahan belum disimpan')}</span>
              <span className="text-[13px] text-muted">{t('Kalau ditutup sekarang, perubahannya hilang.')}</span>
              <span className="mt-1 flex justify-end gap-2">
                <button type="button" autoFocus onClick={() => setAsking(false)} className={btnPlain}>
                  {t('Tetap di sini')}
                </button>
                <button type="button" onClick={onClose} className={btnPrimary}>
                  {t('Buang perubahan')}
                </button>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-[11px] font-semibold tracking-wide text-faint uppercase">{children}</h3>
      {action}
    </div>
  );
}

export function Empty({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <span className="text-gold-text">{icon}</span>
      <span className="text-[15px] font-semibold">{title}</span>
      <p className="max-w-[440px] text-xs text-muted">{text}</p>
      {action}
    </div>
  );
}

export const btnPrimary = 'flex h-9 items-center gap-2 rounded-[10px] bg-gold-gradient px-4 text-[13px] font-semibold text-white disabled:opacity-50';
export const btnGhost = 'flex h-9 items-center gap-2 rounded-[10px] border border-line bg-panel px-3 text-[13px] font-medium text-fg hover:border-faint disabled:opacity-50';
export const btnPlain = 'flex h-9 items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium text-muted hover:text-fg';
