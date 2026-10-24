/**
 * What the editor does to a design: add texts, presets, elements and shapes;
 * delete, duplicate, nudge; layers. Pure functions of the design, so they
 * go through the store's `edit` and are undoable as one step.
 */

import {
  DEFAULT_SHADOW,
  PHOTOS_LAYER,
  behindKeys,
  formatRatio,
  isFreeLayout,
  layerKeys,
  moveLayer,
  newId,
  patchLayerMeta,
  photoLayerKey,
  readableOn,
  slotsFor,
  stickerLayerKey,
  textLayerKey,
  type CollageDoc,
  type FreeCell,
  type LayerMove,
  type StickerLayer,
  type TextLayer,
} from './engine/document';
import type { Selection } from './engine/render';
import { GRADIENT_SHAPE, type GradientPreset } from './engine/gradients';
import type { ShapeDef } from './engine/shapes';
import type { StickerDef } from './engine/stickers';
import { ACCENT_COLOR, STUDIO_TOKEN, type TextPreset } from './engine/text-presets';

export type Edit = (d: CollageDoc) => CollageDoc;

/** Where something new lands: the middle of the first slide (what shows before swiping). */
const firstSlideMiddle = (d: CollageDoc) => 0.5 / d.slides;

export function addText(label: string, size: number, weight: number): { edit: Edit; id: string } {
  const id = newId();
  return {
    id,
    edit: (d) => ({
      ...d,
      texts: [
        ...d.texts,
        {
          id,
          text: label,
          font: 'sans',
          size,
          weight,
          italic: false,
          color: readableOn(d.style.background),
          align: 'center',
          width: null,
          x: firstSlideMiddle(d),
          // Stacked from the middle down, so new texts don't land on each other.
          y: Math.min(0.9, 0.5 + (d.texts.length % 5) * 0.08),
          textCase: 'asli',
          spacing: 0,
          shadow: DEFAULT_SHADOW,
        },
      ],
    }),
  };
}

export function addPreset(preset: TextPreset, studio = ''): { edit: Edit; id: string } {
  const ids = preset.lines.map(() => newId());
  return {
    id: ids[0]!,
    edit: (d) => ({
      ...d,
      texts: [
        ...d.texts,
        ...preset.lines.map(
          (l, i): TextLayer => ({
            id: ids[i]!,
            text: l.text === STUDIO_TOKEN ? studio || 'Nama Studio' : l.text,
            font: l.font,
            size: l.size,
            weight: l.weight ?? 400,
            italic: l.italic ?? false,
            color: l.tone === 'aksen' ? ACCENT_COLOR : readableOn(d.style.background),
            align: 'center',
            width: l.width ?? null,
            x: firstSlideMiddle(d),
            y: 0.5 + l.dy,
            textCase: l.textCase ?? 'asli',
            spacing: l.spacing ?? 0,
            shadow: DEFAULT_SHADOW,
          }),
        ),
      ],
    }),
  };
}

export function addSticker(def: StickerDef): { edit: Edit; id: string } {
  const id = newId();
  return {
    id,
    edit: (d) => ({
      ...d,
      stickers: [...d.stickers, { id, sticker: def.id, x: firstSlideMiddle(d), y: 0.5, size: (def.ratio < 1 ? 0.4 : 0.2) / d.slides, rotate: 0, color: def.color ?? ACCENT_COLOR }],
    }),
  };
}

/**
 * A gradient band (dark at the bottom behind a caption, say), as the web adds
 * it: a plain box over the whole slide width, put just above the photos so
 * texts stay on top of it.
 */
export function addGradient(preset: GradientPreset): { edit: Edit; id: string } {
  const id = newId();
  return {
    id,
    edit: (d) => {
      const h = preset.height;
      const keys = layerKeys(d);
      const photoAt = keys.reduce((at, k, i) => (k.startsWith('photo:') || behindKeys(d).has(k) || k === PHOTOS_LAYER ? i : at), -1);
      const key = stickerLayerKey(id);
      return {
        ...d,
        stickers: [
          ...d.stickers,
          {
            id,
            sticker: GRADIENT_SHAPE,
            x: 0.5 / d.slides,
            y: preset.place === 'bawah' ? 1 - h / 2 : preset.place === 'atas' ? h / 2 : 0.5,
            size: 1,
            ratio: h * formatRatio(d),
            rotate: 0,
            corner: 0,
            color: preset.gradient.to.color,
            gradient: preset.gradient,
          },
        ],
        layerOrder: [...keys.slice(0, photoAt + 1), key, ...keys.slice(photoAt + 1)],
      };
    },
  };
}

export function addShape(def: ShapeDef): { edit: Edit; id: string } {
  const id = newId();
  return {
    id,
    edit: (d) => ({
      ...d,
      stickers: [
        ...d.stickers,
        {
          id,
          sticker: def.id,
          x: firstSlideMiddle(d),
          y: 0.5,
          size: def.size / d.slides,
          rotate: 0,
          color: def.color,
          opacity: def.opacity,
          ...(def.kind === 'line' ? {} : { ratio: def.ratio }),
          ...(def.corner !== undefined ? { corner: def.corner } : {}),
        },
      ],
    }),
  };
}

