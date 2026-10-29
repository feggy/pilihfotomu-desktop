/**
 * Changes being made in a form that are not saved yet (Pengaturan, a
 * client, a template): kept apart until Simpan, and leaving with them —
 * another tab, another template, back — asks first instead of losing them
 * silently or keeping them unasked.
 */

import { useEffect } from 'react';
import { create } from 'zustand';

import { t } from '../lib/i18n';
import { Dialog, btnPlain, btnPrimary } from './ui';

interface Unsaved {
  /** Something has changes not saved. */
  dirty: boolean;
  /** What leaving would do, waiting on the question. */
  pending: (() => void) | null;
  setDirty: (dirty: boolean) => void;
  /** `go` now when nothing is unsaved; otherwise asks, and goes only if the changes are thrown away. */
  guard: (go: () => void) => void;
}

export const useUnsaved = create<Unsaved>((set, get) => ({
  dirty: false,
  pending: null,
  setDirty: (dirty) => set({ dirty }),
  guard: (go) => (get().dirty ? set({ pending: go }) : go()),
}));

/** Marks the form as having unsaved changes while `dirty`; clears it when the form goes. */
export function useDirty(dirty: boolean) {
  useEffect(() => {
    useUnsaved.getState().setDirty(dirty);
  }, [dirty]);
  useEffect(() => () => useUnsaved.getState().setDirty(false), []);
}

/** The bar at the foot of a form with changes: Batal throws them away, Simpan keeps them. */
export function SaveBar({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 mt-2 flex items-center gap-3 rounded-xl border border-gold/50 bg-panel-2 px-4 py-2.5 shadow-2xl">
      <span className="size-2 shrink-0 rounded-full bg-gold" />
      <span className="min-w-0 flex-1 text-xs text-muted">{t('Ada perubahan yang belum disimpan.')}</span>
      <button type="button" onClick={onCancel} className={btnPlain}>
        {t('Batal')}
      </button>
      <button type="button" onClick={onSave} className={btnPrimary}>
        {t('Simpan perubahan')}
      </button>
    </div>
  );
}

/** The question when leaving with changes. */
export function LeaveUnsaved() {
  const { pending } = useUnsaved();
  if (!pending) return null;
  const stay = () => useUnsaved.setState({ pending: null });
  return (
    <Dialog
      title={t('Perubahan belum disimpan')}
      onClose={stay}
      width={420}
      footer={
        <>
          <button type="button" onClick={stay} className={btnPlain}>
            {t('Tetap di sini')}
          </button>
          <button
            type="button"
            onClick={() => {
              useUnsaved.setState({ pending: null, dirty: false });
              pending();
            }}
            className={btnPrimary}
          >
            {t('Buang perubahan')}
          </button>
        </>
      }
    >
      <p className="text-[13px] text-muted">{t('Perubahan yang kamu buat belum disimpan. Kalau pergi sekarang, perubahannya hilang.')}</p>
    </Dialog>
  );
}
