/**
 * Riwayat: what each undo step did, for the history panel. A state of the
 * design gets its step (a label and when) the moment it is made; labels are
 * Indonesian keys, translated where shown.
 */

import type { CollageDoc } from './engine/document';

export interface HistoryStep {
  label: string;
  at: number;
}

/** The step that made each state of the design. */
const steps = new WeakMap<CollageDoc, HistoryStep>();

export const stepOf = (doc: CollageDoc): HistoryStep | undefined => steps.get(doc);
export const setStep = (doc: CollageDoc, step: HistoryStep) => void steps.set(doc, step);

/** `after` was made from `before` just now: labels it, unless it already has a label. */
export function record(before: CollageDoc, after: CollageDoc) {
  if (!steps.has(after)) steps.set(after, { label: describe(before, after), at: Date.now() });
}

type Placed = { id: string; x: number; y: number; size?: number; w?: number; h?: number; rotate?: number };

/** What happened to one kind of layer, or null when nothing did. */
function layersChange<T extends Placed>(a: T[], b: T[], noun: string, own?: (x: T, y: T) => string | null): string | null {
  if (a === b) return null;
  if (b.length > a.length) return `Tambah ${noun}`;
  if (b.length < a.length) return `Hapus ${noun}`;
  const before = new Map(a.map((x) => [x.id, x]));
  for (const y of b) {
    const x = before.get(y.id);
    if (!x) return `Ganti ${noun}`;
    if (x === y) continue;
    if (x.x !== y.x || x.y !== y.y) return `Pindah ${noun}`;
    if (x.size !== y.size || x.w !== y.w || x.h !== y.h) return `Ubah ukuran ${noun}`;
    if (x.rotate !== y.rotate) return `Putar ${noun}`;
    return own?.(x, y) ?? `Ubah ${noun}`;
  }
  return null;
}

export function describe(a: CollageDoc, b: CollageDoc): string {
  // Everything moves when a slide comes or goes: that is the step, not the moves.
  // (Duplikat slide labels itself where it is done.)
  if (a.format === 'carousel' && a.slides !== b.slides) return b.slides > a.slides ? 'Tambah slide' : 'Hapus slide';
  const texts = layersChange(a.texts, b.texts, 'teks', (x, y) => (x.text !== y.text ? 'Ubah teks' : 'Ubah gaya teks'));
  if (texts) return texts;
  const stickers = layersChange(a.stickers, b.stickers, 'elemen', (x, y) => (x.sticker !== y.sticker ? 'Ganti gambar elemen' : null));
  if (stickers) return stickers;
  const frames = layersChange(a.freeCells, b.freeCells, 'bingkai foto');
  if (frames) return frames;
  if (a.slots !== b.slots) {
    const i = b.slots.findIndex((s, j) => s !== a.slots[j]);
    const x = a.slots[i], y = b.slots[i];
    if (!x || !y || x.file.fileId !== y.file.fileId) return 'Ganti foto';
    if (x.zoom !== y.zoom || x.ox !== y.ox || x.oy !== y.oy) return 'Atur posisi foto';
    return 'Ubah foto';
  }
  if (a.layerOrder !== b.layerOrder) return 'Ubah urutan lapisan';
  if (a.layerMeta !== b.layerMeta) return 'Ubah lapisan';
  if (a.style !== b.style || a.backdrop !== b.backdrop || a.slideBackgrounds !== b.slideBackgrounds || a.backgroundScope !== b.backgroundScope) return 'Ubah latar';
  if (a.watermark !== b.watermark) return 'Ubah watermark';
  if (a.format !== b.format || a.slides !== b.slides || a.photoRatio !== b.photoRatio) return 'Ubah ukuran kanvas';
  if (a.templateId !== b.templateId) return 'Ganti tata letak';
  return 'Ubah desain';
}

/** As saved in a draft: every state, which one is showing, and their steps. */
export interface SavedHistory {
  states: CollageDoc[];
  current: number;
  steps: (HistoryStep | null)[];
}

/** Most steps kept in a draft (the editor keeps more while open). */
const SAVED = 50;

export function saveHistory(past: CollageDoc[], doc: CollageDoc, future: CollageDoc[]): SavedHistory {
  const before = past.slice(-SAVED);
  const states = [...before, doc, ...future.slice(0, SAVED)];
  return { states, current: before.length, steps: states.map((s) => stepOf(s) ?? null) };
}

/** A saved history back as undo and redo, its steps labelled again; null if it doesn't fit. */
export function loadHistory(h: SavedHistory | undefined): { past: CollageDoc[]; doc: CollageDoc; future: CollageDoc[] } | null {
  const doc = h?.states[h.current];
  if (!h || !doc) return null;
  h.states.forEach((s, i) => h.steps[i] && setStep(s, h.steps[i]!));
  return { past: h.states.slice(0, h.current), doc, future: h.states.slice(h.current + 1) };
}
