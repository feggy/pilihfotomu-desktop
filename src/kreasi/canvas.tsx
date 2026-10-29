import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { api } from '../lib/api';
import { t } from '../lib/i18n';
import {
  isFreeLayout,
  isImageSticker,
  isLayerHidden,
  isLayerLocked,
  layerKeys,
  photoLayerKey,
  slidePixels,
  slotsFor,
  stickerLayerKey,
  templateOf,
  textLayerKey,
  type CollageDoc,
  type FreeCell,
  type StickerLayer,
} from './engine/document';
import { itemBounds } from './engine/bounds';
import { safeArea } from './engine/instagram';
import { cellLayouts, drawCollage, drawSticker, frameOf, hitCell, photoPlacement, placeImage, stickerBox, textBox, type Frame2D, type Selection } from './engine/render';
import { coverCrop, fontFamilies, loadDocFonts, loadLocalImage, photoIdOf, photoIdOfSticker } from './kit';
import { assetIdOf, assetImage } from './assets';
import { LOGO_STICKER, useBrand, useBrandLogo } from './brand';
import { emptyAssets } from './preview';

const previewPaths = new Map<string, Promise<string>>();
/** The 2048 px preview of a session photo (made on first use, cached by Rust). */
export function previewUrl(root: string, id: number): Promise<string> {
  const k = `${root}#${id}`;
  let p = previewPaths.get(k);
  if (!p) {
    p = api.previewImage(root, id).then(convertFileSrc);
    p.catch(() => previewPaths.delete(k));
    previewPaths.set(k, p);
  }
  return p;
}

/**
 * The pictures of a design's photos, by file id: thumbnails at once, and the
 * 2048 px previews after them when `sharp` (editing and export look the same).
 */
export function useDocImages(doc: CollageDoc | null, root: string | null, sharp: boolean) {
  const [images, setImages] = useState<Map<string, HTMLImageElement>>(new Map());
  const pictures = doc ? doc.stickers.filter((s) => photoIdOfSticker(s.sticker) != null) : [];
  const elements = doc ? doc.stickers.filter((s) => assetIdOf(s.sticker) != null) : [];
  const key = doc
    ? [
        ...slotsFor(doc, templateOf(doc).cells.length).map((s) => s?.file.fileId ?? ''),
        ...pictures.map((s) => `${s.sticker}:${(s.ratio ?? 1).toFixed(3)}`),
        ...elements.map((s) => s.sticker),
      ].join(',')
    : '';
  useEffect(() => {
    if (!doc) return;
    let alive = true;
    const slots = slotsFor(doc, templateOf(doc).cells.length);
    for (const s of slots) {
      if (!s?.file.thumbnailUrl) continue;
      const id = s.file.fileId;
      loadLocalImage(s.file.thumbnailUrl).then(
        (img) => alive && setImages((m) => (m.has(id) ? m : new Map(m).set(id, img))),
        () => {},
      );
      const n = photoIdOf(s.file);
      if (sharp && root && n != null) {
        previewUrl(root, n)
          .then(loadLocalImage)
          .then((img) => alive && setImages((m) => new Map(m).set(id, img)), () => {});
      }
    }
    // Background pictures from photos, cut to their box (keyed by the sticker id).
    if (root)
      for (const st of pictures) {
        const n = photoIdOfSticker(st.sticker)!;
        previewUrl(root, n)
          .then(loadLocalImage)
          .then((img) => alive && setImages((m) => new Map(m).set(st.sticker, coverCrop(img, st.ratio ?? 1) as unknown as HTMLImageElement)), () => {});
      }
    // Picture elements (a photo without its background), from their files.
    for (const st of elements)
      assetImage(assetIdOf(st.sticker)!).then((img) => alive && setImages((m) => (m.has(st.sticker) ? m : new Map(m).set(st.sticker, img))), () => {});
    return () => {
      alive = false;
    };
    // The photo list is what matters, not every edit of the design.
  }, [key, root, sharp]);
  return images;
}

/** Resize arrows turned 45° clockwise at a time: ↗ → ↔ → ↘ → ↕. */
const RESIZE_CURSORS = ['nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize'] as const;

/**
 * The resize cursor for a corner handle (its position classes), along the
 * diagonal it pulls: ↘ at top-left and bottom-right, ↗ at the other two,
 * turned with the box.
 */
function cornerCursor(pos: string, rotate: number): string {
  const start = pos.includes('-right-') === pos.includes('-top-') ? 0 : 2;
  const step = Math.round(rotate / 45);
  return RESIZE_CURSORS[(((start + step) % 4) + 4) % 4]!;
}

export interface CanvasHandlers {
  onSelect?: (s: Selection) => void;
  /** Dragging inside a photo: its new pan. */
  onPan?: (index: number, ox: number, oy: number) => void;
  /** ⌥ + wheel over a photo: its new zoom. */
  onZoom?: (index: number, zoom: number) => void;
  /** A text or element moved, resized or turned (live, during the drag). */
  onPatch?: (sel: Extract<Selection, { kind: 'text' | 'sticker' }>, patch: { x?: number; y?: number; size?: number; rotate?: number }) => void;
  /** Double-click on a text: edit it in place. */
  onEditText?: (id: string) => void;
  /** Typing in the in-place text box. */
  onTextInput?: (id: string, text: string) => void;
  onEndEdit?: () => void;
  /** A photo dropped from the photo list onto a place. */
  onDropPhoto?: (index: number, photoId: number) => void;
  /** Gesture finished (one undo step per drag). */
  onCommit?: () => void;
  /** Free layout: a photo frame moved, resized or turned (live, during the drag). */
  onFrame?: (index: number, patch: Partial<FreeCell>) => void;
  /** Several things picked (a box dragged, Shift + click); an empty list drops them. */
  onMulti?: (list: Multi) => void;
  /** The picked things dragged together (live). */
  onMove?: (moves: Placed[]) => void;
  /** ⌥ + drag: copies of these, right where they are, picked; the drag moves the copies. */
  onCloneDrag?: (list: Multi) => Multi;
  /** Free layout: a photo from the list dropped on empty canvas, at (x, y) as 0–1 of it. */
  onDropNew?: (photoId: number, x: number, y: number) => void;
  /** Double-click on a photo: "Atur foto" for it. */
  onCropCell?: (index: number) => void;
  /** Leaves "Atur foto" (a click outside the photo). */
  onEndCrop?: () => void;
}

/** Within this many screen pixels of a line, a dragged item snaps onto it. */
const SNAP_PX = 6;
/** The canvas and slide edges hold a little more firmly, as in design apps. */
const SNAP_EDGE_PX = 10;
/** Turning snaps to straight within this many degrees of a quarter turn. */
const SNAP_DEG = 4;
const snapAngle = (deg: number) => {
  const near = Math.round(deg / 90) * 90;
  return Math.abs(deg - near) <= SNAP_DEG ? near : deg;
};
/** A press that moves less than this is a click (select), not a drag. */
const CLICK_SLOP = 3;

