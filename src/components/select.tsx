/**
 * A choice from a list, drawn by the app instead of the system's menu: the
 * same look as the date and time fields, a colour dot or a note beside an
 * option where it helps (a stage, the stage a template is for). Arrow keys,
 * Enter and Escape work as in a system menu.
 */

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { Popover } from './date-picker';
import { cx } from './ui';

export interface SelectOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Shown faint after the label ("DP masuk"). */
  note?: ReactNode;
  /** A dot in this colour before the label. */
  color?: string;
  /** A line above this option, to set it apart ("+ Kategori baru…"). */
  divided?: boolean;
  /** Options under one heading ("Serif", "Sans"): a heading shows where it changes. */
  group?: string;
  /** For the label: a font's own face, say. */
  style?: CSSProperties;
  disabled?: boolean;
}

const SIZES = {
  md: 'h-9 rounded-lg px-2.5 text-[13px]',
  sm: 'h-8 rounded-lg px-2.5 text-xs',
  xs: 'h-7 rounded-md px-1.5 text-xs',
} as const;

export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  placeholder = '—',
  size = 'md',
  bare = false,
  disabled = false,
  'aria-label': ariaLabel,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** Width and the like; the height comes from `size`. */
  className?: string;
  placeholder?: string;
  size?: keyof typeof SIZES;
  /** No box of its own (it sits inside one). */
  bare?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const field = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const current = options.find((o) => o.value === value);
  const [width, setWidth] = useState(220);

  const show = () => {
    setWidth(Math.max(180, field.current?.offsetWidth ?? 220));
    setActive(Math.max(0, options.findIndex((o) => o.value === value && !o.disabled)));
    setOpen(true);
  };
  const pick = (o: SelectOption<T>) => {
    if (o.disabled) return;
    setOpen(false);
    field.current?.focus();
    if (o.value !== value) onChange(o.value);
  };
  // The highlighted option kept in view as the arrows move it.
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const key = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) (e.preventDefault(), show());
      return;
    }
    // The next one that can be picked, that way.
    const go = (by: 1 | -1) =>
      setActive((i) => {
        for (let j = i + by; j >= 0 && j < options.length; j += by) if (!options[j]!.disabled) return j;
        return i;
      });
    if (e.key === 'ArrowDown') (e.preventDefault(), go(1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), go(-1));
    else if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), options[active] && pick(options[active]!));
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <>
      <button
        ref={field}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={key}
        className={cx(
          'flex w-full min-w-0 items-center gap-2 text-left text-fg outline-none disabled:opacity-50',
          SIZES[size],
          bare ? 'border-0 bg-transparent px-0' : cx('border bg-bg focus:border-gold', open ? 'border-gold' : 'border-line'),
          className,
        )}
      >
        {current?.color && <span className="size-2 shrink-0 rounded-full" style={{ background: current.color }} />}
        <span className={cx('min-w-0 flex-1 truncate', !current && 'text-faint')} style={current?.style}>
          {current ? current.label : placeholder}
          {current?.note && <span className="text-faint"> · {current.note}</span>}
        </span>
        <ChevronDown size={14} className={cx('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <Popover anchor={field} onClose={() => setOpen(false)} width={width} className="p-1">
          <div ref={list} role="listbox" className="flex max-h-72 flex-col overflow-y-auto">
            {options.map((o, i) => [
              o.divided && <span key={`${o.value}-line`} className="mx-1 my-1 h-px shrink-0 bg-line-soft" />,
              o.group && o.group !== options[i - 1]?.group && (
                <span key={`${o.value}-group`} className="shrink-0 px-2.5 pt-2 pb-0.5 text-[10px] font-semibold tracking-wide text-faint uppercase">
                  {o.group}
                </span>
              ),
              <button
                key={o.value}
                data-i={i}
                type="button"
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled}
                onMouseEnter={() => !o.disabled && setActive(i)}
                onClick={() => pick(o)}
                className={cx(
                  'flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px]',
                  o.disabled ? 'cursor-default opacity-40' : i === active && 'bg-raised',
                  o.value === value ? 'font-semibold text-fg' : 'text-muted',
                )}
              >
                {o.color && <span className="size-2 shrink-0 rounded-full" style={{ background: o.color }} />}
                <span className="min-w-0 flex-1 truncate" style={o.style}>
                  {o.label}
                </span>
                {o.note && <span className="shrink-0 text-[11px] font-normal text-faint">{o.note}</span>}
                <Check size={13} className={cx('shrink-0 text-gold-text', o.value !== value && 'invisible')} />
              </button>,
            ])}
          </div>
        </Popover>
      )}
    </>
  );
}
