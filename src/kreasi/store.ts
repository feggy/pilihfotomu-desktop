/**
 * Buat konten, one design at a time: the template picked, the photos it can
 * take from, and the design as it is being edited (with undo).
 */

import { create } from 'zustand';

import { emptyPhotoFile, slotsFor, templateOf, withSlot, type CollageDoc, type Slot } from './engine/document';
import { photoFile, slotShapes, shapeOf, templateDoc, type Shape, type Template } from './kit';

/** A photo the design can use: from the open session, or a folder scanned for this. */
export interface SourcePhoto {
  id: number;
  name: string;
  thumb: string | null;
  /** Session photos only. */
  status?: 'pick' | 'maybe' | 'reject';
  rating?: number;
  group?: number | null;
  /** Width ÷ height, once its thumbnail has been seen. */
  ratio?: number;
  /** Faces found in the analysis, as fractions of the upright photo. */
  faces?: { x: number; y: number; w: number; h: number }[];
}

export interface Source {
  root: string;
  name: string;
  photos: SourcePhoto[];
}

type Step = 'galeri' | 'isi' | 'edit';

interface KreasiState {
  step: Step;
  template: Template | null;
  doc: CollageDoc | null;
  source: Source | null;
  /** The photo place being filled / edited. */
  active: number;
  past: CollageDoc[];
  future: CollageDoc[];
  /** The design when a drag began; one undo step for the whole drag. */
  gesture: CollageDoc | null;

  setStep: (step: Step) => void;
  choose: (t: Template) => void;
  setSource: (s: Source | null) => void;
  setRatios: (r: Map<number, number>) => void;
  setActive: (i: number) => void;
  /** Puts `photo` in place `i` (null empties it); moves on to the next empty place. */
  place: (i: number, photo: SourcePhoto | null) => void;
  /** Fills the empty places with the best photos that fit their shape. */
  autoFill: () => void;
  /** Any change to the design, undoable. */
  edit: (fn: (d: CollageDoc) => CollageDoc) => void;
  /** A change during a drag: shown at once, undone as one step after `commit`. */
  live: (fn: (d: CollageDoc) => CollageDoc) => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}

const HISTORY = 100;

/**
 * Pan (-1…1 each way) that puts the photo's faces in the middle of a place
 * of `slotRatio` (width ÷ height) — a little above middle vertically, where a
 * face sits in a portrait. 0 when there are no faces or the shape is unknown.
 */
export function facePan(p: SourcePhoto, slotRatio: number): { ox: number; oy: number } {
  if (!p.faces?.length || !p.ratio) return { ox: 0, oy: 0 };
  const x0 = Math.min(...p.faces.map((f) => f.x)), x1 = Math.max(...p.faces.map((f) => f.x + f.w));
  const y0 = Math.min(...p.faces.map((f) => f.y)), y1 = Math.max(...p.faces.map((f) => f.y + f.h));
  // Photo drawn covering a place of slotRatio × 1 (see engine `placeImage`).
  const scale = Math.max(slotRatio / p.ratio, 1);
  const dw = p.ratio * scale, dh = scale;
  const overX = dw - slotRatio, overY = dh - 1;
  const pan = (center: number, size: number, over: number, at: number) =>
    over > 0.001 ? Math.max(-1, Math.min(1, (2 * (center * size - at)) / over - 1)) : 0;
  return { ox: pan((x0 + x1) / 2, dw, overX, slotRatio / 2), oy: pan((y0 + y1) / 2, dh, overY, 0.42) };
}

const slotFor = (root: string, p: SourcePhoto, old: Slot | null, slotRatio = 1): Slot => ({
  ...(old ?? { zoom: 1, ox: 0, oy: 0, rotate: 0, flip: false }),
  file: photoFile({ root, id: p.id, name: p.name, thumb: p.thumb }),
  // A new photo starts unzoomed with its faces in view; the place keeps its look.
  zoom: 1,
  ...facePan(p, slotRatio),
});

/** Photo places of the design and which photo (id) sits in each. */
export function placed(doc: CollageDoc): (number | null)[] {
  const n = templateOf(doc).cells.length;
  return slotsFor(doc, n).map((s) => (s && s.file.fileId.startsWith('foto-') ? Number(s.file.fileId.slice(5)) : null));
}

