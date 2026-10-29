/**
 * A choice from a list, drawn by the app instead of the system's menu: the
 * same look as the date and time fields, a colour dot or a note beside an
 * option where it helps (a stage, the stage a template is for). Arrow keys,
 * Enter and Escape work as in a system menu.
 */

import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

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
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className,
  placeholder = '—',
  'aria-label': ariaLabel,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  placeholder?: string;
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
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (o: SelectOption<T>) => {
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
    if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(options.length - 1, i + 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
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
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={key}
        className={cx('flex h-9 w-full min-w-0 items-center gap-2 rounded-lg border border-line bg-bg px-2.5 text-left text-[13px] text-fg outline-none focus:border-gold', open && 'border-gold', className)}
      >
        {current?.color && <span className="size-2 shrink-0 rounded-full" style={{ background: current.color }} />}
        <span className={cx('min-w-0 flex-1 truncate', !current && 'text-faint')}>
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
              <button
                key={o.value}
                data-i={i}
                type="button"
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
                className={cx('flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px]', i === active && 'bg-raised', o.value === value ? 'font-semibold text-fg' : 'text-muted')}
              >
                {o.color && <span className="size-2 shrink-0 rounded-full" style={{ background: o.color }} />}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
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
