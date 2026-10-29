/**
 * A tool's panel under Edit foto's tool strip, as Lightroom draws it: a
 * framed box, "Alat:" and the tool's name on top, its settings in rows
 * divided by lines, and Reset | Selesai at the foot.
 */

import { cx } from '../components/ui';
import { t } from '../lib/i18n';

export function ToolBox({
  title,
  children,
  onReset,
  resetDisabled,
  onClose,
  closeTitle,
}: {
  title: string;
  children: React.ReactNode;
  onReset?: () => void;
  resetDisabled?: boolean;
  /** Without it the box has no foot: the tool keeps its own buttons (Masking). */
  onClose?: () => void;
  closeTitle?: string;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-line-soft bg-panel-2">
      <div className="flex h-10 items-center justify-between gap-3 border-b border-line-soft px-3">
        <span className="text-xs text-faint">{t('Alat:')}</span>
        <span className="truncate text-[13px] font-semibold">{title}</span>
      </div>
      <div className="flex flex-col divide-y divide-line-soft">{children}</div>
      {onClose && (
      <div className="flex h-10 items-center justify-end gap-3 border-t border-line-soft px-3 text-[13px]">
        {onReset && (
          <>
            <button type="button" onClick={onReset} disabled={resetDisabled} className="text-muted hover:text-fg disabled:opacity-40 disabled:hover:text-muted">
              {t('Reset')}
            </button>
            <span className="h-3.5 w-px bg-line" />
          </>
        )}
        <button type="button" onClick={onClose} title={closeTitle} className="font-semibold text-gold-text hover:text-fg">
          {t('Selesai')}
        </button>
      </div>
      )}
    </div>
  );
}

/** One row of a ToolBox. */
export function ToolRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('flex flex-col gap-2.5 px-3 py-3', className)}>{children}</div>;
}