/** Best first: picked, then stars, then not from a burst already used. */
export function ranked(photos: SourcePhoto[]): SourcePhoto[] {
  const score = (p: SourcePhoto) => (p.status === 'pick' ? 100 : p.status === 'maybe' ? 40 : p.status === 'reject' ? -100 : 0) + (p.rating ?? 0) * 10;
  return [...photos].sort((a, b) => score(b) - score(a) || a.id - b.id);
}

export const fits = (p: SourcePhoto, shape: Shape) => p.ratio == null || shapeOf(p.ratio) === shape || shape === 'square';

export const useKreasi = create<KreasiState>((set, get) => ({
  step: 'galeri',
  template: null,
  doc: null,
  source: null,
  active: 0,
  past: [],
  future: [],
  gesture: null,

  setStep: (step) => set({ step }),
  choose: (template) => set({ template, doc: structuredClone(templateDoc(template)), active: 0, past: [], future: [], step: 'isi' }),
  setSource: (source) => set({ source }),
  setRatios: (r) =>
    set(({ source }) =>
      source ? { source: { ...source, photos: source.photos.map((p) => (r.has(p.id) ? { ...p, ratio: r.get(p.id) } : p)) } } : {},
    ),
  setActive: (active) => set({ active }),

  place: (i, photo) => {
    const { doc, source } = get();
    if (!doc || !source) return;
    get().edit((d) => ({
      ...d,
      slots: withSlot(
        d.slots,
        i,
        photo
          ? slotFor(source.root, photo, d.slots[i] ?? null, slotShapes(d)[i]?.ratio)
          : d.slots[i]
            ? { ...d.slots[i]!, file: emptyPhotoFile(i + 1) }
            : null,
      ),
    }));
    // Next empty place, in order.
    const now = placed(get().doc!);
    const next = now.findIndex((id, j) => id == null && j > i);
    const first = now.findIndex((id) => id == null);
    set({ active: next >= 0 ? next : first >= 0 ? first : i });
  },

  autoFill: () => {
    const { doc, source } = get();
    if (!doc || !source) return;
    const shapes = slotShapes(doc);
    const now = placed(doc);
    const used = new Set(now.filter((x): x is number => x != null));
    const groups = new Set(source.photos.filter((p) => used.has(p.id) && p.group != null).map((p) => p.group));
    const pool = ranked(source.photos.filter((p) => p.status !== 'reject'));
    get().edit((d) => {
      let slots = d.slots;
      now.forEach((id, i) => {
        if (id != null) return;
        const want = shapes[i]?.shape ?? 'square';
        // Known to fit first (a new burst before a used one), then shape not yet known, then anything.
        const known = (p: SourcePhoto) => p.ratio != null && fits(p, want);
        const free = (p: SourcePhoto) => !used.has(p.id);
        const pick =
          pool.find((p) => free(p) && known(p) && (p.group == null || !groups.has(p.group))) ??
          pool.find((p) => free(p) && known(p)) ??
          pool.find((p) => free(p) && p.ratio == null) ??
          pool.find(free);
        if (!pick) return;
        used.add(pick.id);
        if (pick.group != null) groups.add(pick.group);
        slots = withSlot(slots, i, slotFor(source.root, pick, slots[i] ?? null, shapes[i]?.ratio));
      });
      return { ...d, slots };
    });
  },

  edit: (fn) =>
    set(({ doc, past }) => {
      if (!doc) return {};
      const next = fn(doc);
      if (next === doc) return {};
      return { doc: next, past: [...past, doc].slice(-HISTORY), future: [] };
    }),
  live: (fn) => set(({ doc, gesture }) => (doc ? { doc: fn(doc), gesture: gesture ?? doc } : {})),
  commit: () =>
    set(({ gesture, past }) => (gesture ? { gesture: null, past: [...past, gesture].slice(-HISTORY), future: [] } : {})),
  undo: () =>
    set(({ doc, past, future }) => {
      const prev = past[past.length - 1];
      return prev && doc ? { doc: prev, past: past.slice(0, -1), future: [doc, ...future] } : {};
    }),
  redo: () =>
    set(({ doc, past, future }) => {
      const next = future[0];
      return next && doc ? { doc: next, past: [...past, doc], future: future.slice(1) } : {};
    }),
  reset: () => set({ step: 'galeri', template: null, doc: null, active: 0, past: [], future: [] }),
}));
