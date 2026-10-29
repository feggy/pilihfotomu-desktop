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
  emptyPhotoFile,
  type CollageDoc,
  type FreeCell,
  type Slot,
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

/** A picture brought in from this computer, in the middle of the first slide; a tall one narrower. */
export function addImage(sticker: string, ratio: number): { edit: Edit; id: string } {
  const id = newId();
  return {
    id,
    edit: (d) => ({
      ...d,
      stickers: [...d.stickers, { id, sticker, x: firstSlideMiddle(d), y: 0.5, size: Math.min(0.4, 0.5 / ratio) / d.slides, rotate: 0, color: '#ffffff', ratio }],
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
export function duplicateFrame(index: number, d: CollageDoc, shift = 0.02): { edit: Edit; index: number } | null {
  const c = d.freeCells[index];
  if (!c) return null;
  const copy = { ...c, id: newId(), x: c.x + shift / d.slides, y: c.y + shift };
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
export function duplicate(sel: Selection, d: CollageDoc, shift = 0.02): { edit: Edit; selection: Selection } | null {
  if (sel?.kind === 'cell' && isFreeLayout(d)) {
    const dup = duplicateFrame(sel.index, d, shift);
    return dup && { edit: dup.edit, selection: { kind: 'cell', index: dup.index } };
  }
  const id = newId();
  if (sel?.kind === 'text') {
    const src = d.texts.find((x) => x.id === sel.id);
    if (!src) return null;
    return { selection: { kind: 'text', id }, edit: (doc) => ({ ...doc, texts: [...doc.texts, { ...src, id, x: Math.min(1, src.x + shift), y: Math.min(1, src.y + shift) }] }) };
  }
  if (sel?.kind === 'sticker') {
    const src = d.stickers.find((x) => x.id === sel.id);
    if (!src) return null;
    return { selection: { kind: 'sticker', id }, edit: (doc) => ({ ...doc, stickers: [...doc.stickers, { ...src, id, x: Math.min(1, src.x + shift), y: Math.min(1, src.y + shift) }] }) };
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

// ── Several at once ───────────────────────────────────────────────

type Picked = NonNullable<Selection>;

/** Puts each picked thing at its place: a text's or element's middle, a free frame's corner. */
export const placeMany =
  (moves: { sel: Picked; x: number; y: number }[]): Edit =>
  (d) => {
    const keyOf2 = (s: Picked) => ('id' in s ? s.id : 'index' in s ? s.index : null);
    const at = (kind: string, key: string | number) => moves.find((m) => m.sel.kind === kind && keyOf2(m.sel) === key);
    return {
      ...d,
      texts: d.texts.map((x) => {
        const m = at('text', x.id);
        return m ? { ...x, x: m.x, y: m.y } : x;
      }),
      stickers: d.stickers.map((x) => {
        const m = at('sticker', x.id);
        return m ? { ...x, x: m.x, y: m.y } : x;
      }),
      freeCells: d.freeCells.map((c, i) => {
        const m = at('cell', i);
        return m ? { ...c, x: m.x, y: m.y } : c;
      }),
    };
  };

/** Deletes every picked thing (free frames from the last, so the others keep their places). */
export const removeMany =
  (list: Picked[]): Edit =>
  (d) => {
    const frames = list.flatMap((s) => (s.kind === 'cell' ? [s.index] : [])).sort((a, b) => b - a);
    let next = list.filter((s) => s.kind !== 'cell').reduce((doc, s) => remove(s)(doc), d);
    for (const i of frames) next = removeFrame(i)(next);
    return next;
  };

/** A copy of every picked thing; the copies, to pick next. */
export function duplicateMany(list: Picked[], d: CollageDoc, shift = 0.02): { edit: Edit; selection: Picked[] } {
  let doc = d;
  const picked: Picked[] = [];
  for (const s of list) {
    const dup = duplicate(s, doc, shift);
    if (!dup?.selection) continue;
    doc = dup.edit(doc);
    picked.push(dup.selection);
  }
  return { edit: () => doc, selection: picked };
}

export const nudgeMany =
  (list: Picked[], dx: number, dy: number, width: number, height: number): Edit =>
  (d) =>
    list.reduce((doc, s) => nudge(s, dx, dy, width, height)(doc), d);

export type Align = 'kiri' | 'tengah' | 'kanan' | 'atas' | 'tengah-v' | 'bawah';

type Box = { l: number; r: number; t: number; b: number };

/**
 * Lines the picked things up on `box`, or else on the box around all of
 * them. `bounds` is each one's box on the canvas, as 0–1 of its width and height.
 */
export const alignMany =
  (list: Picked[], bounds: Box[], to: Align, box?: Box): Edit =>
  (d) => {
    const L = box?.l ?? Math.min(...bounds.map((b) => b.l)), R = box?.r ?? Math.max(...bounds.map((b) => b.r));
    const T = box?.t ?? Math.min(...bounds.map((b) => b.t)), B = box?.b ?? Math.max(...bounds.map((b) => b.b));
    const shift = (b: (typeof bounds)[number]) =>
      to === 'kiri'
        ? [L - b.l, 0]
        : to === 'kanan'
          ? [R - b.r, 0]
          : to === 'tengah'
            ? [(L + R) / 2 - (b.l + b.r) / 2, 0]
            : to === 'atas'
              ? [0, T - b.t]
              : to === 'bawah'
                ? [0, B - b.b]
                : [0, (T + B) / 2 - (b.t + b.b) / 2];
    return list.reduce((doc, s, i) => {
      const [dx, dy] = shift(bounds[i]!);
      return nudge(s, dx!, dy!, 1, 1)(doc);
    }, d);
  };

// ── Copy and paste ───────────────────────────────────────────────

/**
 * Layers copied with ⌘C / ⌘X, kept in the app (not the system clipboard), so
 * they can be pasted into this design or another. A frame's photo belongs to
 * the photos it came from (`root`).
 */
export interface Clip {
  root: string | null;
  texts: TextLayer[];
  stickers: StickerLayer[];
  frames: { cell: FreeCell; slot: Slot | null }[];
}

export function copyOf(list: Picked[], d: CollageDoc, root: string | null): Clip {
  return {
    root,
    texts: list.flatMap((s) => (s.kind === 'text' ? d.texts.filter((x) => x.id === s.id) : [])),
    stickers: list.flatMap((s) => (s.kind === 'sticker' ? d.stickers.filter((x) => x.id === s.id) : [])),
    frames: list.flatMap((s) => (s.kind === 'cell' && isFreeLayout(d) && d.freeCells[s.index] ? [{ cell: d.freeCells[s.index]!, slot: d.slots[s.index] ?? null }] : [])),
  };
}

/**
 * The clip in `d`, each thing `shift` down and right of where it was copied
 * from; what was pasted, to pick next. Frames only go into a free layout; a
 * frame from other photos keeps its shape but not its picture.
 */
export function pasteClip(clip: Clip, d: CollageDoc, root: string | null, shift: number): { edit: Edit; selection: Picked[] } {
  const texts = clip.texts.map((x) => ({ ...x, id: newId(), x: Math.min(1, x.x + shift / d.slides), y: Math.min(1, x.y + shift) }));
  const stickers = clip.stickers.map((x) => ({ ...x, id: newId(), x: Math.min(1, x.x + shift / d.slides), y: Math.min(1, x.y + shift) }));
  const frames = isFreeLayout(d) ? clip.frames : [];
  const same = clip.root === root;
  return {
    selection: [
      ...texts.map((x) => ({ kind: 'text', id: x.id }) as const),
      ...stickers.map((x) => ({ kind: 'sticker', id: x.id }) as const),
      ...frames.map((_, i) => ({ kind: 'cell', index: d.freeCells.length + i }) as const),
    ],
    edit: (doc) => ({
      ...doc,
      texts: [...doc.texts, ...texts],
      stickers: [...doc.stickers, ...stickers],
      freeCells: [...doc.freeCells, ...frames.map((f) => ({ ...f.cell, id: newId(), x: f.cell.x + shift / doc.slides, y: f.cell.y + shift }))],
      slots: [
        ...slotsFor(doc, doc.freeCells.length),
        ...frames.map((f, i) => (f.slot ? (same ? { ...f.slot } : { ...f.slot, file: emptyPhotoFile(doc.freeCells.length + i + 1) }) : null)),
      ],
    }),
  };
}