/**
 * What a dragged item can line up with, as canvas fractions: its own half
 * size, and the vertical (x) and horizontal (y) lines — the canvas and slide
 * centres and edges, and the edges and middles of every other item
 * (engine `itemBounds`). Worked out once when the drag starts.
 */
interface SnapInfo {
  hw: number;
  hh: number;
  tx: number[];
  ty: number[];
}

function snapInfo(doc: CollageDoc, f: ReturnType<typeof frameOf>, ctx: CanvasRenderingContext2D, key: string): SnapInfo {
  const all = itemBounds(doc, templateOf(doc), f, fontFamilies(), ctx);
  const own = all.find((b) => b.key === key);
  // Photos in a tiled layout don't move, but they are good lines to line up with.
  const cells = cellLayouts(templateOf(doc), f, doc.style, doc.slots).map((c, i) => ({
    key: `cell:${i}`,
    l: c.rect.x,
    r: c.rect.x + c.rect.w,
    t: c.rect.y,
    b: c.rect.y + c.rect.h,
  }));
  const others = [...all.filter((b) => b.key !== key), ...(isFreeLayout(doc) ? [] : cells)];
  return {
    hw: own ? (own.r - own.l) / 2 / f.width : 0,
    hh: own ? (own.b - own.t) / 2 / f.height : 0,
    tx: [
      0.5,
      0,
      1,
      ...Array.from({ length: doc.slides - 1 }, (_, i) => (i + 1) / doc.slides),
      ...Array.from({ length: doc.slides }, (_, i) => (i + 0.5) / doc.slides),
      ...others.flatMap((b) => [b.l, (b.l + b.r) / 2, b.r].map((v) => v / f.width)),
    ],
    ty: [0.5, 0, 1, ...others.flatMap((b) => [b.t, (b.t + b.b) / 2, b.b].map((v) => v / f.height))],
  };
}

/** The nearest line within reach of the item's start, middle or end; null when none is. */
function nearest(mid: number, half: number, lines: number[], px: number, isEdge: (t: number) => boolean) {
  let found: { line: number; shift: number } | null = null;
  for (const t of lines) {
    const limit = isEdge(t) ? SNAP_EDGE_PX : SNAP_PX;
    for (const edge of [mid - half, mid, mid + half]) {
      const shift = t - edge;
      if (Math.abs(shift) * px < limit && (!found || Math.abs(shift) < Math.abs(found.shift))) found = { line: t, shift };
    }
  }
  return found;
}

export type Box = { cx: number; cy: number; w: number; h: number; rotate: number };
type Item = Extract<Selection, { kind: 'text' | 'sticker' }>;

/** Several things picked at once (drag a box, or Shift + click): texts, elements, free photo frames. */
export type Multi = NonNullable<Selection>[];
/** Where a picked thing is: a text's or element's middle, a free frame's corner (0–1 of the canvas). */
export type Placed = { sel: NonNullable<Selection>; x: number; y: number };

export const sameSel = (a: Selection, b: Selection) =>
  !!a && !!b && a.kind === b.kind && (a.kind === 'cell' ? a.index === (b as { index: number }).index : 'id' in a && a.id === (b as { id: string }).id);

/**
 * The design drawn by the engine, fitted into `box` and enlarged by `scale`
 * (the view's zoom). In the editor (`outlines`): pick anything, drag texts and
 * elements (snapping to centres, edges and other items, with blue guides),
 * resize them from the corners, turn them from the round handle, edit a text
 * in place with a double-click, pan photos by dragging, zoom them with ⌥ +
 * wheel, and drop photos from the list onto places.
 */
