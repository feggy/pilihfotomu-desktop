/**
 * A carousel's slides added and taken away. Positions are fractions of the
 * whole canvas, so every x moves when the slide count changes; sizes are per
 * slide and stay. A ready-made carousel layout is drawn from a pattern that
 * spreads itself over however many slides there are, so before its slide
 * count changes it becomes the free layout, its photo places frozen where
 * they are — the slides already made look exactly the same after.
 */

import type { Edit } from './actions';
import {
  FREE_LAYOUT_ID,
  behindKeys,
  formatRatio,
  isFreeLayout,
  layerKeys,
  newId,
  photoLayerKey,
  slotsFor,
  stickerLayerKey,
  templateOf,
  textLayerKey,
  type CollageDoc,
  type FreeCell,
  type Slot,
} from './engine/document';
import { cellRects, frameOf } from './engine/render';

/** Instagram's carousel: 2 to 10 slides. */
export const MIN_SLIDES = 2;
export const MAX_SLIDES = 10;

/** The slide (0-based) a point `x` of the whole canvas falls on. */
const slideAt = (d: CollageDoc, x: number) => Math.min(d.slides - 1, Math.max(0, Math.floor(x * d.slides)));

/** A ready-made layout as free frames where its places are now; the free layout unchanged. */
export function toFreeLayout(d: CollageDoc): CollageDoc {
  if (isFreeLayout(d)) return d;
  const template = templateOf(d);
  const f = frameOf(d, 1000 * d.slides);
  const cells = cellRects(template, f, d.style).map((r, i) => ({
    id: newId(),
    x: r.x / f.width,
    y: r.y / f.height,
    w: r.w / f.width,
    h: r.h / f.height,
    rotate: template.cells[i]?.[4] ?? 0,
  }));
  // Photos stay under the texts and elements; background pictures stay under the photos.
  const behind = behindKeys(d);
  const keys = layerKeys(d);
  return {
    ...d,
    templateId: FREE_LAYOUT_ID,
    freeCells: cells,
    freeFrame: template.frame ?? 'none',
    slots: slotsFor(d, cells.length),
    layerOrder: [...keys.filter((k) => behind.has(k)), ...cells.map((c) => photoLayerKey(c.id)), ...keys.filter((k) => !behind.has(k))],
  };
}

/** Everything's x (and a frame's width) for `n` slides instead of `d.slides`, slide `from` onwards moved by `by`. */
function respread(d: CollageDoc, n: number, from: number, by: number): CollageDoc {
  const move = (x: number) => {
    const s = x * d.slides;
    return (s >= from ? s + by : s) / n;
  };
  return {
    ...d,
    slides: n,
    texts: d.texts.map((t) => ({ ...t, x: move(t.x) })),
    stickers: d.stickers.map((s) => ({ ...s, x: move(s.x) })),
    freeCells: d.freeCells.map((c) => {
      const mid = move(c.x + c.w / 2);
      const w = (c.w * d.slides) / n;
      return { ...c, x: mid - w / 2, w };
    }),
  };
}

/**
 * A new slide after slide `after` (0-based; -1 before the first); the slides
 * after it move along. `photo`: one photo place filling it inside the
 * design's margin (a template's carousel); otherwise just its background (a
 * design from a blank canvas).
 */
export const addSlide =
  (after: number, photo: boolean): Edit =>
  (d0) => {
    const d = toFreeLayout(d0);
    if (d.slides >= MAX_SLIDES) return d0;
    const n = d.slides + 1;
    const at = after + 1;
    const next = respread(d, n, at, 1);
    const backgrounds =
      d.backgroundScope === 'per-slide' && d.slideBackgrounds.length
        ? [...d.slideBackgrounds.slice(0, at), d.slideBackgrounds[after] ?? d.slideBackgrounds[0]!, ...d.slideBackgrounds.slice(at)]
        : d.slideBackgrounds;
    if (!photo) return { ...next, slideBackgrounds: backgrounds };
    const pad = Math.min(0.2, d.style.padding);
    const cell = {
      id: newId(),
      x: (at + pad) / n,
      w: (1 - 2 * pad) / n,
      y: pad / formatRatio(d),
      h: 1 - (2 * pad) / formatRatio(d),
      rotate: 0,
    };
    const keys = layerKeys(next);
    const lastPhoto = keys.reduce((a, k, i) => (k.startsWith('photo:') || behindKeys(next).has(k) ? i : a), -1);
    return {
      ...next,
      freeCells: [...next.freeCells, cell],
      slots: [...slotsFor(next, next.freeCells.length), null],
      slideBackgrounds: backgrounds,
      layerOrder: [...keys.slice(0, lastPhoto + 1), photoLayerKey(cell.id), ...keys.slice(lastPhoto + 1)],
    };
  };

/**
 * A copy of slide `k` (0-based) right after it: its photo places with their
 * photos, texts and elements (by their middle), each a new layer just above
 * the one it copies.
 */
