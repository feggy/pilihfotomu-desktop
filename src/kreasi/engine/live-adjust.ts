import * as React from 'react';
import type { CollageDoc, PhotoAdjust } from './document';

/**
 * While a slider in Edit or Masking is held: the picture's settings as they
 * move, for the canvas and the panel only. The design takes them once, when
 * the slider is let go — so the whole editor (its history, the draft being
 * saved, every panel) is not worked through again for each step of a drag.
 *
 * `key` names the picture as the editor does: `{"kind":"cell","index":0}` or
 * `{"kind":"sticker","id":"…"}`.
 */
export type LiveAdjust = { key: string; adjust: PhotoAdjust } | null;

let live: LiveAdjust = null;
const listeners = new Set<() => void>();
const setLive = (next: LiveAdjust) => {
  live = next;
  listeners.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};
const getLive = () => live;

/** The settings being dragged right now, if any. */
export function useLiveAdjust(): LiveAdjust {
  return React.useSyncExternalStore(subscribe, getLive, () => null);
}

/** The design as it shows while a slider is held: that picture with the settings moving. */
export function withLiveAdjust(doc: CollageDoc, l: LiveAdjust): CollageDoc {
  if (!l) return doc;
  let target: { kind: 'cell'; index: number } | { kind: 'sticker'; id: string };
  try {
    target = JSON.parse(l.key);
  } catch {
    return doc;
  }
  if (target.kind === 'cell') {
    const slot = doc.slots[target.index];
    if (!slot) return doc;
    const slots = doc.slots.slice();
    slots[target.index] = { ...slot, adjust: l.adjust };
    return { ...doc, slots };
  }
  return {
    ...doc,
    stickers: doc.stickers.map((st) => (st.id === target.id ? { ...st, adjust: l.adjust } : st)),
  };
}

/**
 * A panel's settings, live while one of its sliders is held: `adjust` to show,
 * `change` to call instead of `onChange`, and `onPointerDownCapture` for the
 * panel's root (it notes that a slider was taken hold of). Without `key` it
 * is `onChange` as it was.
 */
export function useLiveEdit(
  committed: PhotoAdjust,
  onChange: (adjust: PhotoAdjust) => void,
  key: string | undefined,
) {
  const current = useLiveAdjust();
  const adjust = key && current?.key === key ? current.adjust : committed;
  const dragging = React.useRef(false);
  const onChangeRef = React.useRef(onChange);
  React.useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  React.useEffect(() => {
    // Let go (anywhere), or the panel closed mid-drag: the design takes it.
    const commit = () => {
      if (!dragging.current) return;
      dragging.current = false;
      const l = getLive();
      if (!l || l.key !== key) return;
      onChangeRef.current(l.adjust);
      // Cleared once the design shows it, so the slider never flicks back.
      requestAnimationFrame(() => {
        if (getLive() === l) setLive(null);
      });
    };
    window.addEventListener('pointerup', commit, true);
    window.addEventListener('pointercancel', commit, true);
    return () => {
      window.removeEventListener('pointerup', commit, true);
      window.removeEventListener('pointercancel', commit, true);
      commit();
    };
  }, [key]);
  const change = (next: PhotoAdjust) => {
    if (dragging.current && key) setLive({ key, adjust: next });
    else onChange(next);
  };
  const onPointerDownCapture = (e: React.PointerEvent) => {
    if (key && (e.target as HTMLElement).matches?.('input[type=range]')) dragging.current = true;
  };
  return { adjust, change, onPointerDownCapture };
}