export function DocCanvas({
  doc,
  images,
  box,
  scale = 1,
  selection,
  numbered,
  outlines,
  editingText,
  overlay,
  safe,
  cropping,
  hovered,
  hint,
  multi = [],
  bandFrom,
  handlers = {},
}: {
  doc: CollageDoc;
  images: Map<string, HTMLImageElement>;
  box: { w: number; h: number };
  scale?: number;
  selection: Selection;
  numbered?: boolean;
  /** Editor: blue hover/selection boxes over the canvas instead of the engine's own highlight. */
  outlines?: boolean;
  /** The text being typed into on the canvas. */
  editingText?: string | null;
  /** Drawn over the canvas next to the selection (the quick bar), given its box. */
  overlay?: (box: Box) => React.ReactNode;
  /** Shows where Instagram covers or crops the post (`engine/instagram.ts`). */
  safe?: boolean;
  /** "Atur foto": this photo place shows its whole picture, to drag and resize inside the place. */
  cropping?: number | null;
  /** Outlined as hovered from outside the canvas (the layer list). */
  hovered?: Selection;
  /** Said in the middle of an empty canvas: how to begin. */
  hint?: string;
  /** Picked together; `selection` is then null. */
  multi?: Multi;
  /** Set here: starts a selection box from a press outside the canvas (the stage around it). */
  bandFrom?: React.MutableRefObject<((e: { clientX: number; clientY: number; shiftKey: boolean }) => void) | null>;
  handlers?: CanvasHandlers;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ratio = frameOf(doc, 1).height;
  const width = Math.max(10, Math.floor(Math.min(box.w, box.h / ratio) * scale));
  const f = frameOf(doc, width);
  const [fontsReady, setFontsReady] = useState(0);
  const fam = fontFamilies();

  useEffect(() => {
    loadDocFonts(doc).then(() => setFontsReady((n) => n + 1));
  }, [doc.texts]);

  // The studio's name and logo (Pengaturan › Brand studio): the "Nama
  // Studio" texts, the watermark, and the logo placed as an element.
  const studio = useBrand((b) => b.studio);
  const logo = useBrandLogo();
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    // Sharp at any zoom, but never a canvas bigger than the GPU likes.
    const dpr = Math.min(window.devicePixelRatio || 1, 8192 / Math.max(f.width, f.height));
    c.width = Math.round(f.width * dpr);
    c.height = Math.round(f.height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, f.width, f.height);
    drawCollage(ctx, {
      width: f.width,
      doc,
      template: templateOf(doc),
      assets: {
        ...emptyAssets(),
        images,
        stickerImages: logo ? new Map(images).set(LOGO_STICKER, logo) : images,
        watermark: logo,
        studioName: studio,
      },
      editor: {
        selection: outlines ? null : selection,
        swapTarget: null,
        numbered,
        editingTextId: editingText ?? null,
        emptyFill: '#e8e2d4',
        emptyText: '#8c6a30',
        accent: '#c9a96e',
      },
    });
  }, [doc, images, selection, f.width, f.height, numbered, fontsReady, outlines, editingText, logo, studio]);

  /** An item's box on the canvas (CSS px): centre, size, tilt. */
  const boxOf = (sel: Selection): Box | null => {
    const c = ref.current;
    if (!sel || !c) return null;
    if (sel.kind === 'text') {
      const tx = doc.texts.find((t) => t.id === sel.id);
      if (!tx) return null;
      const b = textBox(c.getContext('2d')!, tx, f, fam);
      const pad = f.unit * 0.012;
      return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w + 2 * pad, h: b.h + 2 * pad, rotate: tx.rotate ?? 0 };
    }
    if (sel.kind === 'sticker') {
      const st = doc.stickers.find((x) => x.id === sel.id);
      if (!st) return null;
      const b = stickerBox(st, f);
      const pad = f.unit * 0.012;
      return { cx: b.cx, cy: b.cy, w: b.w + 2 * pad, h: b.h + 2 * pad, rotate: st.rotate };
    }
    if (sel.kind === 'cell') {
      const l = cellLayouts(templateOf(doc), f, doc.style, doc.slots)[sel.index];
      if (!l) return null;
      return { cx: l.rect.x + l.rect.w / 2, cy: l.rect.y + l.rect.h / 2, w: l.rect.w, h: l.rect.h, rotate: (l.rotate * 180) / Math.PI };
    }
    return null;
  };

  /** The whole picture of photo place `index` (CSS px), turned with its place. */
  const pictureOf = (index: number) => {
    const slot = doc.slots[index];
    const img = slot && images.get(slot.file.fileId);
    const l = cellLayouts(templateOf(doc), f, doc.style, doc.slots)[index];
    if (!slot || !img || !l) return null;
    // As the engine draws it: turned by the photo's own angle, then by its place's.
    const p = photoPlacement(img, l.photo, slot);
    const dx = p.cx - (l.rect.x + l.rect.w / 2), dy = p.cy - (l.rect.y + l.rect.h / 2);
    const c = Math.cos(l.rotate), sn = Math.sin(l.rotate);
    const box: Box = {
      cx: l.rect.x + l.rect.w / 2 + dx * c - dy * sn,
      cy: l.rect.y + l.rect.h / 2 + dx * sn + dy * c,
      w: p.dw,
      h: p.dh,
      rotate: ((l.rotate + p.angle) * 180) / Math.PI,
    };
    return { box, img, slot, over: { x: p.overX, y: p.overY }, flip: slot.flip };
  };
  const crop = cropping != null && outlines ? pictureOf(cropping) : null;

  // ── Picking ───────────────────────────────────────────────────
  const at = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const inside = (b: Box, x: number, y: number) => {
    const a = (-b.rotate * Math.PI) / 180;
    const dx = x - b.cx, dy = y - b.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
  };
  const free = isFreeLayout(doc);
  /** Free layout: a frame's layer key. */
  const frameKey = (index: number) => photoLayerKey(doc.freeCells[index]?.id ?? '');
  /**
   * Everything under (x, y), top first: texts by their box, elements by their
   * drawn shape (a ring's empty middle, a sticker's clear corners let clicks
   * through), then the photo place.
   */
  const pickAll = (x: number, y: number): NonNullable<Selection>[] => {
    const hits: NonNullable<Selection>[] = [];
    if (outlines) {
      for (const key of layerKeys(doc).reverse()) {
        if (isLayerHidden(doc, key)) continue;
        if (key.startsWith('text:')) {
          const sel = { kind: 'text', id: key.slice(5) } as const;
          const b = boxOf(sel);
          if (b && inside(b, x, y)) hits.push(sel);
        } else if (key.startsWith('sticker:')) {
          const st = doc.stickers.find((s) => s.id === key.slice(8));
          const b = st && boxOf({ kind: 'sticker', id: st.id });
          if (st && b && inside(b, x, y) && paintedAt(st, f, x, y)) hits.push({ kind: 'sticker', id: st.id });
        } else if (free && key.startsWith('photo:')) {
          const index = doc.freeCells.findIndex((c) => photoLayerKey(c.id) === key);
          const b = index >= 0 ? boxOf({ kind: 'cell', index }) : null;
          if (b && inside(b, x, y)) hits.push({ kind: 'cell', index });
        }
      }
      // The free layout's frames were among the layers; a template's photos sit under everything.
      if (free) return hits;
    } else {
      const ctx = ref.current!.getContext('2d')!;
      for (let i = doc.texts.length - 1; i >= 0; i--) {
        const tx = doc.texts[i]!;
        const b = textBox(ctx, tx, f, fam);
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) hits.push({ kind: 'text', id: tx.id });
      }
    }
    const layouts = cellLayouts(templateOf(doc), f, doc.style, doc.slots);
    const i = hitCell(layouts, x, y);
    if (i >= 0) hits.push({ kind: 'cell', index: i });
    return hits;
  };
  /** Topmost visible text or element at (x, y), then a photo place. */
  const pick = (x: number, y: number): Selection => pickAll(x, y)[0] ?? null;
  const keyOfItem = (sel: Item) => (sel.kind === 'text' ? textLayerKey(sel.id) : stickerLayerKey(sel.id));
  const itemOf = (sel: Item) => (sel.kind === 'text' ? doc.texts.find((t) => t.id === sel.id) : doc.stickers.find((x) => x.id === sel.id));

  // ── Several at once ───────────────────────────────────────────
  /** What can be picked with others: texts, elements and the free layout's frames. */
  const movable = (s: Selection): s is NonNullable<Selection> => !!s && (s.kind === 'text' || s.kind === 'sticker' || (s.kind === 'cell' && free));
  const layerKeyOf = (s: NonNullable<Selection>) => (s.kind === 'cell' ? frameKey(s.index) : keyOfItem(s as Item));
  const placeOf = (s: NonNullable<Selection>): Placed | null => {
    if (s.kind === 'cell') {
      const c = doc.freeCells[s.index];
      return c ? { sel: s, x: c.x, y: c.y } : null;
    }
    const it = itemOf(s as Item);
    return it ? { sel: s, x: it.x, y: it.y } : null;
  };
  /** Everything unlocked and shown whose box touches the rectangle (canvas px). */
  const within = (x0: number, y0: number, x1: number, y1: number): Multi => {
    const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
    const all: Multi = [
      ...doc.texts.map((x) => ({ kind: 'text', id: x.id }) as const),
      ...doc.stickers.map((x) => ({ kind: 'sticker', id: x.id }) as const),
      ...(free ? doc.freeCells.map((_, index) => ({ kind: 'cell', index }) as const) : []),
    ];
    return all.filter((s) => {
      const key = layerKeyOf(s);
      if (isLayerHidden(doc, key) || isLayerLocked(doc, key)) return false;
      const bx = boxOf(s);
      if (!bx) return false;
      // The turned box's extent.
      const a = (bx.rotate * Math.PI) / 180;
      const hw = (Math.abs(Math.cos(a)) * bx.w + Math.abs(Math.sin(a)) * bx.h) / 2;
      const hh = (Math.abs(Math.sin(a)) * bx.w + Math.abs(Math.cos(a)) * bx.h) / 2;
      return bx.cx + hw >= l && bx.cx - hw <= r && bx.cy + hh >= t && bx.cy - hh <= b;
    });
  };
  const merge = (a: Multi, b: Multi) => [...a, ...b.filter((x) => !a.some((y) => sameSel(x, y)))];
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** A selection box from (clientX, clientY), followed until the button is let go. */
  const beginBand = (clientX: number, clientY: number, base: Multi) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const x0 = clientX - r.left, y0 = clientY - r.top;
    let picked = base;
    setBand({ x0, y0, x1: x0, y1: y0 });
    const move = (ev: PointerEvent) => {
      const x1 = ev.clientX - r.left, y1 = ev.clientY - r.top;
      setBand({ x0, y0, x1, y1 });
      picked = merge(base, within(x0, y0, x1, y1));
      handlers.onMulti?.(picked);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBand(null);
      // One thing boxed is simply that thing, with its handles.
      if (picked.length === 1) (handlers.onMulti?.([]), handlers.onSelect?.(picked[0]!));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  if (bandFrom && outlines) bandFrom.current = (e) => beginBand(e.clientX, e.clientY, e.shiftKey ? multi : []);

  // ── Dragging ──────────────────────────────────────────────────
  type Drag =
    | { kind: 'pan'; index: number; x: number; y: number; ox: number; oy: number; overX: number; overY: number; moved: boolean; next?: Selection }
    | { kind: 'move'; sel: Item; x: number; y: number; ix: number; iy: number; snap: SnapInfo; moved: boolean; next: Selection; clone: boolean }
    | { kind: 'resize'; sel: Item; cx: number; cy: number; d0: number; size0: number }
    | { kind: 'turn'; sel: Item; cx: number; cy: number; a0: number; r0: number }
    | { kind: 'zoom'; index: number; cx: number; cy: number; d0: number; zoom0: number }
    | { kind: 'frame'; index: number; x: number; y: number; ix: number; iy: number; snap: SnapInfo; moved: boolean; next: Selection; clone: boolean }
    | { kind: 'frameSize'; index: number; cx: number; cy: number; d0: number; cell: FreeCell }
    | { kind: 'frameTurn'; index: number; cx: number; cy: number; a0: number; r0: number }
    | { kind: 'group'; x: number; y: number; from: Placed[]; moved: boolean; clone: boolean };
  const drag = useRef<Drag | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState<Selection>(null);
  // ⌥ held: over something that can move, the pointer shows a copy is coming (as in Photoshop).
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    if (!handlers.onCloneDrag) return;
    const key = (e: KeyboardEvent) => setAlt(e.altKey);
    const off = () => setAlt(false);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', off);
    };
  }, [!handlers.onCloneDrag]);
  // Guides: where they are and whether lit, kept apart so a line fades out where it was.
  const [guides, setGuides] = useState({ x: 0.5, y: 0.5, showX: false, showY: false });

  const start = (d: Drag, e: React.PointerEvent) => {
    drag.current = d;
    setDragging(true);
    // A pointer already gone (lifted during a slow frame) can't be captured; the drag still works.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* nothing to hold */
    }
  };

  const d0 = drag.current;
  const copyCursor = alt && !!handlers.onCloneDrag && !editingText && (d0 ? 'clone' in d0 && d0.clone : movable(hover));

  const onPointerDown = (e: React.PointerEvent) => {
    // The canvas takes the keyboard: a text box used before (inspector, search)
    // must not keep it, or ⌘Z, Delete and the arrows would go there.
    if (outlines && document.activeElement !== ref.current) ref.current?.focus({ preventScroll: true });
    if (e.button !== 0 || editingText) return;
    const { x, y } = at(e);
    if (crop && cropping != null) {
      // Inside the picture: move it. Outside: done resizing, carry on as a normal click.
      if (inside(crop.box, x, y)) {
        start({ kind: 'pan', index: cropping, x, y, ox: crop.slot.ox, oy: crop.slot.oy, overX: crop.over.x, overY: crop.over.y, moved: false }, e);
        return;
      }
      handlers.onEndCrop?.();
    }
    const hits = pickAll(x, y);
    if (outlines) {
      // Shift + click: in or out of the picked set.
      const top = hits[0];
      if (e.shiftKey && movable(top)) {
        const base = multi.length ? multi : movable(selection) ? [selection] : [];
        const has = base.some((m) => sameSel(m, top));
        const list = has ? base.filter((m) => !sameSel(m, top)) : [...base, top];
        if (list.length === 1) (handlers.onMulti?.([]), handlers.onSelect?.(list[0]!));
        else handlers.onMulti?.(list);
        return;
      }
      // On one of the picked set: they move together.
      const member = multi.length > 1 ? hits.find((h) => multi.some((m) => sameSel(m, h))) : undefined;
      if (member) {
        const from = multi.map(placeOf).filter((p): p is Placed => !!p);
        start({ kind: 'group', x, y, from, moved: false, clone: e.altKey }, e);
        return;
      }
      // Nothing there (or only the canvas): a selection box.
      if (!hits.length || (free && !movable(hits[0]))) {
        handlers.onSelect?.(null);
        handlers.onMulti?.([]);
        beginBand(e.clientX, e.clientY, []);
        return;
      }
      if (multi.length) handlers.onMulti?.([]);
    }
    // On what is already selected: a drag moves it (even under something
    // else); a click without moving reaches the layer under it, round and round.
    const was = hits.findIndex((h) => sameSel(h, selection));
    const s = was >= 0 ? hits[was]! : (hits[0] ?? null);
    const next = was >= 0 && hits.length > 1 ? hits[(was + 1) % hits.length]! : null;
    handlers.onSelect?.(s);
    if (!s) return;
    if (s.kind === 'text' || s.kind === 'sticker') {
      if (isLayerLocked(doc, keyOfItem(s))) return next && handlers.onSelect?.(next);
      const it = itemOf(s)!;
      const snap = snapInfo(doc, f, ref.current!.getContext('2d')!, keyOfItem(s));
      start({ kind: 'move', sel: s, x, y, ix: it.x, iy: it.y, snap, moved: false, next, clone: e.altKey }, e);
    } else if (s.kind === 'cell' && free) {
      // A free frame moves like any element; its picture moves in "Atur foto".
      const cell = doc.freeCells[s.index];
      if (!cell || isLayerLocked(doc, frameKey(s.index))) return next && handlers.onSelect?.(next);
      const snap = snapInfo(doc, f, ref.current!.getContext('2d')!, frameKey(s.index));
      start({ kind: 'frame', index: s.index, x, y, ix: cell.x + cell.w / 2, iy: cell.y + cell.h / 2, snap, moved: false, next, clone: e.altKey }, e);
    } else if (s.kind === 'cell') {
      const slot = doc.slots[s.index];
      const img = slot && images.get(slot.file.fileId);
      if (!slot || !img) return next && handlers.onSelect?.(next);
      const layout = cellLayouts(templateOf(doc), f, doc.style, doc.slots)[s.index]!;
      const p = placeImage(img, layout.photo, slot);
      start({ kind: 'pan', index: s.index, x, y, ox: slot.ox, oy: slot.oy, overX: p.overX, overY: p.overY, moved: false, next }, e);
    }
  };

  const onHandleDown = (e: React.PointerEvent, kind: 'resize' | 'turn') => {
    e.stopPropagation();
    if (crop && cropping != null) {
      const { x, y } = at(e);
      // Zoom from the place's middle, so the corner follows the pointer.
      const b = boxOf({ kind: 'cell', index: cropping })!;
      start({ kind: 'zoom', index: cropping, cx: b.cx, cy: b.cy, d0: Math.hypot(x - b.cx, y - b.cy), zoom0: crop.slot.zoom }, e);
      return;
    }
    const sel = selection;
    if (sel?.kind === 'cell' && free) {
      const cell = doc.freeCells[sel.index];
      const b = boxOf(sel);
      if (!cell || !b) return;
      const { x, y } = at(e);
      if (kind === 'resize') start({ kind: 'frameSize', index: sel.index, cx: b.cx, cy: b.cy, d0: Math.hypot(x - b.cx, y - b.cy), cell }, e);
      else start({ kind: 'frameTurn', index: sel.index, cx: b.cx, cy: b.cy, a0: Math.atan2(y - b.cy, x - b.cx), r0: cell.rotate }, e);
      return;
    }
    if (!sel || (sel.kind !== 'text' && sel.kind !== 'sticker')) return;
    const b = boxOf(sel)!;
    const { x, y } = at(e);
    const it = itemOf(sel)!;
    if (kind === 'resize') start({ kind: 'resize', sel, cx: b.cx, cy: b.cy, d0: Math.hypot(x - b.cx, y - b.cy), size0: it.size }, e);
    else start({ kind: 'turn', sel, cx: b.cx, cy: b.cy, a0: Math.atan2(y - b.cy, x - b.cx), r0: (it as { rotate?: number }).rotate ?? 0 }, e);
  };

  /**
   * ⌥ + drag: copies where the originals are once the drag really starts (a
   * click copies nothing); the drag then moves the copies, the originals stay.
   */
  const cloneOnce = (list: Multi) => {
    const d = drag.current!;
    if ('next' in d) d.next = null;
    return handlers.onCloneDrag?.(list) ?? list;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const { x, y } = at(e);
    if (!d) {
      if (crop || band) return;
      const h = pick(x, y);
      setHover((old) => (sameSel(old, h) || (!old && !h) ? old : h));
      return;
    }
    if (d.kind === 'move') {
      if (!d.moved && Math.hypot(x - d.x, y - d.y) < CLICK_SLOP) return;
      if (!d.moved && d.clone) d.sel = (cloneOnce([d.sel])[0] as Item | undefined) ?? d.sel;
      d.moved = true;
      const px = d.ix + (x - d.x) / f.width;
      const py = d.iy + (y - d.y) / f.height;
      // Hold ⌘/Ctrl to move freely, without the magnet.
      const free = e.metaKey || e.ctrlKey;
      const isEdgeX = (t: number) => t <= 0 || t >= 1 || Math.abs(t * doc.slides - Math.round(t * doc.slides)) < 1e-9;
      const sx = free ? null : nearest(px, d.snap.hw, d.snap.tx, f.width, isEdgeX);
      const sy = free ? null : nearest(py, d.snap.hh, d.snap.ty, f.height, (t) => t <= 0 || t >= 1);
      setGuides((g) => ({ x: sx?.line ?? g.x, y: sy?.line ?? g.y, showX: !!sx, showY: !!sy }));
      handlers.onPatch?.(d.sel, { x: clamp(px + (sx?.shift ?? 0), 0, 1), y: clamp(py + (sy?.shift ?? 0), 0, 1) });
    } else if (d.kind === 'resize') {
      const k = Math.hypot(x - d.cx, y - d.cy) / Math.max(1, d.d0);
      handlers.onPatch?.(d.sel, { size: clamp(d.size0 * k, 0.01, 2) });
    } else if (d.kind === 'zoom') {
      const k = Math.hypot(x - d.cx, y - d.cy) / Math.max(1, d.d0);
      handlers.onZoom?.(d.index, clamp(d.zoom0 * k, 1, 5));
    } else if (d.kind === 'group') {
      if (!d.moved && Math.hypot(x - d.x, y - d.y) < CLICK_SLOP) return;
      if (!d.moved && d.clone) {
        const copies = cloneOnce(d.from.map((p) => p.sel));
        d.from = d.from.map((p, i) => ({ ...p, sel: copies[i] ?? p.sel }));
      }
      d.moved = true;
      const dx = (x - d.x) / f.width, dy = (y - d.y) / f.height;
      handlers.onMove?.(d.from.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy })));
    } else if (d.kind === 'frame') {
      if (!d.moved && Math.hypot(x - d.x, y - d.y) < CLICK_SLOP) return;
      if (!d.moved && d.clone) {
        const copy = cloneOnce([{ kind: 'cell', index: d.index }])[0];
        if (copy?.kind === 'cell') d.index = copy.index;
      }
      d.moved = true;
      const cell = doc.freeCells[d.index];
      if (!cell) return;
      const px = d.ix + (x - d.x) / f.width;
      const py = d.iy + (y - d.y) / f.height;
      const loose = e.metaKey || e.ctrlKey;
      const isEdgeX = (t: number) => t <= 0 || t >= 1 || Math.abs(t * doc.slides - Math.round(t * doc.slides)) < 1e-9;
      const sx = loose ? null : nearest(px, d.snap.hw, d.snap.tx, f.width, isEdgeX);
      const sy = loose ? null : nearest(py, d.snap.hh, d.snap.ty, f.height, (t) => t <= 0 || t >= 1);
      setGuides((g) => ({ x: sx?.line ?? g.x, y: sy?.line ?? g.y, showX: !!sx, showY: !!sy }));
      handlers.onFrame?.(d.index, { x: px + (sx?.shift ?? 0) - cell.w / 2, y: py + (sy?.shift ?? 0) - cell.h / 2 });
    } else if (d.kind === 'frameSize') {
      // From the middle, keeping the frame's shape.
      const k = clamp(Math.hypot(x - d.cx, y - d.cy) / Math.max(1, d.d0), 0.05 / Math.max(d.cell.w, d.cell.h), 3);
      const w = d.cell.w * k, h = d.cell.h * k;
      handlers.onFrame?.(d.index, { x: d.cell.x + d.cell.w / 2 - w / 2, y: d.cell.y + d.cell.h / 2 - h / 2, w, h });
    } else if (d.kind === 'frameTurn') {
      const a = ((Math.atan2(y - d.cy, x - d.cx) - d.a0) * 180) / Math.PI;
      let deg = d.r0 + a;
      deg = ((((deg + 180) % 360) + 360) % 360) - 180;
      handlers.onFrame?.(d.index, { rotate: e.shiftKey ? Math.round(deg / 15) * 15 : snapAngle(deg) });
    } else if (d.kind === 'turn') {
      const a = ((Math.atan2(y - d.cy, x - d.cx) - d.a0) * 180) / Math.PI;
      let deg = d.r0 + a;
      deg = ((((deg + 180) % 360) + 360) % 360) - 180;
      handlers.onPatch?.(d.sel, { rotate: e.shiftKey ? Math.round(deg / 15) * 15 : snapAngle(deg) });
    } else {
      if (!d.moved && Math.hypot(x - d.x, y - d.y) < CLICK_SLOP) return;
      d.moved = true;
      // Moving the picture right shows more of its left: the pan goes down.
      const ox = d.overX > 0 ? clamp(d.ox - (2 * (x - d.x)) / d.overX, -1, 1) : d.ox;
      const oy = d.overY > 0 ? clamp(d.oy - (2 * (y - d.y)) / d.overY, -1, 1) : d.oy;
      handlers.onPan?.(d.index, ox, oy);
    }
  };
  const onPointerUp = () => {
    const d = drag.current;
    if (d && (d.kind === 'resize' || d.kind === 'turn' || d.kind === 'zoom' || d.kind === 'frameSize' || d.kind === 'frameTurn' || d.moved)) handlers.onCommit?.();
    else if (d && (d.kind === 'move' || d.kind === 'pan' || d.kind === 'frame') && d.next) handlers.onSelect?.(d.next);
    drag.current = null;
    setDragging(false);
    setGuides((g) => ({ ...g, showX: false, showY: false }));
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const s = pick(at(e).x, at(e).y);
    if (s?.kind === 'text' && !isLayerLocked(doc, textLayerKey(s.id))) handlers.onEditText?.(s.id);
    else if (s?.kind === 'cell') handlers.onCropCell?.(s.index);
  };
  const onWheel = (e: React.WheelEvent) => {
    // Plain scroll pans the view and ⌘/pinch zooms it (the editor handles both);
    // ⌥ + scroll zooms the photo under the pointer inside its place.
    if (!handlers.onZoom || !e.altKey) return;
    const s = pick(at(e).x, at(e).y);
    if (s?.kind !== 'cell' || !doc.slots[s.index]) return;
    e.stopPropagation();
    handlers.onZoom(s.index, clamp(doc.slots[s.index]!.zoom * Math.exp(-e.deltaY * 0.002), 1, 3));
    handlers.onCommit?.();
  };

  // Photos dragged from the list (see fill.tsx: `application/x-pilihfotomu-foto`).
  const [dropAt, setDropAt] = useState<number | null>(null);
  const dropIndex = (e: React.DragEvent) => {
    const s = pick(at(e).x, at(e).y);
    return s?.kind === 'cell' ? s.index : null;
  };
  const dnd = handlers.onDropPhoto
    ? {
        onDragOver: (e: React.DragEvent) => {
          if (!e.dataTransfer.types.includes('application/x-pilihfotomu-foto')) return;
          e.preventDefault();
          setDropAt(dropIndex(e));
        },
        onDragLeave: () => setDropAt(null),
        onDrop: (e: React.DragEvent) => {
          const i = dropIndex(e);
          const id = Number(e.dataTransfer.getData('application/x-pilihfotomu-foto'));
          setDropAt(null);
          if (!Number.isFinite(id)) return;
          e.preventDefault();
          if (i != null) handlers.onDropPhoto!(i, id);
          else if (free) handlers.onDropNew?.(id, at(e).x / f.width, at(e).y / f.height);
        },
      }
    : {};

  const selBox = outlines && !crop ? boxOf(selection) : null;
  // Several picked: each outlined, the quick bar over all of them.
  const multiBoxes = outlines && multi.length > 1 ? multi.map(boxOf).filter((b): b is Box => !!b) : [];
  const unionBox: Box | null = multiBoxes.length
    ? (() => {
        const l = Math.min(...multiBoxes.map((b) => b.cx - b.w / 2)), r = Math.max(...multiBoxes.map((b) => b.cx + b.w / 2));
        const t = Math.min(...multiBoxes.map((b) => b.cy - b.h / 2)), bt = Math.max(...multiBoxes.map((b) => b.cy + b.h / 2));
        return { cx: (l + r) / 2, cy: (t + bt) / 2, w: r - l, h: bt - t, rotate: 0 };
      })()
    : null;
  const editing = editingText ? doc.texts.find((x) => x.id === editingText) : null;
  const measureFrom = alt && !dragging && !editingText && !crop ? (unionBox ?? selBox ? edges((unionBox ?? selBox)!) : null) : null;
  const measureTo: { box: Edges; canvas: boolean } | null = (() => {
    if (!measureFrom) return null;
    const over = hover && !sameSel(hover, selection) && !multi.some((m) => sameSel(m, hover)) ? boxOf(hover) : null;
    if (over) return { box: edges(over), canvas: false };
    // The slide its middle is on.
    const i = Math.min(doc.slides - 1, Math.max(0, Math.floor((((measureFrom.l + measureFrom.r) / 2) / f.width) * doc.slides)));
    return { box: { l: i * f.unit, r: (i + 1) * f.unit, t: 0, b: f.height }, canvas: true };
  })();
  const editBox = editing ? boxOf({ kind: 'text', id: editing.id }) : null;
  const canHandle =
    !!selection &&
    !editing &&
    ((selection.kind === 'cell' && free && !!doc.freeCells[selection.index] && !isLayerLocked(doc, frameKey(selection.index))) ||
      ((selection.kind === 'text' || selection.kind === 'sticker') && !isLayerLocked(doc, keyOfItem(selection as Item))));

  return (
    <div className="relative shrink-0" style={{ width: f.width, height: f.height }} {...dnd}>
      <canvas
        ref={ref}
        tabIndex={outlines ? -1 : undefined}
        data-keyboard-target
        className="block touch-none rounded-[4px] shadow-[0_20px_60px_rgb(0_0_0/0.5)] outline-none"
        style={{ width: f.width, height: f.height, cursor: copyCursor ? 'copy' : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => (e.altKey !== alt && handlers.onCloneDrag && setAlt(e.altKey), onPointerMove(e))}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => !drag.current && setHover(null)}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      />
      {/* Guides — lit while a dragged item sits on a centre, an edge, or another item's line. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 w-px bg-[#3b9cff] transition-opacity ${guides.showX ? 'opacity-100 duration-0' : 'opacity-0 duration-300'}`}
        style={{ left: `${guides.x * 100}%`, transform: guides.x >= 1 ? 'translateX(-100%)' : undefined }}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 h-px bg-[#3b9cff] transition-opacity ${guides.showY ? 'opacity-100 duration-0' : 'opacity-0 duration-300'}`}
        style={{ top: `${guides.y * 100}%`, transform: guides.y >= 1 ? 'translateY(-100%)' : undefined }}
      />
      {/* A carousel's slides, numbered above the canvas where each one starts. */}
      {outlines &&
        doc.slides > 1 &&
        Array.from({ length: doc.slides }, (_, i) => (
          <span
            key={i}
            aria-hidden
            className="pointer-events-none absolute -top-6 text-center text-[11px] text-faint"
            style={{ left: `${(i / doc.slides) * 100}%`, width: `${100 / doc.slides}%` }}
          >
            {t('Slide {n}', { n: i + 1 })}
          </span>
        ))}
      {crop && (
        <>
          {/* The rest of the picture, faint, beyond its place. */}
          <img
            src={crop.img.src}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none opacity-40"
            style={{
              left: crop.box.cx - crop.box.w / 2,
              top: crop.box.cy - crop.box.h / 2,
              width: crop.box.w,
              height: crop.box.h,
              transform: `rotate(${crop.box.rotate}deg)${crop.flip ? ' scaleX(-1)' : ''}`,
            }}
          />
          <Outline box={boxOf({ kind: 'cell', index: cropping! })} selected />
          <Outline box={crop.box} selected>
            {(['-left-[6px] -top-[6px]', '-right-[6px] -top-[6px]', '-left-[6px] -bottom-[6px]', '-right-[6px] -bottom-[6px]'] as const).map((pos) => (
              <span
                key={pos}
                onPointerDown={(e) => onHandleDown(e, 'resize')}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className={`pointer-events-auto absolute size-[10px] border-[1.5px] border-[#3b9cff] bg-white ${pos}`}
                style={{ cursor: cornerCursor(pos, crop.box.rotate) }}
              />
            ))}
          </Outline>
        </>
      )}
      {hint && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <span className="max-w-[80%] rounded-lg bg-black/55 px-3 py-2 text-center text-xs text-white">{hint}</span>
        </span>
      )}
      {safe && <SafeZones doc={doc} />}
      {dropAt != null && <Outline box={boxOf({ kind: 'cell', index: dropAt })} drop />}
      {/* ⌥ held, not dragging: how far the picked thing is from what the pointer is over, or from its slide's edges. */}
      {measureFrom && measureTo && <Distances from={measureFrom} to={measureTo.box} canvas={measureTo.canvas} perPx={slidePixels(doc) / f.unit} />}
      {/* Hover: a thin outline on what the pointer is over. Selection: a firm one with handles. */}
      {outlines && !dragging && !sameSel(hovered ?? hover, selection) && <Outline box={boxOf(hovered ?? hover)} />}
      {selBox && (
        <Outline box={selBox} selected>
          {canHandle &&
            (['-left-[6px] -top-[6px]', '-right-[6px] -top-[6px]', '-left-[6px] -bottom-[6px]', '-right-[6px] -bottom-[6px]'] as const).map((pos) => (
              <span
                key={pos}
                onPointerDown={(e) => onHandleDown(e, 'resize')}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className={`pointer-events-auto absolute size-[10px] border-[1.5px] border-[#3b9cff] bg-white ${pos}`}
                style={{ cursor: cornerCursor(pos, selBox.rotate) }}
              />
            ))}
          {canHandle && (
            <span
              title={t('Putar')}
              onPointerDown={(e) => onHandleDown(e, 'turn')}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="pointer-events-auto absolute -top-7 left-1/2 size-3 -translate-x-1/2 cursor-grab rounded-full border-[1.5px] border-[#3b9cff] bg-white"
            />
          )}
        </Outline>
      )}
      {multiBoxes.map((b, i) => (
        <Outline key={i} box={b} selected />
      ))}
      {unionBox && <span className="pointer-events-none absolute border border-dashed border-[#3b9cff]/70" style={{ left: unionBox.cx - unionBox.w / 2 - 4, top: unionBox.cy - unionBox.h / 2 - 4, width: unionBox.w + 8, height: unionBox.h + 8 }} />}
      {band && (
        <span
          className="pointer-events-none absolute border border-[#3b9cff] bg-[#3b9cff]/10"
          style={{ left: Math.min(band.x0, band.x1), top: Math.min(band.y0, band.y1), width: Math.abs(band.x1 - band.x0), height: Math.abs(band.y1 - band.y0) }}
        />
      )}
      {!dragging && !editing && !band && (crop ? overlay?.(crop.box) : unionBox ? overlay?.(unionBox) : selBox && overlay?.(selBox))}
      {editing && editBox && (() => {
        // The DOM draws letters a little differently from the canvas (script
        // tails, spacing after the last letter): an em of room each side, and
        // lines that only break where the text does, so nothing wraps out of sight.
        const em = editing.size * f.unit;
        const w = editBox.w + 2 * em;
        return (
          <textarea
            autoFocus
            value={editing.text}
            onChange={(e) => handlers.onTextInput?.(editing.id, e.target.value)}
            onBlur={() => handlers.onEndEdit?.()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) (e.currentTarget as HTMLTextAreaElement).blur();
            }}
            spellCheck={false}
            wrap={editing.width ? 'soft' : 'off'}
            className="absolute resize-none overflow-hidden border-0 bg-transparent p-0 outline-none"
            style={{
              left: editBox.cx - w / 2,
              top: editBox.cy - editBox.h / 2,
              width: w,
              height: editBox.h,
              transform: editBox.rotate ? `rotate(${editBox.rotate}deg)` : undefined,
              // Wrapped text keeps the canvas's own line length.
              paddingInline: editing.width ? em + (editBox.w - editing.width * f.unit) / 2 : 0,
              boxSizing: 'border-box',
              whiteSpace: editing.width ? 'pre-wrap' : 'pre',
              fontFamily: fam[editing.font],
              fontSize: em,
              fontWeight: editing.weight,
              fontStyle: editing.italic ? 'italic' : 'normal',
              textTransform: editing.textCase === 'besar' ? 'uppercase' : editing.textCase === 'kecil' ? 'lowercase' : editing.textCase === 'kata' ? 'capitalize' : 'none',
              color: editing.color,
              textAlign: editing.align,
              letterSpacing: `${editing.spacing}em`,
              lineHeight: editing.lineHeight ?? 1.15,
              caretColor: '#3b9cff',
              paddingBlock: f.unit * 0.012,
            }}
          />
        );
      })()}
    </div>
  );
}

