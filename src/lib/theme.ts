/**
 * Gelap or terang. Dark stays the default (photos are judged more honestly
 * on a dark ground, as in Lightroom); light is for a bright room or for
 * Kelola Bisnis all day. The colors themselves are in styles.css: this only
 * says which set is on, on <html data-theme>, and tells the window so its
 * own parts (native dialogs, the ground before the page loads) match.
 */

import { getCurrentWindow } from '@tauri-apps/api/window';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'dark' | 'light';
export type ThemePref = Theme | 'system';

interface ThemeState {
  pref: ThemePref;
  setPref: (pref: ThemePref) => void;
}

export const useTheme = create<ThemeState>()(
  persist((set) => ({ pref: 'dark', setPref: (pref) => set({ pref }) }), { name: 'pilihfotomu-theme-v1' }),
);

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function systemTheme(): Theme {
  return darkQuery().matches ? 'dark' : 'light';
}

export function theme(): Theme {
  const p = useTheme.getState().pref;
  return p === 'system' ? systemTheme() : p;
}

/** The window's ground under the page, the same as --color-bg. */
const GROUND: Record<Theme, [number, number, number]> = { dark: [11, 19, 16], light: [243, 241, 236] };

function apply() {
  const now = theme();
  document.documentElement.dataset.theme = now;
  if (!('__TAURI_INTERNALS__' in window)) return;
  try {
    const win = getCurrentWindow();
    const pref = useTheme.getState().pref;
    win.setTheme(pref === 'system' ? null : pref).catch(() => {});
    win.setBackgroundColor(GROUND[now]).catch(() => {});
  } catch {
    /* the page is themed either way */
  }
}

/** Set once at start, before the first render, then kept up with the setting and the system. */
export function watchTheme() {
  apply();
  useTheme.subscribe(apply);
  darkQuery().addEventListener('change', () => useTheme.getState().pref === 'system' && apply());
}