export const duplicateSlide =
  (k: number): Edit =>
  (d0) => {
    const d = toFreeLayout(d0);
    if (d.slides >= MAX_SLIDES) return d0;
    const n = d.slides + 1;
    const next = respread(d, n, k + 1, 1);
    const on = (x: number) => slideAt(d, x) === k;
    // One slide along, in the new count's fractions.
    const along = (x: number) => x + 1 / n;
    const copies = new Map<string, string>();
    const cells: FreeCell[] = [];
    const slots: (Slot | null)[] = [];
    next.freeCells.forEach((c, i) => {
      if (!on(d.freeCells[i]!.x + d.freeCells[i]!.w / 2)) return;
      const copy = { ...c, id: newId(), x: along(c.x) };
      copies.set(photoLayerKey(c.id), photoLayerKey(copy.id));
      cells.push(copy);
      const slot = d.slots[i];
      slots.push(slot ? { ...slot } : null);
    });
    const texts = next.texts.flatMap((t, i) => {
      if (!on(d.texts[i]!.x)) return [];
      const copy = { ...t, id: newId(), x: along(t.x) };
      copies.set(textLayerKey(t.id), textLayerKey(copy.id));
      return [copy];
    });
    const stickers = next.stickers.flatMap((st, i) => {
      if (!on(d.stickers[i]!.x)) return [];
      const copy = { ...st, id: newId(), x: along(st.x) };
      copies.set(stickerLayerKey(st.id), stickerLayerKey(copy.id));
      return [copy];
    });
    // Hidden and locked come along; a saved group stays the original's.
    const layerMeta = { ...next.layerMeta };
    for (const [from, to] of copies) {
      const meta = next.layerMeta[from];
      if (meta) layerMeta[to] = { hidden: meta.hidden, locked: meta.locked };
    }
    const backgrounds =
      d.backgroundScope === 'per-slide' && d.slideBackgrounds.length
        ? [...d.slideBackgrounds.slice(0, k + 1), d.slideBackgrounds[k] ?? d.slideBackgrounds[0]!, ...d.slideBackgrounds.slice(k + 1)]
        : d.slideBackgrounds;
    return {
      ...next,
      freeCells: [...next.freeCells, ...cells],
      slots: [...slotsFor(next, next.freeCells.length), ...slots],
      texts: [...next.texts, ...texts],
      stickers: [...next.stickers, ...stickers],
      slideBackgrounds: backgrounds,
      layerMeta,
      layerOrder: layerKeys(next).flatMap((key) => (copies.has(key) ? [key, copies.get(key)!] : [key])),
    };
  };

/** Slide `k` (0-based) taken away with everything on it (by its middle); the slides after it move back. */
export const removeSlide =
  (k: number): Edit =>
  (d0) => {
    if (d0.slides <= MIN_SLIDES) return d0;
    const d = toFreeLayout(d0);
    const on = (x: number) => slideAt(d, x) === k;
    const keep = d.freeCells.map((c) => !on(c.x + c.w / 2));
    const trimmed: CollageDoc = {
      ...d,
      texts: d.texts.filter((t) => !on(t.x)),
      stickers: d.stickers.filter((s) => !on(s.x)),
      // A photo reaching over from the next slide (a carousel's bridge) loses the part that was on this one.
      freeCells: d.freeCells
        .filter((_, i) => keep[i])
        .map((c) => {
          let s0 = c.x * d.slides, s1 = (c.x + c.w) * d.slides;
          if (s1 <= k || s0 >= k + 1) return c;
          if ((s0 + s1) / 2 > k + 1) s0 = k + 1;
          else s1 = k;
          return { ...c, x: s0 / d.slides, w: (s1 - s0) / d.slides };
        }),
      slots: slotsFor(d, d.freeCells.length).filter((_, i) => keep[i]),
      slideBackgrounds: d.slideBackgrounds.filter((_, i) => i !== k),
    };
    return respread(trimmed, d.slides - 1, k + 1, -1);
  };

/** How many photo places, texts and elements sit on slide `k`: a slide with nothing on it goes without asking. */
export function itemsOnSlide(d: CollageDoc, k: number): number {
  if (!isFreeLayout(d)) {
    const f = frameOf(d, 1000 * d.slides);
    const cells = cellRects(templateOf(d), f, d.style).filter((r) => slideAt(d, (r.x + r.w / 2) / f.width) === k).length;
    return cells + d.texts.filter((t) => slideAt(d, t.x) === k).length + d.stickers.filter((s) => slideAt(d, s.x) === k).length;
  }
  return (
    d.freeCells.filter((c) => slideAt(d, c.x + c.w / 2) === k).length +
    d.texts.filter((t) => slideAt(d, t.x) === k).length +
    d.stickers.filter((s) => slideAt(d, s.x) === k).length
  );
}
