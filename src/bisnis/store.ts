/**
 * Kelola Bisnis's data in memory: read once, every change written back a
 * moment later (at once when the app closes, `flushBisnis`).
 */

import { create } from 'zustand';

import { api } from '../lib/api';
import { emptyData, fromJson } from './model';
import type { BisnisData } from './types';

interface BisnisState {
  data: BisnisData | null;
  error: string | null;
  load: () => Promise<void>;
  /** Any change; written to disk shortly after. */
  update: (fn: (d: BisnisData) => BisnisData) => void;
}

let timer: number | null = null;
/** Called after each write, with the JSON written (the backup folder copy hangs off this). */
let afterSave: ((json: string, data: BisnisData) => void) | null = null;
export const onBisnisSaved = (fn: typeof afterSave) => void (afterSave = fn);

async function write() {
  timer = null;
  const data = useBisnis.getState().data;
  if (!data) return;
  const json = JSON.stringify(data);
  try {
    await api.saveBisnis(json);
    afterSave?.(json, data);
  } catch (e) {
    useBisnis.setState({ error: String(e) });
  }
}

/** Writes now what is waiting to be written. */
export function flushBisnis(): Promise<void> {
  if (timer == null) return Promise.resolve();
  clearTimeout(timer);
  return write();
}

export const useBisnis = create<BisnisState>((set, get) => ({
  data: null,
  error: null,
  load: async () => {
    if (get().data) return;
    try {
      const json = await api.loadBisnis();
      set({ data: json ? fromJson(json) : emptyData(), error: null });
    } catch (e) {
      // Unreadable: start empty in memory but never write over the file that couldn't be read.
      set({ error: String(e) });
    }
  },
  update: (fn) => {
    const d = get().data;
    if (!d) return;
    set({ data: fn(d) });
    if (timer != null) clearTimeout(timer);
    timer = window.setTimeout(write, 400);
  },
}));
