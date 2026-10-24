import {
  isFreeLayout,
  isLayerHidden,
  photoLayerKey,
  stickerLayerKey,
  textLayerKey,
  type CollageDoc,
} from './document';
import type { CollageTemplate } from './templates';
import type { FontFamilies } from './font-catalog';
import { cellRects, stickerBox, textBox, type Frame2D } from './render';

/** An item's upright bounding box in canvas pixels — a turned item's full extent. */
export interface ItemBounds {
  /** Layer key: `text:…`, `sticker:…` or `photo:…`. */
  key: string;
  l: number;
  r: number;
  t: number;
  b: number;
}

function extent(cx: number, cy: number, w: number, h: number, radians: number) {
  const c = Math.abs(Math.cos(radians));
  const s = Math.abs(Math.sin(radians));
  const hw = (w * c + h * s) / 2;
  const hh = (w * s + h * c) / 2;
  return { l: cx - hw, r: cx + hw, t: cy - hh, b: cy + hh };
}

/**
 * The boxes of everything that can be moved — texts, elements and free photo
 * frames — for lining things up: snapping while dragging, and the align buttons.
 * Hidden layers are left out.
 */
export function itemBounds(
  doc: CollageDoc,
  template: CollageTemplate,
  f: Frame2D,
  families: FontFamilies,
  ctx: CanvasRenderingContext2D,
): ItemBounds[] {
  const out: ItemBounds[] = [];
  for (const t of doc.texts) {
    const key = textLayerKey(t.id);
    if (isLayerHidden(doc, key)) continue;
    const r = textBox(ctx, t, f, families);
    out.push({
      key,
      ...extent(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, ((t.rotate ?? 0) * Math.PI) / 180),
    });
  }
  for (const s of doc.stickers) {
    const key = stickerLayerKey(s.id);
    if (isLayerHidden(doc, key)) continue;
    const b = stickerBox(s, f);
    out.push({ key, ...extent(b.cx, b.cy, b.w, b.h, b.rotate) });
  }
  if (isFreeLayout(doc)) {
    const rects = cellRects(template, f, doc.style);
    doc.freeCells.forEach((c, i) => {
      const key = photoLayerKey(c.id);
      const r = rects[i];
      if (!r || isLayerHidden(doc, key)) return;
      out.push({
        key,
        ...extent(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h, (c.rotate * Math.PI) / 180),
      });
    });
  }
  return out;
}
