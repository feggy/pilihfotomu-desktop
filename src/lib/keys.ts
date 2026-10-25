/**
 * Keyboard shortcuts the photographer can rebind (Pengaturan › Pintasan).
 * Arrows, Space, Enter, Esc and the digits stay fixed — they mean the same
 * everywhere and rebinding them would only confuse.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { t } from './i18n';

export type Action = 'pick' | 'maybe' | 'reject' | 'zoom' | 'compare' | 'info' | 'faces';

const ACTION_LABELS: [Action, string][] = [
  ['pick', 'Tandai Pilih'],
  ['maybe', 'Tandai Cek'],
  ['reject', 'Tandai Lewati'],
  ['compare', 'Bandingkan grup burst'],
  ['zoom', 'Zoom / pas layar (tampilan besar)'],
  ['info', 'Info foto (tampilan besar)'],
  ['faces', 'Kotak wajah (tampilan besar)'],
];

/** Labels are getters: read in the current language. */
export const ACTIONS: { id: Action; readonly label: string }[] = ACTION_LABELS.map(([id, label]) => ({
  id,
  get label() {
    return t(label);
  },
}));

export const DEFAULT_KEYS: Record<Action, string> = {
  pick: 'p',
  maybe: 'u',
  reject: 'x',
  zoom: 'z',
  compare: 'c',
  info: 'i',
  faces: 'f',
};

/** Keys an action can't take: fixed ones, and ones that type into fields. */
export const RESERVED = new Set([' ', 'enter', 'escape', 'tab', 'backspace', '=', '+', '-', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

interface KeyState {
  keys: Record<Action, string>;
  set: (action: Action, key: string) => void;
  reset: () => void;
}

export const useKeys = create<KeyState>()(
  persist(
    (set) => ({
      keys: DEFAULT_KEYS,
      // A key moves to its new action; whatever held it before gets that
      // action's old key, so nothing is ever left without one.
      set: (action, key) =>
        set(({ keys }) => {
          const next = { ...keys };
          const other = (Object.keys(keys) as Action[]).find((a) => a !== action && keys[a] === key);
          if (other) next[other] = keys[action];
          next[action] = key;
          return { keys: next };
        }),
      reset: () => set({ keys: DEFAULT_KEYS }),
    }),
    // Older saved sets miss newer actions: fill them from the defaults.
    { name: 'pilihfotomu-keys-v1', merge: (saved, cur) => ({ ...cur, keys: { ...DEFAULT_KEYS, ...((saved as KeyState)?.keys ?? {}) } }) },
  ),
);

/** Culling habits (Pengaturan › Pintasan keyboard). */
interface CullPrefs {
  /** After P / U / X on one photo, go on to the next one (Lightroom's Auto Advance). */
  autoAdvance: boolean;
  setAutoAdvance: (on: boolean) => void;
}

export const useCullPrefs = create<CullPrefs>()(
  persist((set) => ({ autoAdvance: true, setAutoAdvance: (autoAdvance) => set({ autoAdvance }) }), {
    name: 'pilihfotomu-cull-v1',
  }),
);

/** The action bound to a pressed key (already lower-cased), if any. */
export function actionFor(key: string): Action | null {
  const keys = useKeys.getState().keys;
  return (Object.keys(keys) as Action[]).find((a) => keys[a] === key) ?? null;
}

export const keyLabel = (k: string) => (k.length === 1 ? k.toUpperCase() : k);

/** Status action → its key, for hints next to buttons. */
export const useKey = (a: Action) => keyLabel(useKeys((s) => s.keys[a]));
