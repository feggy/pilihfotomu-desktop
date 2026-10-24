/**
 * Indonesian and English. The Indonesian text is the key: screens keep
 * reading as they did, wrapped in `t()`, and `src/locales/en/*.ts` hold the
 * English. A string missing there shows in Indonesian, never as a blank.
 *
 * - `{name}` placeholders are filled from `vars`.
 * - An English entry may be `[one, other]`: picked by `vars.n === 1`.
 * - `tj()` is `t()` for placeholders that are elements (`<b>…</b>`).
 *
 * The App component subscribes to the language, so changing it re-renders
 * every screen; module-level constants must call `t()` when read, not when
 * defined.
 */

import { invoke } from '@tauri-apps/api/core';
import { Fragment, createElement, type ReactNode } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { PATTERNS } from '../locales/en/errors';

export type Lang = 'id' | 'en';
export type LangPref = 'system' | Lang;

type Entry = string | [string, string];

const EN: Record<string, Entry> = Object.assign(
  {},
  ...Object.values(import.meta.glob<{ default: Record<string, Entry> }>('../locales/en/*.ts', { eager: true })).map(
    (m) => m.default,
  ),
);

/** Indonesian when the system's first language is Indonesian, else English. */
export function systemLang(): Lang {
  const first = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase();
  return first.startsWith('id') || first.startsWith('in') ? 'id' : 'en';
}

interface LangState {
  pref: LangPref;
  setPref: (p: LangPref) => void;
}

export const useLang = create<LangState>()(
  persist((set) => ({ pref: 'system', setPref: (pref) => set({ pref }) }), { name: 'pilihfotomu-lang-v1' }),
);

export const lang = (): Lang => {
  const p = useLang.getState().pref;
  return p === 'system' ? systemLang() : p;
};

/** For `Intl` formatters. */
export const locale = () => (lang() === 'en' ? 'en-US' : 'id-ID');

type Vars = Record<string, string | number>;

function pick(id: string, vars?: Record<string, unknown>): string {
  if (lang() !== 'en') return id;
  const e = EN[id];
  if (e == null) return id;
  if (typeof e === 'string') return e;
  return vars?.n === 1 ? e[0] : e[1];
}

export function t(id: string, vars?: Vars): string {
  const s = pick(id, vars);
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** `t()` whose placeholders may be elements. */
export function tj(id: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = pick(id, vars).split(/(\{\w+\})/);
  return createElement(
    Fragment,
    null,
    ...parts.map((p, i) => {
      const k = /^\{(\w+)\}$/.exec(p)?.[1];
      return k && k in vars ? createElement(Fragment, { key: i }, vars[k]) : p;
    }),
  );
}

/**
 * Messages from the Rust side (errors, client-pick warnings) arrive in
 * Indonesian. Exact ones are in the dictionary; ones with a name or a
 * number inside match a pattern in `locales/en/errors.ts`.
 */
export function tRust(message: string): string {
  if (lang() !== 'en') return message;
  const exact = EN[message];
  if (typeof exact === 'string') return exact;
  for (const [re, en] of PATTERNS) {
    if (re.test(message)) return message.replace(re, en);
  }
  return message;
}

/** Tells the Rust side (menu bar) which language is in use. */
export function syncNativeLang() {
  invoke('set_language', { lang: lang() }).catch(() => {});
}
