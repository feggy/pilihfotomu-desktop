import { convertFileSrc } from '@tauri-apps/api/core';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { api } from '../lib/api';
import { slotsFor, templateOf, type CollageDoc } from './engine/document';
import { cellLayouts, drawCollage, frameOf, hitCell, placeImage, textBox, type Selection } from './engine/render';
import { fontFamilies, loadDocFonts, loadLocalImage, photoIdOf } from './kit';
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
  const key = doc ? slotsFor(doc, templateOf(doc).cells.length).map((s) => s?.file.fileId ?? '').join(',') : '';
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
    return () => {
      alive = false;
    };
    // The photo list is what matters, not every edit of the design.
  }, [key, root, sharp]);
  return images;
}

export interface CanvasHandlers {
  onSelect?: (s: Selection) => void;
  /** Dragging inside a photo: its new pan. */
  onPan?: (index: number, ox: number, oy: number) => void;
  /** Wheel over a photo: its new zoom. */
  onZoom?: (index: number, zoom: number) => void;
  /** Dragging a text: its new centre (fractions of the canvas). */
  onMoveText?: (id: string, x: number, y: number) => void;
  /** Gesture finished (one undo step per drag). */
  onCommit?: () => void;
}

/**
 * The design drawn by the engine, fitted into `box`, with picking, panning
 * photos, zooming photos and moving texts.
 */
export function DocCanvas({
  doc,
  images,
  box,
  selection,
  numbered,
  handlers = {},
}: {
  doc: CollageDoc;
  images: Map<string, HTMLImageElement>;
  box: { w: number; h: number };
  selection: Selection;
  numbered?: boolean;
  handlers?: CanvasHandlers;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ratio = frameOf(doc, 1).height;
  const width = Math.max(10, Math.floor(Math.min(box.w, box.h / ratio)));
  const f = frameOf(doc, width);
  const [fontsReady, setFontsReady] = useState(0);

  useEffect(() => {
    loadDocFonts(doc).then(() => setFontsReady((n) => n + 1));
  }, [doc.texts]);

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(f.width * dpr);
    c.height = Math.round(f.height * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, f.width, f.height);
    drawCollage(ctx, {
      width: f.width,
      doc,
      template: templateOf(doc),
      assets: { ...emptyAssets(), images },
      editor: {
        selection,
        swapTarget: null,
        numbered,
        emptyFill: '#e8e2d4',
        emptyText: '#8c6a30',
        accent: '#c9a96e',
      },
    });
  }, [doc, images, selection, f.width, f.height, numbered, fontsReady]);

  // ── Picking and dragging ─────────────────────────────────────
  const drag = useRef<{ kind: 'pan' | 'text'; index: number; id: string; x: number; y: number; ox: number; oy: number; overX: number; overY: number; tx: number; ty: number } | null>(null);
  const at = (e: React.PointerEvent | React.WheelEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pick = (x: number, y: number): Selection => {
    const ctx = ref.current!.getContext('2d')!;
    const fam = fontFamilies();
    for (let i = doc.texts.length - 1; i >= 0; i--) {
      const tx = doc.texts[i]!;
      const b = textBox(ctx, tx, f, fam);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { kind: 'text', id: tx.id };
    }
    const layouts = cellLayouts(templateOf(doc), f, doc.style, doc.slots);
    const i = hitCell(layouts, x, y);
    return i >= 0 ? { kind: 'cell', index: i } : null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const { x, y } = at(e);
    const s = pick(x, y);
    handlers.onSelect?.(s);
    if (!s) return;
    if (s.kind === 'text') {
      const tx = doc.texts.find((t) => t.id === s.id)!;
      drag.current = { kind: 'text', index: -1, id: s.id, x, y, ox: 0, oy: 0, overX: 0, overY: 0, tx: tx.x, ty: tx.y };
    } else if (s.kind === 'cell') {
      const slot = doc.slots[s.index];
      const img = slot && images.get(slot.file.fileId);
      if (!slot || !img) return;
      const layout = cellLayouts(templateOf(doc), f, doc.style, doc.slots)[s.index]!;
      const p = placeImage(img, layout.photo, slot);
      drag.current = { kind: 'pan', index: s.index, id: '', x, y, ox: slot.ox, oy: slot.oy, overX: p.overX, overY: p.overY, tx: 0, ty: 0 };
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = at(e);
    const dx = x - d.x;
    const dy = y - d.y;
    if (d.kind === 'text') {
      handlers.onMoveText?.(d.id, clamp(d.tx + dx / f.width, 0, 1), clamp(d.ty + dy / f.height, 0, 1));
    } else {
      // Moving the picture right shows more of its left: the pan goes down.
      const ox = d.overX > 0 ? clamp(d.ox - (2 * dx) / d.overX, -1, 1) : d.ox;
      const oy = d.overY > 0 ? clamp(d.oy - (2 * dy) / d.overY, -1, 1) : d.oy;
      handlers.onPan?.(d.index, ox, oy);
    }
  };
  const onPointerUp = () => {
    if (drag.current) handlers.onCommit?.();
    drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!handlers.onZoom) return;
    const { x, y } = at(e);
    const s = pick(x, y);
    if (s?.kind !== 'cell' || !doc.slots[s.index]) return;
    const zoom = clamp(doc.slots[s.index]!.zoom * Math.exp(-e.deltaY * 0.002), 1, 3);
    handlers.onZoom(s.index, zoom);
  };

  return (
    <canvas
      ref={ref}
      style={{ width: f.width, height: f.height }}
      className="touch-none rounded-[4px] shadow-[0_20px_60px_rgb(0_0_0/0.5)]"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    />
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

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