/**
 * Instagram's covered and cropped strips, per slide: a story's account name
 * and reply bar at the top and bottom, and the sides the profile grid cuts.
 */
function SafeZones({ doc }: { doc: CollageDoc }) {
  const a = safeArea(doc.format);
  const band = 'pointer-events-none absolute bg-[repeating-linear-gradient(135deg,rgb(224_100_90/0.22)_0_6px,transparent_6px_12px)]';
  return (
    <>
      {Array.from({ length: doc.slides }, (_, i) => {
        const left = (i / doc.slides) * 100;
        const w = 100 / doc.slides;
        return (
          <span key={i}>
            {a.storyTop > 0 && <span className={`${band} top-0 border-b border-dashed border-reject/70`} style={{ left: `${left}%`, width: `${w}%`, height: `${a.storyTop * 100}%` }} />}
            {a.storyBottom > 0 && <span className={`${band} bottom-0 border-t border-dashed border-reject/70`} style={{ left: `${left}%`, width: `${w}%`, height: `${a.storyBottom * 100}%` }} />}
            {a.gridSide > 0 && (
              <>
                <span className={`${band} inset-y-0 border-r border-dashed border-maybe/70`} style={{ left: `${left}%`, width: `${a.gridSide * w}%` }} />
                <span className={`${band} inset-y-0 border-l border-dashed border-maybe/70`} style={{ left: `${left + w - a.gridSide * w}%`, width: `${a.gridSide * w}%` }} />
              </>
            )}
          </span>
        );
      })}
    </>
  );
}

