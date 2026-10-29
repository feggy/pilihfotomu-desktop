/**
 * Urungkan: a change that is easy to make by mistake (a booking, client or
 * package deleted, a booking moved to another stage) made at once, with a
 * few seconds to take it back — from the note at the foot of the window,
 * or ⌘Z. Only what that change touched goes back: anything else done in
 * the meantime stays.
 */

import { Undo2, X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

import { t } from '../lib/i18n';
import { useBisnis } from './store';
import type { BisnisData } from './types';

/** The lists of things with an id a change can add to, take from or alter. */
const LISTS = ['bookings', 'clients', 'packages', 'addons', 'expenses', 'templates'] as const;
type Item = { id: string };

const SHOWN_MS = 7000;

interface Pending {
  key: number;
  text: string;
  undo: () => void;
}

const useUndo = create<{ pending: Pending | null }>(() => ({ pending: null }));
let timer = 0;

/**
 * `change` made now, said as `text`, and offered back for a few seconds.
 * Going back restores, by id, only the items `change` added, removed or
 * altered — each as it was before.
 */
export function undoable(text: string, change: (d: BisnisData) => BisnisData) {
  const before = useBisnis.getState().data;
  if (!before) return;
  useBisnis.getState().update(change);
  const after = useBisnis.getState().data!;
  const undo = () => {
    useBisnis.getState().update((now) => {
      const next: BisnisData = { ...now };
      for (const list of LISTS) (next[list] as Item[]) = revert(now[list] as Item[], before[list] as Item[], after[list] as Item[]);
      return next;
    });
    hide();
  };
  window.clearTimeout(timer);
  useUndo.setState({ pending: { key: Date.now(), text, undo } });
  timer = window.setTimeout(hide, SHOWN_MS);
}

const hide = () => (window.clearTimeout(timer), useUndo.setState({ pending: null }));

/** `now` with what changed from `before` to `after` put back as it was, each in its old place. */
function revert<T extends Item>(now: T[], before: T[], after: T[]): T[] {
  if (before === after) return now;
  const was = new Map(before.map((x) => [x.id, x]));
  const became = new Map(after.map((x) => [x.id, x]));
  let out = now.filter((x) => !(became.has(x.id) && !was.has(x.id))); // added: taken out
  out = out.map((x) => (was.has(x.id) && became.get(x.id) !== was.get(x.id) ? was.get(x.id)! : x)); // altered: as before
  before.forEach((x, i) => {
    if (became.has(x.id) || out.some((y) => y.id === x.id)) return; // removed: back where it was
    out.splice(Math.min(i, out.length), 0, x);
  });
  return out;
}

/** The note with Urungkan, at the foot of the window; ⌘Z does the same while it shows. */
export function UndoToast() {
  const pending = useUndo((s) => s.pending);
  useEffect(() => {
    if (!pending) return;
    const key = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.closest('input, textarea, [contenteditable]');
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) (e.preventDefault(), pending.undo());
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [pending]);
  // Gone with the screen: an undo for Kelola Bisnis isn't offered elsewhere.
  useEffect(() => hide, []);
  if (!pending) return null;
  return createPortal(
    <div key={pending.key} className="pointer-events-auto fixed bottom-6 left-6 z-50 flex animate-[saveBarIn_160ms_ease-out] items-center gap-3 rounded-2xl border border-line bg-panel-2 py-2 pr-2 pl-4 shadow-[0_12px_40px_rgb(0_0_0/0.55)]">
      <span className="text-[13px] text-fg">{pending.text}</span>
      <button type="button" onClick={pending.undo} title="⌘Z" className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-gold-text hover:bg-raised">
        <Undo2 size={14} /> {t('Urungkan')}
      </button>
      <button type="button" onClick={hide} aria-label={t('Tutup')} className="rounded-md p-1 text-faint hover:text-fg">
        <X size={14} />
      </button>
    </div>,
    document.body,
  );
}
