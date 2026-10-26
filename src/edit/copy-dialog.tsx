/**
 * Salin / Sinkronkan pengaturan: which groups go across, as Lightroom's Copy
 * Settings and Synchronize dialogs. The develop groups are on by default;
 * the crop and the masks (made for one photo) only when ticked.
 */

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, cx } from '../components/ui';
import { t } from '../lib/i18n';
import { SYNC_GROUPS, type AdjustGroup } from '../kreasi/engine/document';
import { applyLook } from './looks';
import type { EditSettings } from './geometry';

export interface CopyChoice {
  groups: AdjustGroup[];
  crop: boolean;
  masks: boolean;
}

export const DEFAULT_CHOICE: CopyChoice = { groups: SYNC_GROUPS.map((g) => g.id), crop: false, masks: false };

/** `target` with what `choice` takes from `from`. */
export function applyChoice(from: EditSettings, target: EditSettings, choice: CopyChoice): EditSettings {
  const out: EditSettings = applyLook(from, target, new Set(choice.groups));
  if (choice.crop) out.geometry = from.geometry;
  if (choice.masks) out.masks = from.masks;
  return out;
}

export function CopyDialog({
  title,
  action,
  initial,
  onConfirm,
  onClose,
}: {
  title: string;
  action: string;
  initial: CopyChoice;
  onConfirm: (c: CopyChoice) => void;
  onClose: () => void;
}) {
  const [c, setC] = useState(initial);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Enter') onConfirm(c);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const toggle = (g: AdjustGroup) => setC((x) => ({ ...x, groups: x.groups.includes(g) ? x.groups.filter((y) => y !== g) : [...x.groups, g] }));
  const all = c.groups.length === SYNC_GROUPS.length && c.crop && c.masks;
  const row = (on: boolean, label: string, detail: string, flip: () => void) => (
    <label key={label} className={cx('flex items-start gap-3 rounded-lg p-2.5', on ? 'bg-gold/[0.05]' : 'hover:bg-panel-2')}>
      <input type="checkbox" checked={on} onChange={flip} className="mt-0.5 size-4 accent-[var(--color-gold)]" />
      <span className="flex flex-col">
        <span className="text-[13px] font-medium">{label}</span>
        <span className="text-[11px] text-faint">{detail}</span>
      </span>
    </label>
  );
  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex w-[420px] max-w-full flex-col gap-4 rounded-[18px] border border-line bg-panel p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-col gap-0.5">
          {SYNC_GROUPS.map((g) => row(c.groups.includes(g.id), t(g.label), t(g.detail), () => toggle(g.id)))}
          {row(c.crop, t('Crop & luruskan'), t('Rasio, sudut, putar dan balik'), () => setC((x) => ({ ...x, crop: !x.crop })))}
          {row(c.masks, t('Masking'), t('Mask dibuat untuk satu foto; di foto lain posisinya bisa tidak pas'), () => setC((x) => ({ ...x, masks: !x.masks })))}
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setC(all ? { groups: [], crop: false, masks: false } : { groups: SYNC_GROUPS.map((g) => g.id), crop: true, masks: true })}
            className="mr-auto text-xs font-medium text-gold-text hover:underline"
          >
            {all ? t('Lepas semua') : t('Pilih semua')}
          </button>
          <Button variant="plain" onClick={onClose}>
            {t('Batal')}
          </Button>
          <Button variant="primary" onClick={() => onConfirm(c)} disabled={!c.groups.length && !c.crop && !c.masks}>
            {action}
          </Button>
        </div>
      </div>
    </div>
  );
}