/** A box around an item, in the item's own tilt; firm with handles when selected, gold where a photo will drop. */
function Outline({ box, selected, drop, children }: { box: Box | null; selected?: boolean; drop?: boolean; children?: React.ReactNode }) {
  if (!box) return null;
  return (
    <span
      aria-hidden={!children}
      className={`pointer-events-none absolute ${drop ? 'border-2 border-[#c9a96e] bg-[#c9a96e]/15' : selected ? 'border-[1.5px] border-[#3b9cff]' : 'border border-[#3b9cff]'}`}
      style={{
        left: box.cx - box.w / 2,
        top: box.cy - box.h / 2,
        width: box.w,
        height: box.h,
        transform: box.rotate ? `rotate(${box.rotate}deg)` : undefined,
      }}
    >
      {children}
    </span>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Within this many screen pixels of an element's paint, a click still takes it (thin lines). */
const HIT_SLOP = 4;
const masks = new Map<string, { data: Uint8ClampedArray; w: number; h: number; k: number }>();

/**
 * Whether element `st` paints anything near (x, y): drawn alone, small, into a
 * mask kept until it changes — so a click in a ring's empty middle or a
 * sticker's clear corner goes through to what is under it.
 */
function paintedAt(st: StickerLayer, f: Frame2D, x: number, y: number) {
  // An uploaded picture has no shape to go by here: its box counts.
  if (isImageSticker(st.sticker)) return true;
  const key = `${JSON.stringify(st)}@${Math.round(f.width)}x${Math.round(f.height)}`;
  let m = masks.get(key);
  if (!m) {
    const k = Math.min(1, 600 / Math.max(f.width, f.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(f.width * k));
    c.height = Math.max(1, Math.round(f.height * k));
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.scale(k, k);
    // Faint or shadowed, it still counts where it is drawn.
    drawSticker(ctx, { ...st, opacity: 1, shadow: undefined }, f, new Map());
    m = { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height, k };
    if (masks.size > 200) masks.clear();
    masks.set(key, m);
  }
  const r = Math.max(1, Math.round(HIT_SLOP * m.k));
  const cx = Math.round(x * m.k), cy = Math.round(y * m.k);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const px = cx + dx, py = cy + dy;
      if (px >= 0 && py >= 0 && px < m.w && py < m.h && m.data[(py * m.w + px) * 4 + 3]! > 24) return true;
    }
  return false;
}

/** Size of an element, kept up to date. */
export function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
}

type Edges = { l: number; r: number; t: number; b: number };

/** The upright box around `b`, turned as it may be. */
function edges(b: Box): Edges {
  const a = (b.rotate * Math.PI) / 180;
  const hw = (Math.abs(Math.cos(a)) * b.w + Math.abs(Math.sin(a)) * b.h) / 2;
  const hh = (Math.abs(Math.sin(a)) * b.w + Math.abs(Math.cos(a)) * b.h) / 2;
  return { l: b.cx - hw, r: b.cx + hw, t: b.cy - hh, b: b.cy + hh };
}

const MEASURE = '#f24822';

/**
 * Figma's ⌥ distances: red lines with their length in exported pixels. One
 * box inside the other: from each side to the side around it. Apart: the gap
 * between them, across and down, where they face each other.
 */
function Distances({ from: a, to: b, canvas, perPx }: { from: Edges; to: Edges; canvas: boolean; perPx: number }) {
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const h = (x1: number, x2: number, y: number) => x2 - x1 > 0.5 && lines.push({ x1, y1: y, x2, y2: y });
  const v = (y1: number, y2: number, x: number) => y2 - y1 > 0.5 && lines.push({ x1: x, y1, x2: x, y2 });
  const inside = (o: Edges, i: Edges) => i.l >= o.l && i.r <= o.r && i.t >= o.t && i.b <= o.b;
  if (inside(b, a) || inside(a, b)) {
    const [o, i] = inside(b, a) ? [b, a] : [a, b];
    const cy = (i.t + i.b) / 2, cx = (i.l + i.r) / 2;
    h(o.l, i.l, cy);
    h(i.r, o.r, cy);
    v(o.t, i.t, cx);
    v(i.b, o.b, cx);
  } else {
    // Where they overlap the other way, the gap line runs through its middle.
    const midY = (Math.max(a.t, b.t) + Math.min(a.b, b.b)) / 2;
    const midX = (Math.max(a.l, b.l) + Math.min(a.r, b.r)) / 2;
    const y = Math.max(a.t, b.t) <= Math.min(a.b, b.b) ? midY : (a.t + a.b) / 2;
    const x = Math.max(a.l, b.l) <= Math.min(a.r, b.r) ? midX : (a.l + a.r) / 2;
    if (a.r <= b.l) h(a.r, b.l, y);
    else if (b.r <= a.l) h(b.r, a.l, y);
    if (a.b <= b.t) v(a.b, b.t, x);
    else if (b.b <= a.t) v(b.b, a.t, x);
  }
  return (
    <>
      {!canvas && (
        <span
          className="pointer-events-none absolute border border-dashed"
          style={{ left: b.l, top: b.t, width: b.r - b.l, height: b.b - b.t, borderColor: MEASURE }}
        />
      )}
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
        {lines.map((l, i) => (
          <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={MEASURE} strokeWidth={1} />
        ))}
      </svg>
      {lines.map((l, i) => (
        <span
          key={i}
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded px-1 py-px text-[10px] font-semibold text-white tabular-nums"
          style={{ left: (l.x1 + l.x2) / 2, top: (l.y1 + l.y2) / 2, background: MEASURE }}
        >
          {Math.round(Math.hypot(l.x2 - l.x1, l.y2 - l.y1) * perPx)}
        </span>
      ))}
    </>
  );
}