/** The layer key of a selection, for hide/lock/order (a photo only in the free layout). */
export function keyOf(sel: Selection, doc?: CollageDoc): string | null {
  if (!sel) return null;
  if (sel.kind === 'text') return textLayerKey(sel.id);
  if (sel.kind === 'sticker') return stickerLayerKey(sel.id);
  if (sel.kind === 'cell' && doc && isFreeLayout(doc)) {
    const c = doc.freeCells[sel.index];
    return c ? photoLayerKey(c.id) : null;
  }
  return null;
}

/** Free layout: takes away photo frame `index` and its photo. */
export const removeFrame =
  (index: number): Edit =>
  (d) => ({
    ...d,
    freeCells: d.freeCells.filter((_, i) => i !== index),
    slots: slotsFor(d, d.freeCells.length).filter((_, i) => i !== index),
  });

/** Free layout: a copy of frame `index` with its photo, a little down and right; the copy's index. */
export function duplicateFrame(index: number, d: CollageDoc): { edit: Edit; index: number } | null {
  const c = d.freeCells[index];
  if (!c) return null;
  const copy = { ...c, id: newId(), x: c.x + 0.02 / d.slides, y: c.y + 0.02 };
  return {
    index: d.freeCells.length,
    edit: (doc) => ({
      ...doc,
      freeCells: [...doc.freeCells, copy],
      slots: [...slotsFor(doc, doc.freeCells.length), doc.slots[index] ? { ...doc.slots[index]! } : null],
    }),
  };
}

export const patchFrame =
  (index: number, patch: Partial<FreeCell>): Edit =>
  (d) => ({ ...d, freeCells: d.freeCells.map((c, i) => (i === index ? { ...c, ...patch } : c)) });

/** Deletes a text, element, or a free layout's photo frame; a template's photo places stay. */
export const remove =
  (sel: Selection): Edit =>
  (d) =>
    sel?.kind === 'text'
      ? { ...d, texts: d.texts.filter((x) => x.id !== sel.id) }
      : sel?.kind === 'sticker'
        ? { ...d, stickers: d.stickers.filter((x) => x.id !== sel.id) }
        : sel?.kind === 'cell' && isFreeLayout(d)
          ? removeFrame(sel.index)(d)
          : d;

/** A copy of a text, element or free photo frame, a little down and to the right; returns its selection. */
export function duplicate(sel: Selection, d: CollageDoc): { edit: Edit; selection: Selection } | null {
  if (sel?.kind === 'cell' && isFreeLayout(d)) {
    const dup = duplicateFrame(sel.index, d);
    return dup && { edit: dup.edit, selection: { kind: 'cell', index: dup.index } };
  }
  const id = newId();
  if (sel?.kind === 'text') {
    const src = d.texts.find((x) => x.id === sel.id);
    if (!src) return null;
    return { selection: { kind: 'text', id }, edit: (doc) => ({ ...doc, texts: [...doc.texts, { ...src, id, x: Math.min(1, src.x + 0.02), y: Math.min(1, src.y + 0.02) }] }) };
  }
  if (sel?.kind === 'sticker') {
    const src = d.stickers.find((x) => x.id === sel.id);
    if (!src) return null;
    return { selection: { kind: 'sticker', id }, edit: (doc) => ({ ...doc, stickers: [...doc.stickers, { ...src, id, x: Math.min(1, src.x + 0.02), y: Math.min(1, src.y + 0.02) }] }) };
  }
  return null;
}

/** Moves a text or element by (dx, dy) canvas pixels at `width`. */
export const nudge =
  (sel: Selection, dx: number, dy: number, width: number, height: number): Edit =>
  (d) => {
    const mv = <T extends { id: string; x: number; y: number }>(list: T[], id: string) =>
      list.map((x) => (x.id === id ? { ...x, x: x.x + dx / width, y: x.y + dy / height } : x));
    if (sel?.kind === 'text') return { ...d, texts: mv(d.texts, sel.id) };
    if (sel?.kind === 'sticker') return { ...d, stickers: mv(d.stickers, sel.id) };
    if (sel?.kind === 'cell' && isFreeLayout(d))
      return { ...d, freeCells: d.freeCells.map((c, i) => (i === sel.index ? { ...c, x: c.x + dx / width, y: c.y + dy / height } : c)) };
    return d;
  };

export const patchSticker =
  (id: string, patch: Partial<StickerLayer>): Edit =>
  (d) => ({ ...d, stickers: d.stickers.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

export const patchText =
  (id: string, patch: Partial<TextLayer>): Edit =>
  (d) => ({ ...d, texts: d.texts.map((x) => (x.id === id ? { ...x, ...patch } : x)) });

export const toggleMeta =
  (key: string, field: 'hidden' | 'locked'): Edit =>
  (d) =>
    patchLayerMeta(d, key, { [field]: !d.layerMeta[key]?.[field] });

export const order =
  (key: string, to: LayerMove): Edit =>
  (d) =>
    moveLayer(d, key, to);
