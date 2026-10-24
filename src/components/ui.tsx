import { Check, CircleHelp, Star, X, type LucideIcon } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import type { Status } from '../lib/api';
import { STATUS } from '../lib/format';
import { t } from '../lib/i18n';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'plain' | 'danger';
  icon?: LucideIcon;
  kbd?: string;
  size?: 'md' | 'lg';
};

export function Button({ variant = 'ghost', icon: Icon, kbd, size = 'md', className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        size === 'lg' ? 'h-12 px-5 text-[15px] font-semibold' : 'h-[34px] px-3.5 text-[13px]',
        variant === 'primary' && 'bg-gold-gradient text-white',
        variant === 'ghost' && 'border border-line bg-raised text-fg hover:not-disabled:bg-line',
        variant === 'plain' && 'text-fg hover:not-disabled:bg-raised',
        variant === 'danger' && 'bg-reject font-semibold text-bg',
        className,
      )}
    >
      {Icon && <Icon size={size === 'lg' ? 18 : 15} className={variant === 'ghost' ? 'text-muted' : undefined} />}
      {children}
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  );
}

export function IconButton({
  icon: Icon,
  label,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={cx(
        'inline-flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border border-line bg-raised text-muted hover:bg-line disabled:opacity-45',
        className,
      )}
    >
      <Icon size={15} />
    </button>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-[18px] items-center rounded border border-line bg-bg px-1.5 text-[10px] font-medium text-faint">
      {children}
    </span>
  );
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return <span className="inline-block shrink-0 rounded-full" style={{ width: size, height: size, background: color }} />;
}

/** A tinted label: the color at low opacity behind text in that color. */
export function Chip({ color, icon: Icon, children }: { color: string; icon?: LucideIcon; children: ReactNode }) {
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-[7px] text-[11px] font-medium whitespace-nowrap"
      style={{ color, background: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      {Icon && <Icon size={11} />}
      {children}
    </span>
  );
}

export function Stars({ value, size = 10 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={t('{n} bintang', { n: value })}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          className={i <= value ? 'fill-gold-text text-gold-text' : 'text-line'}
          strokeWidth={i <= value ? 1.5 : 2}
        />
      ))}
    </span>
  );
}

export function StatusBadge({ status, size = 22 }: { status: Status; size?: number }) {
  const s = STATUS[status];
  const Icon = STATUS_ICON[status];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full text-bg"
      style={{ width: size, height: size, background: s.color }}
      title={s.one}
    >
      <Icon size={Math.round(size * 0.58)} strokeWidth={3} />
    </span>
  );
}

export const STATUS_ICON: Record<Status, LucideIcon> = { pick: Check, maybe: CircleHelp, reject: X };

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'flex h-5 w-9 shrink-0 items-center rounded-full px-0.5 transition-colors disabled:opacity-40',
        checked ? 'justify-end bg-pick' : 'justify-start bg-line',
      )}
    >
      <span className="size-4 rounded-full bg-white" />
    </button>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 rounded-[10px] bg-panel p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            'flex h-[30px] flex-1 items-center justify-center gap-2 rounded-lg px-3 text-[13px]',
            o.value === value ? 'border border-line bg-raised font-semibold text-fg' : 'font-medium text-muted hover:text-fg',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Small square icon tile used in front of list rows and cards. */
export function IconTile({ icon: Icon, size = 34, color = 'var(--color-muted)', className }: { icon: LucideIcon; size?: number; color?: string; className?: string }) {
  return (
    <span
      className={cx('inline-flex shrink-0 items-center justify-center rounded-[10px] bg-raised', className)}
      style={{ width: size, height: size, color }}
    >
      <Icon size={Math.round(size * 0.47)} />
    </span>
  );
}
