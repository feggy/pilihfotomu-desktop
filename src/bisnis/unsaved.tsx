/**
 * Changes being made in a form that are not saved yet (Pengaturan, a
 * client, a template): kept apart until Simpan, and leaving with them —
 * another tab, another template, back — asks first instead of losing them
 * silently or keeping them unasked.
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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

/**
 * The bar for a form with changes, floating at the foot of the window
 * (wherever the form is scrolled to): Batal throws them away, Simpan — or
 * ⌘S — keeps them.
 */
export function SaveBar({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const save = useRef(onSave);
  save.current = onSave;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur?.();
        // After the blur, so a field that saves on leaving is in.
        requestAnimationFrame(() => save.current());
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-6">
      <div className="pointer-events-auto flex animate-[saveBarIn_160ms_ease-out] items-center gap-3 rounded-2xl border border-gold/60 bg-panel-2 py-2.5 pr-2.5 pl-4 shadow-[0_12px_40px_rgb(0_0_0/0.55)]">
        <span className="size-2 shrink-0 rounded-full bg-gold" />
        <span className="text-[13px] whitespace-nowrap text-fg">{t('Ada perubahan yang belum disimpan.')}</span>
        <button type="button" onClick={onCancel} className={btnPlain}>
          {t('Batal')}
        </button>
        <button type="button" onClick={onSave} title="⌘S" className={btnPrimary}>
          {t('Simpan perubahan')}
        </button>
      </div>
    </div>,
    document.body,
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
