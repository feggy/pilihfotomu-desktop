import type { DriveFile } from './types';
import type { CollageTemplate, Frame } from './templates';
import {
  BACKGROUND_LAYER,
  FREE_LAYOUT_ID,
  PHOTOS_LAYER,
  applyCase,
  isLayerHidden,
  layerKeys,
  photoLayerKey,
  stickerLayerKey,
  textLayerKey,
  isAdjusted,
  shownAdjust,
  isPlaceholder,
  isBackgroundHidden,
  behindKeys,
  isEmptyPhoto,
  isImageSticker,
  isShape,
  canvasRatio,
  withAlpha,
  slideBackgroundsFor,
  slotsFor,
  type CollageDoc,
  type SlideBackground,
  type BackdropStyle,
  type CollageStyle,
  type FontId,
  type PhotoAdjust,
  type Slot,
  type Gradient,
  type StickerLayer,
  type TextLayer,
  type Watermark,
  type PhotoMask,
  type PhotoFade,
  type DropShadow,
  FORMATS,
} from './document';
import { stickerById } from './stickers';
import { lineWidthOf, shapeById, traceShape } from './shapes';
import { makePdf } from './pdf';
import { gradientStops, stopCss } from './gradients';
import {
  blurredCopy,
  canvasFilterSupported,
  colorFiltered,
  type Drawable,
} from './filter-fallback';
import { developed, setDevelopFullSize } from './develop';
import { fontFamily, fontHasBold, type FontFamilies } from './font-catalog';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MAX_ZOOM = 3;

/** Looks for the background image. CSS filter syntax — canvas and <img> share it. */
export const BACKDROP_FILTERS = [
  { id: 'asli', label: 'Asli', css: '' },
  { id: 'hitam-putih', label: 'Hitam putih', css: 'grayscale(1)' },
  { id: 'sepia', label: 'Sepia', css: 'sepia(0.75)' },
  { id: 'pudar', label: 'Pudar', css: 'saturate(0.55) contrast(0.85) brightness(1.1)' },
  { id: 'hangat', label: 'Hangat', css: 'sepia(0.3) saturate(1.25) brightness(1.03)' },
  { id: 'redup', label: 'Redup', css: 'brightness(0.65) saturate(0.9)' },
] as const;

export { FONTS, type FontFamilies } from './font-catalog';

/** Canvas `font` shorthand for a text font at a pixel size. */
export function fontString(
  font: FontId,
  px: number,
  families: FontFamilies,
  weight = 400,
  italic = false,
): string {
  const w = fontHasBold(font) ? weight : 400;
  return `${italic ? 'italic ' : ''}${w} ${px}px ${fontFamily(font, families)}`;
}

/** Canvas geometry shared by every drawing and hit-test. */
export interface Frame2D {
  width: number;
  height: number;
  /** One slide's width — every size in the document is a fraction of it. */
  unit: number;
}

export function frameOf(doc: Pick<CollageDoc, 'format' | 'slides'>, width: number): Frame2D {
  return { width, height: width * canvasRatio(doc), unit: width / doc.slides };
}

/**
 * Pixel rect of every cell. Tiled layouts: the area is widened by half a gap on
 * each side and every cell is inset by half a gap — so inner gaps are one full
 * gap and the outer edge lands exactly on the padding.
 */
export function cellRects(template: CollageTemplate, f: Frame2D, style: CollageStyle): Rect[] {
  const { width, height, unit } = f;
  if (template.free) {
    return template.cells.map(([x, y, w, h]) => ({
      x: x * width,
      y: y * height,
      w: w * width,
      h: h * height,
    }));
  }
  const gap = style.gap * unit;
  const pad = style.padding * unit;
  // The rectangle the cells tile: a layout's own area, or the padded canvas.
  const [bx, by, bw, bh] = template.area
    ? [
        template.area[0] * width,
        template.area[1] * height,
        template.area[2] * width,
        template.area[3] * height,
      ]
    : [pad, pad, width - 2 * pad, height - 2 * pad];
  const ax = bx - gap / 2;
  const ay = by - gap / 2;
  const aw = bw + gap;
  const ah = bh + gap;
  return template.cells.map(([x, y, w, h]) => ({
    x: ax + x * aw + gap / 2,
    y: ay + y * ah + gap / 2,
    w: w * aw - gap,
    h: h * ah - gap,
  }));
}

/** White frame thickness per side, relative to the cell's short side. */
function frameInsets(frame: Frame | undefined, rect: Rect, scale: number) {
  const m = Math.min(rect.w, rect.h);
  if (frame === 'border') {
    const b = 0.04 * m * scale;
    return { top: b, right: b, bottom: b, left: b };
  }
  if (frame === 'polaroid') {
    const side = 0.055 * m * scale;
    // The deep bottom edge is what says "polaroid", but scaled 1:1 it would
    // squeeze a thick frame's photo into a strip — so it grows slower.
    const bottom = Math.min(0.2 * m * scale, side + 0.18 * m);
    return { top: side, right: side, bottom, left: side };
  }
  return { top: 0, right: 0, bottom: 0, left: 0 };
}

/**
 * Everything needed to draw or hit-test one cell: the outer rect (frame
 * included), its rotation in radians around the rect's center, and the photo
 * area inside the frame. Rects are unrotated, in canvas pixels.
 */
export interface CellLayout {
  rect: Rect;
  rotate: number;
  photo: Rect;
}

/** A photo's corner radius in px: its own share of its short side, or the collage's. */
function cornerRadius(slot: Slot | null, photo: Rect, collage: number, framed: boolean): number {
  if (framed) return 0;
  if (slot?.radius != null) return slot.radius * Math.min(photo.w, photo.h);
  return collage;
}

/**
 * The corner a photo shows now, as a share of its short side (0–0.5) — where
 * the photo's own corner slider starts when it still follows the collage.
 */
export function cornerShare(
  doc: CollageDoc,
  template: CollageTemplate,
  index: number,
  /** False: what the collage's own corner comes to on this photo. */
  useOwn = true,
): number {
  const own = doc.slots[index]?.radius;
  if (useOwn && own != null) return own;
  const f = frameOf(doc, 1000);
  const photo = cellLayouts(template, f, doc.style, doc.slots)[index]?.photo;
  if (!photo) return 0;
  return Math.min(0.5, (doc.style.radius * f.unit) / Math.min(photo.w, photo.h));
}

export function cellLayouts(
  template: CollageTemplate,
  f: Frame2D,
  style: CollageStyle,
  /** The photos, for any with a frame thickness of their own. */
  slots?: readonly (Slot | null)[],
): CellLayout[] {
  return cellRects(template, f, style).map((cell, i) => {
    // A photo made smaller keeps its cell's middle and shape.
    const k = slots?.[i]?.scale ?? style.scale ?? 1;
    const rect =
      k === 1
        ? cell
        : {
            x: cell.x + (cell.w * (1 - k)) / 2,
            y: cell.y + (cell.h * (1 - k)) / 2,
            w: cell.w * k,
            h: cell.h * k,
          };
    const inset = frameInsets(template.frame, rect, slots?.[i]?.frame ?? style.frame);
    const deg = template.cells[i]![4] ?? 0;
    return {
      rect,
      rotate: (deg * Math.PI) / 180,
      photo: {
        x: rect.x + inset.left,
        y: rect.y + inset.top,
        w: rect.w - inset.left - inset.right,
        h: rect.h - inset.top - inset.bottom,
      },
    };
  });
}

/** Rotates a canvas-space vector into a shape's own (unrotated) axes. */
export function toLocal(dx: number, dy: number, rotate: number) {
  const cos = Math.cos(rotate);
  const sin = Math.sin(rotate);
  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

/** Topmost cell under a point — cells drawn later sit on top when they overlap. */
export function hitCell(layouts: CellLayout[], x: number, y: number): number {
  for (let i = layouts.length - 1; i >= 0; i--) {
    const { rect, rotate } = layouts[i]!;
    const local = toLocal(x - (rect.x + rect.w / 2), y - (rect.y + rect.h / 2), rotate);
    if (Math.abs(local.x) <= rect.w / 2 && Math.abs(local.y) <= rect.h / 2) return i;
  }
  return -1;
}

/**
 * Where a slot's photo sits in its cell, at any rotation.
 *
 * The photo is scaled so that, turned by `slot.rotate`, it still covers the
 * whole cell: the cell's outline measured along the photo's own axes must fit
 * inside the photo. `overX`/`overY` are the spare length along those axes that
 * panning (`ox`/`oy`) moves through; `cx`/`cy` is the photo's center.
 */
export function photoPlacement(
  img: { width: number; height: number },
  photo: Rect,
  slot: Pick<Slot, 'zoom' | 'ox' | 'oy' | 'rotate'>,
) {
  const angle = (slot.rotate * Math.PI) / 180;
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  const needW = photo.w * c + photo.h * s;
  const needH = photo.w * s + photo.h * c;
  const scale = Math.max(needW / img.width, needH / img.height) * slot.zoom;
  const dw = img.width * scale;
  const dh = img.height * scale;
  const overX = dw - needW;
  const overY = dh - needH;
  // The pan offset lives along the photo's axes; turn it into canvas space.
  const u = (-slot.ox * overX) / 2;
  const v = (-slot.oy * overY) / 2;
  return {
    cx: photo.x + photo.w / 2 + u * Math.cos(angle) - v * Math.sin(angle),
    cy: photo.y + photo.h / 2 + u * Math.sin(angle) + v * Math.cos(angle),
    angle,
    dw,
    dh,
    overX,
    overY,
  };
}

/** Where the image lands inside its cell: covers the cell, scaled by zoom, panned by ox/oy. */
export function placeImage(
  img: { width: number; height: number },
  rect: Rect,
  slot: Pick<Slot, 'zoom' | 'ox' | 'oy'>,
) {
  const scale = Math.max(rect.w / img.width, rect.h / img.height) * slot.zoom;
  const dw = img.width * scale;
  const dh = img.height * scale;
  const overX = dw - rect.w;
  const overY = dh - rect.h;
  return {
    x: rect.x - (overX * (slot.ox + 1)) / 2,
    y: rect.y - (overY * (slot.oy + 1)) / 2,
    w: dw,
    h: dh,
    overX,
    overY,
  };
}

function roundedRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  const rad = Math.min(radius, r.w / 2, r.h / 2);
  ctx.beginPath();
  if (rad <= 0) {
    ctx.rect(r.x, r.y, r.w, r.h);
    return;
  }
  ctx.roundRect(r.x, r.y, r.w, r.h, rad);
}

/** Draws a slot's photo into `photo`, honoring zoom, pan, rotation and flip. */
/** The CSS filter for a photo's adjustments — also used for previews in the DOM. */
export function adjustFilter(a: PhotoAdjust | undefined): string {
  if (!a || !isAdjusted(a)) return '';
  const parts = [
    a.brightness && `brightness(${1 + a.brightness / 100})`,
    a.contrast && `contrast(${1 + a.contrast / 100})`,
    a.mono ? 'grayscale(1)' : a.saturation && `saturate(${1 + a.saturation / 100})`,
  ];
  return parts.filter(Boolean).join(' ');
}

/**
 * What is laid over a photo as it is shown, inside its clip: the vignette and
 * grain always; warmth and fade too when the photo was not developed (they are
 * part of develop) — the older look, a soft-light wash of orange or blue and a
 * light screen that lifts the blacks.
 */
export function drawAdjustOverlays(
  ctx: CanvasRenderingContext2D,
  photo: Rect,
  a: PhotoAdjust | undefined,
  /** The photo drawn is already developed (see `developed`). */
  isDeveloped = false,
) {
  if (!a) return;
  ctx.save();
  if (a.warmth && !a.mono && !isDeveloped) {
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.min(1, Math.abs(a.warmth) / 100) * 0.7;
    ctx.fillStyle = a.warmth > 0 ? '#ff9a3c' : '#3c8cff';
    ctx.fillRect(photo.x, photo.y, photo.w, photo.h);
  }
  if (a.fade && !isDeveloped) {
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = (a.fade / 100) * 0.35;
    ctx.fillStyle = '#6b6b6b';
    ctx.fillRect(photo.x, photo.y, photo.w, photo.h);
  }
  if (a.vignette?.amount) {
    const mask = vignetteMask(a.vignette, photo.w / Math.max(1, photo.h));
    if (mask) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(mask, photo.x, photo.y, photo.w, photo.h);
    }
  }
  // Grain last, over the vignette too, as on film. Its size follows the photo
  // as shown, so a small preview and the full-size download match.
  const grain = a.grain ? noisePattern(ctx, a.grainRough ?? 50) : null;
  if (grain) {
    const size = 0.5 + ((a.grainSize ?? 25) / 100) * 3;
    const k = (Math.max(photo.w, photo.h) / 1200) * size;
    grain.setTransform(new DOMMatrix([k, 0, 0, k, photo.x, photo.y]));
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = Math.min(1, a.grain! / 100) * 0.55;
    ctx.fillStyle = grain;
    ctx.fillRect(photo.x, photo.y, photo.w, photo.h);
  }
  ctx.restore();
}

/** Vignettes, by their settings and the photo's shape — a small picture stretched over the photo. */
const vignettes = new Map<string, HTMLCanvasElement>();
/**
 * The vignette as a see-through picture: black (or white) growing towards the
 * edges, from `midpoint` in, round or square by `roundness`, soft by `feather`.
 */
function vignetteMask(v: NonNullable<PhotoAdjust['vignette']>, aspect: number) {
  if (typeof document === 'undefined') return null;
  const W = 256;
  const H = Math.max(8, Math.min(1024, Math.round(W / Math.max(0.25, aspect))));
  const key = `${JSON.stringify(v)}|${W}x${H}`;
  const hit = vignettes.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(W, H);
  const amount = Math.max(-1, Math.min(1, v.amount / 100));
  const mid = (v.midpoint ?? 50) / 100;
  const round = (v.roundness ?? 0) / 100;
  const feather = 0.05 + ((v.feather ?? 50) / 100) * 0.9;
  // Round: the same distance in both directions measured on the longer side.
  const ax = aspect >= 1 ? 1 + round * (aspect - 1) : 1;
  const ay = aspect < 1 ? 1 + round * (1 / aspect - 1) : 1;
  // Square: a higher power flattens the ellipse towards a rectangle.
  const pow = round < 0 ? 2 + -round * 6 : 2;
  const start = 0.15 + mid * 0.85;
  const color = amount < 0 ? 0 : 255;
  for (let y = 0; y < H; y++) {
    const dy = (Math.abs((y + 0.5) / H - 0.5) * 2) / ay;
    for (let x = 0; x < W; x++) {
      const dx = (Math.abs((x + 0.5) / W - 0.5) * 2) / ax;
      const d = Math.pow(Math.pow(dx, pow) + Math.pow(dy, pow), 1 / pow);
      const t = Math.min(
        1,
        Math.max(0, (d - start * (1 - feather * 0.5)) / Math.max(0.05, feather)),
      );
      const i = (y * W + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = color;
      img.data[i + 3] = Math.round(t * t * (3 - 2 * t) * Math.abs(amount) * 230);
    }
  }
  ctx.putImageData(img, 0, 0);
  vignettes.set(key, c);
  if (vignettes.size > 12) vignettes.delete(vignettes.keys().next().value!);
  return c;
}

const noiseTiles = new Map<number, HTMLCanvasElement>();
/**
 * Grey film grain, one small tile repeated. `rough` 0–100: smooth, even grain
 * to coarse and clumpy (fine noise mixed with larger blotches).
 */
function noisePattern(ctx: CanvasRenderingContext2D, rough = 50): CanvasPattern | null {
  if (typeof document === 'undefined') return null;
  const bucket = Math.round(rough / 25);
  let tile = noiseTiles.get(bucket);
  if (!tile) {
    tile = document.createElement('canvas');
    tile.width = tile.height = 192;
    const c = tile.getContext('2d');
    if (!c) return null;
    const img = c.createImageData(192, 192);
    // Coarse blotches: noise at a quarter of the size, looked up per pixel.
    const coarse = new Float32Array(48 * 48).map(() => Math.random() + Math.random() - 1);
    const mix = bucket / 4;
    for (let i = 0; i < img.data.length; i += 4) {
      const p = i / 4;
      const x = p % 192;
      const y = Math.floor(p / 192);
      const fine = Math.random() + Math.random() - 1;
      const blob = coarse[Math.floor(y / 4) * 48 + Math.floor(x / 4)]!;
      const v = 128 + (fine * (1 - mix * 0.6) + blob * mix * 0.8) * 110;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    noiseTiles.set(bucket, tile);
  }
  return ctx.createPattern(tile, 'repeat');
}

/** A drop shadow as the canvas takes it, in canvas pixels for a slide `unit` wide. */
function applyShadow(ctx: CanvasRenderingContext2D, s: DropShadow | undefined, unit: number) {
  if (!s || s.alpha <= 0) return false;
  ctx.shadowColor = withAlpha(s.color, s.alpha);
  ctx.shadowBlur = s.blur * unit;
  ctx.shadowOffsetX = s.x * unit;
  ctx.shadowOffsetY = s.y * unit;
  return true;
}

/** Outlined cut-outs, by picture, size and line — made once, drawn every frame. */
const outlinedImages = new Map<string, HTMLCanvasElement>();
/**
 * A picture with a line round its own outline — a cut-out person with a white
 * edge — on a canvas `pad` bigger all round: the picture's shape, grown by
 * the line's width and filled with its color, under the picture itself.
 */
/** Picture elements as drawn — cropped, colored, faded, shaped — at their drawn size, kept a while. */
const processedImages = new Map<string, HTMLCanvasElement>();

/** What turns a picture element into what is drawn; nothing set, the picture as it is. */
function imageLook(layer: StickerLayer) {
  const shown = shownAdjust(layer.adjust);
  const adjust = shown && isAdjusted(shown) ? shown : undefined;
  const look = {
    adjust,
    fade: layer.fade,
    crop: layer.crop,
    mask: layer.mask,
    corner: layer.mask ? undefined : layer.corner || undefined,
  };
  return adjust || look.fade || look.crop || look.mask || look.corner ? look : null;
}

/**
 * A picture element with its looks — the part shown (crop), its Warna (the
 * same as a photo's: colors, warmth, fade, grain, blur), Pudar, and a shape
 * or rounded corners — baked into one picture at the size it is drawn, kept
 * to the picture's own outline: a cut-out stays a cut-out, and its line and
 * shadow follow whatever shape it ends up.
 */
function processedImage(
  img: HTMLImageElement,
  key: string,
  w: number,
  h: number,
  look: NonNullable<ReturnType<typeof imageLook>>,
  blurPx: number,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const pw = Math.max(1, Math.round(w));
  const ph = Math.max(1, Math.round(h));
  const id = `${key}|${pw}x${ph}|${JSON.stringify(look)}|${blurPx.toFixed(1)}`;
  const hit = processedImages.get(id);
  if (hit) return hit;
  const canvas = (cw: number, ch: number) => {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    return c;
  };
  // The part shown, at the drawn size.
  const part = canvas(pw, ph);
  const pc = part.getContext('2d');
  if (!pc) return null;
  pc.imageSmoothingQuality = 'high';
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const crop = look.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  pc.drawImage(img, crop.x * iw, crop.y * ih, crop.w * iw, crop.h * ih, 0, 0, pw, ph);
  const out = canvas(pw, ph);
  const c = out.getContext('2d');
  if (!c) return null;
  const a = look.adjust;
  if (a) {
    const dev = developed(part, a);
    const colors = dev ? '' : adjustFilter(a);
    const filter = [colors, blurPx > 0 ? `blur(${blurPx}px)` : ''].filter(Boolean).join(' ');
    let source: Drawable = dev ?? part;
    if (filter && canvasFilterSupported()) c.filter = filter;
    else {
      // Safari: worked out on the picture itself.
      if (colors) source = colorFiltered(source, colors);
      if (blurPx > 0) source = blurredCopy(source, pw, ph, blurPx);
    }
    c.drawImage(source, 0, 0, pw, ph);
    c.filter = 'none';
    drawAdjustOverlays(c, { x: 0, y: 0, w: pw, h: ph }, a, Boolean(dev));
    // The washes cover the box: back to the picture's own outline.
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(part, 0, 0);
    c.globalCompositeOperation = 'source-over';
  } else {
    c.drawImage(part, 0, 0);
  }
  if (look.fade) {
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = gradientFill(c, fadeMask(look.fade), pw, ph, 0, 0);
    c.fillRect(0, 0, pw, ph);
  }
  if (look.mask || look.corner) {
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = '#000';
    if (look.mask) tracePhotoMask(c, look.mask, { x: 0, y: 0, w: pw, h: ph });
    else roundedRect(c, { x: 0, y: 0, w: pw, h: ph }, look.corner! * Math.min(pw, ph));
    c.fill();
  }
  processedImages.set(id, out);
  if (processedImages.size > 16) processedImages.delete(processedImages.keys().next().value!);
  return out;
}

function outlinedImage(
  img: Drawable,
  key: string,
  w: number,
  h: number,
  line: number,
  color: string,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const pw = Math.max(1, Math.round(w));
  const ph = Math.max(1, Math.round(h));
  const lw = Math.max(1, Math.round(line));
  const id = `${key}|${pw}x${ph}|${lw}|${color}`;
  const hit = outlinedImages.get(id);
  if (hit) return hit;
  const out = document.createElement('canvas');
  out.width = pw + lw * 2;
  out.height = ph + lw * 2;
  const c = out.getContext('2d');
  if (!c) return null;
  // The shape, stamped round a circle of the line's width…
  const steps = Math.max(16, Math.min(48, lw * 2));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    c.drawImage(img, lw + Math.cos(a) * lw, lw + Math.sin(a) * lw, pw, ph);
  }
  // …in the line's color, then the picture on top.
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = color;
  c.fillRect(0, 0, out.width, out.height);
  c.globalCompositeOperation = 'source-over';
  c.drawImage(img, lw, lw, pw, ph);
  outlinedImages.set(id, out);
  if (outlinedImages.size > 16) outlinedImages.delete(outlinedImages.keys().next().value!);
  return out;
}

/**
 * The longest side, in the canvas's own pixels, a photo is drawn at — what it
 * needs developing at, no more: on screen that is far below the photo's size.
 * Rounded up to 256 px, so small changes (a drag, a zoom step) reuse a result;
 * never above `cap` (a preview while a slider moves).
 */
function drawnSide(
  ctx: CanvasRenderingContext2D,
  img: Drawable,
  photo: Rect,
  slot: Slot,
  cap = Infinity,
) {
  const m = ctx.getTransform();
  const scale = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)) || 1;
  const p = photoPlacement(img, photo, slot);
  const side = Math.ceil((Math.max(p.dw, p.dh) * scale) / 256) * 256;
  return Math.min(cap, Math.max(256, side));
}

function drawSlotImage(ctx: CanvasRenderingContext2D, img: Drawable, photo: Rect, slot: Slot) {
  const p = photoPlacement(img, photo, slot);
  ctx.save();
  ctx.translate(p.cx, p.cy);
  ctx.rotate(p.angle);
  if (slot.flip) ctx.scale(-1, 1);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, -p.dw / 2, -p.dh / 2, p.dw, p.dh);
  ctx.restore();
}

// ── Text ──

const LINE_HEIGHT = 1.15;

let measurer: CanvasRenderingContext2D | null = null;
/**
 * An offscreen context just for measuring text — layout math that needs it
 * (hit-testing, handles) should not have to reach for the visible canvas.
 */
export function measureContext(): CanvasRenderingContext2D | null {
  if (!measurer && typeof document !== 'undefined') {
    measurer = document.createElement('canvas').getContext('2d');
  }
  return measurer;
}

function applyTextStyle(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  px: number,
  families: FontFamilies,
) {
  ctx.font = fontString(layer.font, px, families, layer.weight, layer.italic);
  ctx.textBaseline = 'middle';
  // Wide tracking is what makes caps read as a title rather than shouting.
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px * layer.spacing}px`;
}

/** Breaks a paragraph into lines no wider than `maxW`; a single long word keeps its line. */
function wrap(ctx: CanvasRenderingContext2D, paragraph: string, maxW: number): string[] {
  const words = paragraph.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxW) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * Lines of a text layer and its box size, in canvas pixels. With a set width
 * the lines wrap to it; without, the box hugs the longest line.
 */
function layoutText(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  f: Frame2D,
  families: FontFamilies,
) {
  const px = layer.size * f.unit;
  const raw = applyCase(layer.text, layer.textCase);
  ctx.save();
  applyTextStyle(ctx, layer, px, families);
  const boxW = layer.width ? layer.width * f.unit : null;
  const lines = raw.split('\n').flatMap((p) => (boxW ? wrap(ctx, p, boxW) : [p]));
  const longest = Math.max(px * 0.6, ...lines.map((l) => ctx.measureText(l || ' ').width));
  ctx.restore();
  const lh = px * (layer.lineHeight ?? LINE_HEIGHT);
  // A curve: the longest line spans an arc of up to half a circle; the block
  // grows by how far its ends drop (or rise) below its middle.
  const bend = Math.abs(layer.curve ?? 0);
  const radius = bend > 0.01 ? longest / (bend * Math.PI) : 0;
  const sag = radius ? radius * (1 - Math.cos((bend * Math.PI) / 2)) : 0;
  return { px, lh, lines, w: boxW ?? longest, h: lines.length * lh + sag, sag, radius };
}

/** Unrotated bounding box of a text layer, in canvas pixels. */
export function textBox(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  f: Frame2D,
  families: FontFamilies,
): Rect {
  const { w, h } = layoutText(ctx, layer, f, families);
  return { x: layer.x * f.width - w / 2, y: layer.y * f.height - h / 2, w, h };
}

function drawText(
  ctx: CanvasRenderingContext2D,
  layer: TextLayer,
  f: Frame2D,
  families: FontFamilies,
) {
  const { px, lh, lines, w, h, sag, radius } = layoutText(ctx, layer, f, families);
  const cx = layer.x * f.width;
  const cy = layer.y * f.height;
  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 1;
  // Tilted around its middle; the shadow still falls straight down (it is not turned).
  if (layer.rotate) {
    ctx.translate(cx, cy);
    ctx.rotate((layer.rotate * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  applyTextStyle(ctx, layer, px, families);

  // The box behind the text first, and without the letters' shadow.
  const bg = layer.background;
  if (bg && bg.opacity > 0) {
    const pad = bg.padding * px;
    const box = { x: cx - w / 2 - pad, y: cy - h / 2 - pad, w: w + pad * 2, h: h + pad * 2 };
    ctx.save();
    ctx.globalAlpha *= bg.opacity;
    ctx.fillStyle = bg.color;
    roundedRect(ctx, box, box.h * bg.radius);
    ctx.fill();
    ctx.restore();
  }

  // A gradient runs across the whole text box, whatever each letter does (see `put`).
  const base = ctx.getTransform();
  const fillPattern = layer.fill
    ? gradientPattern(ctx, layer.fill, w, h, cx - w / 2, cy - h / 2)
    : null;
  ctx.fillStyle = fillPattern ? fillPattern.fill : layer.color;
  ctx.textAlign = layer.align;
  if (layer.shadow.on) {
    ctx.shadowColor = withAlpha(layer.shadow.color, layer.shadow.opacity);
    ctx.shadowBlur = px * layer.shadow.blur;
    ctx.shadowOffsetY = px * layer.shadow.distance;
  }
  // The outline goes under the fill, so the letters keep their own weight;
  // the shadow falls once, from the outline.
  const ow = layer.outline && layer.outline.width > 0 ? layer.outline.width * px * 2 : 0;
  const paint = (draw: (mode: 'stroke' | 'fill') => void) => {
    if (ow) {
      ctx.lineWidth = ow;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = layer.outline!.color;
      draw('stroke');
      ctx.shadowColor = 'transparent';
    }
    draw('fill');
  };
  const put = (mode: 'stroke' | 'fill', text: string, x: number, y: number) => {
    if (mode === 'fill' && fillPattern?.matrix && fillPattern.fill instanceof CanvasPattern) {
      // A letter turned on its own (curved text) keeps its place in the one gradient.
      fillPattern.fill.setTransform(
        ctx.getTransform().inverse().multiply(base).multiply(fillPattern.matrix),
      );
    }
    if (mode === 'fill') ctx.fillText(text, x, y);
    else ctx.strokeText(text, x, y);
  };
  const top = cy - ((lines.length - 1) * lh) / 2;

  if (radius) {
    // Letter by letter round an arc: an arch has its middle up and its centre
    // below; a smile the other way. Each line bends by the same amount on an
    // arc of its own, stacked like straight lines — parallel, never crowded.
    const bend = Math.abs(layer.curve ?? 0) * Math.PI;
    const arch = (layer.curve ?? 0) > 0;
    ctx.textAlign = 'center';
    paint((mode) =>
      lines.forEach((line, i) => {
        const chars = [...line];
        const widths = chars.map((c) => ctx.measureText(c).width);
        const total = widths.reduce((a, b) => a + b, 0);
        if (!total) return;
        const r = total / bend;
        const lineY = top + i * lh + (arch ? -sag / 2 : sag / 2);
        const oy = arch ? lineY + r : lineY - r;
        let run = 0;
        chars.forEach((c, k) => {
          const mid = run + widths[k]! / 2 - total / 2;
          run += widths[k]!;
          const a = arch ? -Math.PI / 2 + mid / r : Math.PI / 2 - mid / r;
          ctx.save();
          ctx.translate(cx + Math.cos(a) * r, oy + Math.sin(a) * r);
          ctx.rotate(arch ? a + Math.PI / 2 : a - Math.PI / 2);
          put(mode, c, 0, 0);
          ctx.restore();
        });
      }),
    );
    ctx.restore();
    return;
  }
  // Lines line up inside the box; the box itself is centered on (x, y).
  // Canvas letter spacing also trails the last letter, which would pull
  // centered and right-aligned lines off by that much — shift them back.
  const trail = px * layer.spacing;
  const x =
    layer.align === 'left'
      ? cx - w / 2
      : layer.align === 'right'
        ? cx + w / 2 + trail
        : cx + trail / 2;
  paint((mode) => lines.forEach((line, i) => put(mode, line, x, top + i * lh)));
  ctx.restore();
}

// ── Stickers ──

/** Center, size and rotation of a sticker, in canvas pixels. */
export function stickerBox(layer: StickerLayer, f: Frame2D) {
  const w = layer.size * f.unit;
  const shape = isShape(layer.sticker) ? shapeById(layer.sticker) : undefined;
  // A line's box is just its thickness; everything else keeps its proportions.
  const h =
    shape?.kind === 'line'
      ? lineWidthOf(layer) * f.unit
      : w * (layer.ratio ?? shape?.ratio ?? stickerById(layer.sticker)?.ratio ?? 1);
  return {
    cx: layer.x * f.width,
    cy: layer.y * f.height,
    w,
    h,
    rotate: (layer.rotate * Math.PI) / 180,
  };
}

/**
 * An empty background place: grey with a dashed edge and its name in the
 * editor, so it reads as "a picture goes here"; nothing in the download.
 * Also marks an uploaded image that is gone from this browser.
 */
function drawPlaceholder(
  ctx: CanvasRenderingContext2D,
  layer: StickerLayer,
  f: Frame2D,
  /** Said on it — a background place, a missing picture; an empty picture place says nothing. */
  label?: string,
) {
  const box = stickerBox(layer, f);
  const { w, h } = box;
  ctx.save();
  ctx.translate(box.cx, box.cy);
  ctx.rotate(box.rotate);
  // Grey like an empty photo place; the label says which kind it is.
  ctx.fillStyle = '#d8ded9';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  // A dashed edge, so it still shows over an empty photo place of the same grey.
  const line = Math.max(1, f.unit * 0.003);
  ctx.strokeStyle = '#8a988f';
  ctx.lineWidth = line;
  ctx.setLineDash([line * 4, line * 3]);
  ctx.strokeRect(-w / 2 + line / 2, -h / 2 + line / 2, w - line, h - line);
  ctx.setLineDash([]);
  if (!label) {
    ctx.restore();
    return;
  }
  // Near the bottom edge, where photos on top leave it showing most often.
  const size = Math.round(Math.max(8, f.unit * 0.035));
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const tw = ctx.measureText(label).width + size;
  const ty = h / 2 - size * 0.8;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.beginPath();
  ctx.roundRect(-tw / 2, ty - size * 1.25, tw, size * 1.5, size * 0.75);
  ctx.fill();
  ctx.fillStyle = '#56645c';
  ctx.fillText(label, 0, ty);
  ctx.restore();
}

/** Words cut to fit a width, with an ellipsis. */
function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * Editor only: why a picture is not showing — a short heading and a line or
 * two under it, centered in `area` and shrunk to fit.
 */
function drawMissingNote(
  ctx: CanvasRenderingContext2D,
  area: Rect,
  lines: [heading: string, ...detail: string[]],
  unit: number,
) {
  const size = Math.max(7, Math.min(unit * 0.034, area.w * 0.09, area.h * 0.12));
  const lineH = size * 1.35;
  const maxW = area.w * 0.86;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const top = area.y + area.h / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => {
    const px = Math.round(i === 0 ? size * 1.1 : size * 0.9);
    ctx.font = `${i === 0 ? 700 : 500} ${px}px ui-sans-serif, system-ui, sans-serif`;
    ctx.fillStyle = i === 0 ? '#b45309' : '#56645c';
    ctx.fillText(fitText(ctx, line, maxW), area.x + area.w / 2, top + i * lineH);
  });
  ctx.restore();
}

/** Editor only: a background image that is gone, said as a pill near the bottom. */
function drawMissingBackdrop(ctx: CanvasRenderingContext2D, area: Rect, unit: number) {
  const size = Math.round(Math.max(8, unit * 0.03));
  ctx.save();
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = fitText(ctx, 'Gambar latar hilang — pilih ulang di panel Latar', area.w * 0.9);
  const tw = ctx.measureText(label).width + size * 1.4;
  const cy = area.y + area.h - size * 2;
  ctx.fillStyle = 'rgba(255, 251, 235, 0.95)';
  ctx.beginPath();
  ctx.roundRect(area.x + area.w / 2 - tw / 2, cy - size * 0.85, tw, size * 1.7, size * 0.85);
  ctx.fill();
  ctx.fillStyle = '#b45309';
  ctx.fillText(label, area.x + area.w / 2, cy);
  ctx.restore();
}

/**
 * The canvas gradient for `g` over a box `pw` × `ph` (its top-left at 0, 0):
 * a line (linear, reflected — mirrored out from its middle), a radial one
 * from its center (a circle, or stretched to an ellipse), or a sweep (conic).
 * Stops come from `gradientStops`, eased and premultiplied.
 */
function makeGradient(c: CanvasRenderingContext2D, g: Gradient, pw: number, ph: number) {
  const stops = gradientStops(g);
  const put = (grad: CanvasGradient, map: (at: number) => number = (at) => at) => {
    for (const st of stops) grad.addColorStop(Math.min(1, Math.max(0, map(st.at))), stopCss(st));
    return grad;
  };
  const cx = (g.cx ?? 0.5) * pw;
  const cy = (g.cy ?? 0.5) * ph;
  if (g.type === 'radial') {
    // Reaching the corners at `radius` 1; an ellipse keeps the box's own shape.
    const reach = g.radius ?? 1;
    if (g.ellipse) {
      const rx = (reach * pw) / Math.SQRT2;
      const ry = (reach * ph) / Math.SQRT2;
      c.translate(cx, cy);
      c.scale(1, ry / Math.max(rx, 1e-6));
      c.translate(-cx, -cy);
      return put(c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, 1e-6)));
    }
    return put(
      c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1e-6, (reach * Math.hypot(pw, ph)) / 2)),
    );
  }
  if (g.type === 'conic' && 'createConicGradient' in c) {
    // 0° starts at the top, as on a clock.
    return put(c.createConicGradient(((g.angle - 90) * Math.PI) / 180, cx, cy));
  }
  // A line: set on the canvas, or across the whole box at `angle`.
  let x0: number, y0: number, x1: number, y1: number;
  if (g.line) {
    [x0, y0, x1, y1] = [g.line.x0 * pw, g.line.y0 * ph, g.line.x1 * pw, g.line.y1 * ph];
  } else {
    const a = (g.angle * Math.PI) / 180;
    const vx = Math.sin(a);
    const vy = Math.cos(a);
    const half = Math.abs((vx * pw) / 2) + Math.abs((vy * ph) / 2);
    [x0, y0, x1, y1] = [
      pw / 2 - vx * half,
      ph / 2 - vy * half,
      pw / 2 + vx * half,
      ph / 2 + vy * half,
    ];
  }
  if (g.type === 'reflected') {
    // From the middle of the line out to both ends: the first color in the middle.
    const [mx, my] = g.line ? [x0, y0] : [(x0 + x1) / 2, (y0 + y1) / 2];
    const [ex, ey] = [x1, y1];
    const grad = c.createLinearGradient(2 * mx - ex, 2 * my - ey, ex, ey);
    for (const st of stops) {
      grad.addColorStop(0.5 + st.at / 2, stopCss(st));
      grad.addColorStop(0.5 - st.at / 2, stopCss(st));
    }
    return grad;
  }
  return put(c.createLinearGradient(x0, y0, x1, y1));
}

/** Painted gradients, by what they look like and their size in pixels — slider drags reuse them. */
const gradientTiles = new Map<string, HTMLCanvasElement>();
const GRADIENT_TILE_MAX = 2048;

/**
 * A gradient painted once into its own small canvas, then a faint dither
 * (±1 level) so a long dark fade shows no bands — on screen or in a JPG — the
 * way Photoshop's does; and, if asked, film grain on top.
 */
function paintGradient(g: Gradient, pw: number, ph: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const tile = document.createElement('canvas');
  tile.width = pw;
  tile.height = ph;
  const c = tile.getContext('2d');
  if (!c) return null;
  c.save();
  c.fillStyle = makeGradient(c, g, pw, ph);
  // Filled through whatever stretch an ellipse set, back to the tile's own pixels.
  const m = c.getTransform().inverse();
  const corners = [
    new DOMPoint(0, 0).matrixTransform(m),
    new DOMPoint(pw, ph).matrixTransform(m),
    new DOMPoint(pw, 0).matrixTransform(m),
    new DOMPoint(0, ph).matrixTransform(m),
  ];
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  c.fillRect(
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
  c.restore();
  const img = c.getImageData(0, 0, pw, ph);
  const px = img.data;
  const grain = Math.min(1, Math.max(0, g.grain ?? 0)) * 42;
  for (let i = 0; i < px.length; i += 4) {
    // Triangular noise, about one level either way: enough to break bands, never seen.
    const n = Math.random() + Math.random() - 1 + (grain ? (Math.random() - 0.5) * 2 * grain : 0);
    px[i] = px[i]! + n;
    px[i + 1] = px[i + 1]! + n;
    px[i + 2] = px[i + 2]! + n;
    if (px[i + 3]! > 0 && px[i + 3]! < 255)
      px[i + 3] = px[i + 3]! + (Math.random() + Math.random() - 1);
  }
  c.putImageData(img, 0, 0);
  return tile;
}

/**
 * A gradient as a fill for a box `w` × `h` whose top-left corner is at
 * (`ox`, `oy`) in the context's current axes — by default a box centered on
 * the origin, as a shape is drawn. Painted at the size it shows at, as a pattern.
 */
export function gradientFill(
  ctx: CanvasRenderingContext2D,
  g: Gradient,
  w: number,
  h: number,
  ox = -w / 2,
  oy = -h / 2,
): CanvasPattern | CanvasGradient {
  return gradientPattern(ctx, g, w, h, ox, oy).fill;
}

/** `gradientFill`, with the pattern's own placement — to keep it put when the axes turn. */
function gradientPattern(
  ctx: CanvasRenderingContext2D,
  g: Gradient,
  w: number,
  h: number,
  ox = -w / 2,
  oy = -h / 2,
): { fill: CanvasPattern | CanvasGradient; matrix: DOMMatrix | null } {
  const m = ctx.getTransform();
  const scale = Math.max(0.05, Math.hypot(m.a, m.b));
  const fit = Math.min(1, GRADIENT_TILE_MAX / Math.max(w * scale, h * scale, 1));
  const pw = Math.max(1, Math.round(w * scale * fit));
  const ph = Math.max(1, Math.round(h * scale * fit));
  const key = `${JSON.stringify(g)}|${pw}x${ph}`;
  let tile = gradientTiles.get(key) ?? null;
  if (!tile) {
    tile = paintGradient(g, pw, ph);
    if (tile) {
      gradientTiles.set(key, tile);
      // Only the latest few: each is a canvas of its own.
      if (gradientTiles.size > 32) gradientTiles.delete(gradientTiles.keys().next().value!);
    }
  }
  const pattern = tile ? ctx.createPattern(tile, 'no-repeat') : null;
  if (pattern) {
    const matrix = new DOMMatrix().translate(ox, oy).scale(w / pw, h / ph);
    pattern.setTransform(matrix);
    return { fill: pattern, matrix };
  }
  // No canvas to paint into: the gradient itself, moved onto the box.
  ctx.save();
  ctx.translate(ox, oy);
  const grad = makeGradient(ctx, g, w, h);
  ctx.restore();
  return { fill: grad, matrix: null };
}

function drawSticker(
  ctx: CanvasRenderingContext2D,
  layer: StickerLayer,
  f: Frame2D,
  images: Map<string, HTMLImageElement>,
) {
  const box = stickerBox(layer, f);
  const opacity = layer.opacity ?? 1;
  ctx.save();
  ctx.translate(box.cx, box.cy);
  ctx.rotate(box.rotate);
  if (layer.flip) ctx.scale(-1, 1);
  ctx.globalAlpha = opacity;
  // Mixed with everything already drawn under it — photos, background, other layers.
  if (layer.blend) ctx.globalCompositeOperation = layer.blend;
  applyShadow(ctx, layer.shadow, f.unit);

  if (isImageSticker(layer.sticker)) {
    const img = images.get(layer.sticker);
    if (img) {
      ctx.imageSmoothingQuality = 'high';
      const ol = layer.imageOutline;
      const scale = Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || 1;
      const look = imageLook(layer);
      const processed = look
        ? processedImage(
            img,
            layer.sticker,
            box.w * scale,
            box.h * scale,
            look,
            ((look.adjust?.blur ?? 0) / 100) * f.unit * 0.04 * scale,
          )
        : null;
      const base: Drawable = processed ?? img;
      const outlined =
        ol && ol.width > 0
          ? outlinedImage(
              base,
              processed ? `${layer.sticker}|${JSON.stringify(look)}` : layer.sticker,
              box.w * scale,
              box.h * scale,
              ol.width * f.unit * scale,
              ol.color,
            )
          : null;
      if (outlined) {
        const pad = (outlined.width / scale - box.w) / 2;
        ctx.drawImage(
          outlined,
          -box.w / 2 - pad,
          -box.h / 2 - pad,
          box.w + pad * 2,
          box.h + pad * 2,
        );
      } else {
        ctx.drawImage(base, -box.w / 2, -box.h / 2, box.w, box.h);
      }
    }
    ctx.restore();
    return;
  }

  const shape = isShape(layer.sticker) ? shapeById(layer.sticker) : undefined;
  if (shape) {
    const lw = lineWidthOf(layer) * f.unit;
    traceShape(ctx, shape, layer, box.w, box.h, lw);
    if (shape.kind === 'line' || layer.outline) {
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = lw;
      ctx.lineCap = shape.dash === 'dot' || shape.kind === 'line' ? 'round' : 'butt';
      ctx.lineJoin = 'round';
      // Round caps make zero-length dashes into dots.
      ctx.setLineDash(
        shape.dash === 'dot' ? [0, lw * 2.2] : shape.dash === 'dash' ? [lw * 3, lw * 2.5] : [],
      );
      ctx.stroke();
    } else {
      ctx.fillStyle = layer.gradient
        ? gradientFill(ctx, layer.gradient, box.w, box.h)
        : layer.color;
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  const def = stickerById(layer.sticker);
  if (!def) {
    ctx.restore();
    return;
  }
  const scale = box.w / 100;
  ctx.scale(scale, scale);
  ctx.translate(-50, -50 * def.ratio);
  for (const part of def.parts) {
    const path = new Path2D(part.d);
    ctx.globalAlpha = opacity * (part.opacity ?? 1);
    if (part.mode === 'fill') {
      ctx.fillStyle = layer.color;
      ctx.fill(path, part.rule ?? 'nonzero');
    } else {
      ctx.strokeStyle = layer.color;
      ctx.lineWidth = part.width ?? 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash(part.dash ?? []);
      ctx.stroke(path);
    }
  }
  ctx.restore();
}

// ── Watermark ──

const WATERMARK_MARGIN = 0.04;
/** An image mark is drawn this many times the text size tall. */
const WATERMARK_IMAGE_SCALE = 2.6;

function watermarkText(wm: Watermark, studioName: string) {
  return wm.text.trim() || studioName;
}

/**
 * Where the watermark sits, in canvas pixels: at a preset corner, or — once
 * dragged — centered on its custom point.
 */
export function watermarkBox(
  wm: Watermark,
  f: Frame2D,
  studioName: string,
  image: HTMLImageElement | null,
  families: FontFamilies,
): Rect | null {
  const px = wm.size * f.unit;
  let w: number;
  let h: number;
  if (wm.kind === 'gambar') {
    if (!image) return null;
    h = px * WATERMARK_IMAGE_SCALE;
    w = (h * image.width) / image.height;
  } else {
    const ctx = measureContext();
    if (!ctx) return null;
    ctx.save();
    ctx.font = fontString('sans', px, families, 500);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${px * 0.04}px`;
    w = ctx.measureText(watermarkText(wm, studioName)).width;
    ctx.restore();
    h = px * LINE_HEIGHT;
  }

  if (wm.custom) {
    return { x: wm.custom.x * f.width - w / 2, y: wm.custom.y * f.height - h / 2, w, h };
  }
  const margin = WATERMARK_MARGIN * f.unit;
  const [hPos, vPos] = {
    'kiri-atas': ['kiri', 'atas'],
    'kanan-atas': ['kanan', 'atas'],
    'kiri-bawah': ['kiri', 'bawah'],
    'tengah-bawah': ['tengah', 'bawah'],
    'kanan-bawah': ['kanan', 'bawah'],
  }[wm.position];
  return {
    x: hPos === 'kiri' ? margin : hPos === 'kanan' ? f.width - margin - w : (f.width - w) / 2,
    y: vPos === 'atas' ? margin : f.height - margin - h,
    w,
    h,
  };
}

function drawWatermark(
  ctx: CanvasRenderingContext2D,
  wm: Watermark,
  f: Frame2D,
  studioName: string,
  image: HTMLImageElement | null,
  families: FontFamilies,
) {
  const box = watermarkBox(wm, f, studioName, image, families);
  if (!box) return;
  const px = wm.size * f.unit;
  ctx.save();
  ctx.globalAlpha = wm.opacity;
  if (wm.kind === 'gambar' && image) {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, box.x, box.y, box.w, box.h);
  } else {
    // A faint shadow keeps a light mark legible on a light patch of photo.
    ctx.shadowColor = wm.tone === 'terang' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';
    ctx.shadowBlur = px * 0.4;
    ctx.font = fontString('sans', px, families, 500);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${px * 0.04}px`;
    ctx.fillStyle = wm.tone === 'terang' ? '#ffffff' : '#1c1c1c';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(watermarkText(wm, studioName), box.x, box.y + box.h / 2);
  }
  ctx.restore();
}

// ── Background ──

/**
 * Fills `area` with a color, then an optional image covering it (filtered,
 * blurred, tinted). Used once for the whole canvas, or once per carousel slide.
 */
/**
 * Where a background image sits in its area — the canvas, or one carousel
 * slide — placed like a photo in a cell so it covers the area at any tilt.
 */
export function backdropPlacement(
  image: { width: number; height: number },
  area: Rect,
  bg: BackdropStyle,
  unit: number,
) {
  // Blur pulls transparent pixels in from outside the image, which leaves a
  // pale fringe; placing it over a slightly larger area keeps edges solid.
  const grow = bg.blur * unit * 2;
  return photoPlacement(
    image,
    { x: area.x - grow, y: area.y - grow, w: area.w + 2 * grow, h: area.h + 2 * grow },
    { zoom: bg.zoom ?? 1, ox: bg.ox ?? 0, oy: bg.oy ?? 0, rotate: bg.rotate ?? 0 },
  );
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  area: Rect,
  bg: SlideBackground,
  image: HTMLImageElement | null,
  unit: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();
  ctx.fillStyle = bg.color;
  ctx.fillRect(area.x, area.y, area.w, area.h);
  if (bg.gradient) {
    ctx.fillStyle = gradientFill(ctx, bg.gradient, area.w, area.h, area.x, area.y);
    ctx.fillRect(area.x, area.y, area.w, area.h);
    ctx.fillStyle = bg.color;
  }
  if (image) {
    const blurPx = bg.blur * unit;
    const p = backdropPlacement(image, area, bg, unit);
    let source: Drawable = image;
    ctx.save();
    if (canvasFilterSupported()) {
      const filter = [bg.filter, blurPx > 0 ? `blur(${blurPx}px)` : ''].filter(Boolean).join(' ');
      if (filter) ctx.filter = filter;
    } else {
      // Safari: the same look, worked out on the image itself.
      if (bg.filter) source = colorFiltered(source, bg.filter);
      if (blurPx > 0) source = blurredCopy(source, p.dw, p.dh, blurPx);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(p.cx, p.cy);
    ctx.rotate(p.angle);
    if (bg.flip) ctx.scale(-1, 1);
    ctx.drawImage(source, -p.dw / 2, -p.dh / 2, p.dw, p.dh);
    ctx.restore();
    if (bg.tint > 0) {
      ctx.globalAlpha = bg.tint;
      ctx.fillRect(area.x, area.y, area.w, area.h);
    }
  }
  ctx.restore();
}

// ── Whole collage ──

export type Selection =
  | { kind: 'cell'; index: number }
  | { kind: 'text'; id: string }
  | { kind: 'sticker'; id: string }
  | { kind: 'watermark' }
  | null;

export interface DrawAssets {
  images: Map<string, HTMLImageElement>;
  backdrop: HTMLImageElement | null;
  /** Per-slide background images, when a carousel sets backgrounds per slide. */
  slideBackdrops: (HTMLImageElement | null)[];
  /** The uploaded watermark image, when the watermark is an image. */
  watermark: HTMLImageElement | null;
  /** Uploaded sticker images, by sticker id. */
  stickerImages: Map<string, HTMLImageElement>;
  studioName: string;
  families: FontFamilies;
  /** Editor only: pictures that should be there but are not (see `MissingMarks`). */
  missing?: MissingMarks;
  /**
   * Editor only, while a slider is dragged: photos developed at most this
   * large — quick enough to follow the hand; the full size once let go.
   */
  developSide?: number;
}

/**
 * Pictures a restored draft had but that cannot be shown — gone from this
 * browser, or a photo that failed to load. The editor says so where each one
 * belongs; the download never shows these notes.
 */
export interface MissingMarks {
  /** By file id: gone from this browser (`hilang`), or failed to load (`gagal`). */
  photos: Map<string, 'hilang' | 'gagal'>;
  /** Uploaded images placed as layers, by sticker id. */
  stickers: Set<string>;
  backdrop: boolean;
  /** Carousel slides whose own background image is gone. */
  slides: Set<number>;
}

/**
 * Traces a photo's shape (see `PhotoMask`) filling `r`, as a path to clip the
 * picture to or draw its line along. The shapes stretch with the box.
 */
export function tracePhotoMask(ctx: CanvasRenderingContext2D, mask: PhotoMask, r: Rect) {
  const at = (px: number, py: number): [number, number] => [r.x + px * r.w, r.y + py * r.h];
  const poly = (pts: [number, number][]) => {
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(...at(px, py)) : ctx.moveTo(...at(px, py))));
    ctx.closePath();
  };
  ctx.beginPath();
  if (mask === 'lingkaran') {
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
  } else if (mask === 'lengkung') {
    // An arch: a half ellipse on top of a rectangle, as wide as the photo.
    const rh = Math.min(r.w / 2, r.h);
    ctx.moveTo(r.x, r.y + r.h);
    ctx.lineTo(r.x, r.y + rh);
    ctx.ellipse(r.x + r.w / 2, r.y + rh, r.w / 2, rh, 0, Math.PI, 0);
    ctx.lineTo(r.x + r.w, r.y + r.h);
    ctx.closePath();
  } else if (mask === 'hati') {
    // The same heart as the sticker, stretched to the box (drawn 6–94 × 7–88).
    const h = (x: number, y: number) => at((x - 6) / 88, (y - 7) / 81);
    ctx.moveTo(...h(50, 88));
    ctx.bezierCurveTo(...h(20, 64), ...h(6, 46), ...h(6, 30));
    ctx.bezierCurveTo(...h(6, 16), ...h(17, 7), ...h(30, 7));
    ctx.bezierCurveTo(...h(40, 7), ...h(47, 13), ...h(50, 21));
    ctx.bezierCurveTo(...h(53, 13), ...h(60, 7), ...h(70, 7));
    ctx.bezierCurveTo(...h(83, 7), ...h(94, 16), ...h(94, 30));
    ctx.bezierCurveTo(...h(94, 46), ...h(80, 64), ...h(50, 88));
    ctx.closePath();
  } else if (mask === 'bintang') {
    const pts = Array.from({ length: 10 }, (_, i): [number, number] => {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      const k = i % 2 ? 0.42 : 1;
      return [0.5 + Math.cos(a) * 0.5 * k, 0.55 + Math.sin(a) * 0.55 * k];
    });
    poly(pts);
  } else if (mask === 'segi-enam') {
    poly([
      [0.25, 0],
      [0.75, 0],
      [1, 0.5],
      [0.75, 1],
      [0.25, 1],
      [0, 0.5],
    ]);
  } else {
    poly([
      [0.5, 0],
      [1, 0.5],
      [0.5, 1],
      [0, 0.5],
    ]);
  }
}

/**
 * A photo's fade as a mask: solid from the start of the way up to `start`,
 * gone by `end`, eased in between; radial fades from the middle out.
 */
function fadeMask(fade: PhotoFade): Gradient {
  const start = Math.min(fade.start, fade.end - 0.01);
  return {
    type: fade.type,
    angle: fade.angle,
    ellipse: true,
    from: { color: '#000000', alpha: 1 },
    to: { color: '#000000', alpha: 0 },
    stops: [
      { color: '#000000', alpha: 1, at: Math.max(0, start) },
      { color: '#000000', alpha: 0, at: Math.min(1, fade.end) },
    ],
  };
}

/**
 * Draws the whole collage. Used for both the on-screen preview and the export,
 * so what the photographer sees is exactly what they download.
 */
export function drawCollage(
  ctx: CanvasRenderingContext2D,
  opts: {
    width: number;
    doc: CollageDoc;
    template: CollageTemplate;
    assets: DrawAssets;
    /** Preview only: empty-cell hints, selection outline, swap target, slide seams. */
    editor?: {
      selection: Selection;
      swapTarget: number | null;
      /** A text being typed into on the canvas: the editor draws it, not the canvas. */
      editingTextId?: string | null;
      /** Free layout: the photo whose content is being moved inside its frame. */
      croppingIndex?: number | null;
      /** Empty photo places show their number (1, 2, …) instead of "+" — design previews. */
      numbered?: boolean;
      /**
       * Empty photo places drawn as a soft stand-in picture (a toned gradient
       * with a figure), not a flat grey — so a template reads like the photo
       * it will hold. Drawn here; no picture is stored.
       */
      scene?: boolean;
      emptyFill: string;
      emptyText: string;
      accent: string;
    };
  },
) {
  const { doc, template, assets, editor } = opts;
  const missing = editor ? assets.missing : undefined;
  const f = frameOf(doc, opts.width);
  const { width, height, unit } = f;
  const style = doc.style;
  // Framed photos keep square corners — a rounded photo inside a square frame
  // reads as a mistake.
  const radius = template.frame ? 0 : style.radius * unit;

  // No background. A JPEG has no transparency (empty pixels would turn black),
  // so the export is white; the editor shows a checkerboard to say "nothing here".
  const blank = (area: Rect) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(area.x, area.y, area.w, area.h);
    if (editor) {
      const cell = Math.max(6, unit * 0.025);
      ctx.fillStyle = '#e5e7e5';
      for (let y = 0; y < height; y += cell) {
        for (let x = (Math.floor(y / cell) % 2) * cell; x < width; x += cell * 2) {
          ctx.fillRect(x, y, cell, cell);
        }
      }
    }
    ctx.restore();
  };
  if (isLayerHidden(doc, BACKGROUND_LAYER)) {
    blank({ x: 0, y: 0, w: width, h: height });
  } else if (doc.format === 'carousel' && doc.backgroundScope === 'per-slide') {
    slideBackgroundsFor(doc).forEach((bg, i) => {
      const area = { x: i * unit, y: 0, w: unit, h: height };
      const image = assets.slideBackdrops[i] ?? null;
      drawBackground(ctx, area, bg, image, unit);
      if (!image && missing?.slides.has(i)) drawMissingBackdrop(ctx, area, unit);
    });
  } else {
    const area = { x: 0, y: 0, w: width, h: height };
    drawBackground(ctx, area, { color: style.background, ...doc.backdrop }, assets.backdrop, unit);
    if (!assets.backdrop && missing?.backdrop) drawMissingBackdrop(ctx, area, unit);
  }
  // A carousel slide whose background alone is hidden, from the layer list.
  if (doc.format === 'carousel' && !isLayerHidden(doc, BACKGROUND_LAYER)) {
    for (let i = 0; i < doc.slides; i++) {
      if (isBackgroundHidden(doc, i)) blank({ x: i * unit, y: 0, w: unit, h: height });
    }
  }

  const selectedCell = editor?.selection?.kind === 'cell' ? editor.selection.index : null;
  const layouts = cellLayouts(template, f, style, doc.slots);
  const paintCell = (ctx: CanvasRenderingContext2D, i: number) => {
    const layout = layouts[i];
    if (!layout) return;
    const { rect, rotate, photo } = layout;
    const slot = doc.slots[i] ?? null;
    const img = slot ? assets.images.get(slot.file.fileId) : undefined;
    const corner = cornerRadius(slot, photo, radius, Boolean(template.frame));
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;

    ctx.save();
    // Work in the cell's own axes so rotation applies to frame and photo alike.
    ctx.translate(cx, cy);
    ctx.rotate(rotate);
    ctx.translate(-cx, -cy);
    // The photo's transparency covers its frame and line too, not the outline below.
    ctx.globalAlpha = slot?.opacity ?? 1;

    if (template.frame) {
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
      ctx.shadowBlur = unit * 0.02;
      ctx.shadowOffsetY = unit * 0.006;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }

    if (slot && img && editor?.croppingIndex === i) {
      // The whole picture, faint, so the part cut off by the frame shows while
      // it is being moved.
      ctx.save();
      ctx.globalAlpha = 0.35;
      drawSlotImage(ctx, img, photo, slot);
      ctx.restore();
    }

    // A shadow under the photo's own shape, drawn before the photo covers the shape.
    if (slot?.shadow && img && (slot.opacity ?? 1) >= 1) {
      ctx.save();
      applyShadow(ctx, slot.shadow, unit);
      // The shape itself is drawn far off the canvas and only its shadow
      // brought back: where the photo is see-through (a part erased), the
      // background shows, not a grey block.
      const far = 100000;
      const m = ctx.getTransform();
      ctx.shadowOffsetX -= m.a * far;
      ctx.shadowOffsetY -= m.b * far;
      ctx.translate(far, 0);
      if (slot.mask) tracePhotoMask(ctx, slot.mask, photo);
      else roundedRect(ctx, photo, corner);
      ctx.fillStyle = '#808080';
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    if (slot?.mask) tracePhotoMask(ctx, slot.mask, photo);
    else roundedRect(ctx, photo, corner);
    ctx.clip();
    if (slot && img) {
      // As shown: groups switched off with their eye left out.
      const adjust = shownAdjust(slot.adjust);
      const blurPx = ((adjust?.blur ?? 0) / 100) * unit * 0.04;
      // Developed on the graphics card when it can; else the older CSS look —
      // only as large as it is drawn here (a download's size, or the screen's).
      const dev = developed(img, adjust, drawnSide(ctx, img, photo, slot, assets.developSide));
      const colors = dev ? '' : adjustFilter(adjust);
      const filter = [colors, blurPx > 0 ? `blur(${blurPx}px)` : ''].filter(Boolean).join(' ');
      let source: Drawable = dev ?? img;
      if (filter && canvasFilterSupported()) ctx.filter = filter;
      else {
        // Safari: the adjusted colors, and the blur, are worked out on the photo itself.
        if (colors) source = colorFiltered(source, colors);
        if (blurPx > 0) {
          const p = photoPlacement(img, photo, slot);
          source = blurredCopy(source, p.dw, p.dh, blurPx);
        }
      }
      drawSlotImage(ctx, source, photo, slot);
      ctx.filter = 'none';
      drawAdjustOverlays(ctx, photo, adjust, Boolean(dev));
    } else if (editor && slot && missing?.photos.has(slot.file.fileId)) {
      ctx.fillStyle = '#fef3c7';
      ctx.fillRect(photo.x, photo.y, photo.w, photo.h);
      drawMissingNote(
        ctx,
        photo,
        missing.photos.get(slot.file.fileId) === 'hilang'
          ? ['Foto hilang', 'Dari komputer — pilih lagi', slot.file.fileName]
          : ['Foto gagal dimuat', 'Periksa koneksi atau fotonya', slot.file.fileName],
        unit,
      );
    } else if (editor?.scene && !(slot && !isEmptyPhoto(slot))) {
      drawStandInPhoto(ctx, photo, i, unit, editor.numbered ? String(i + 1) : null);
    } else if (editor) {
      ctx.fillStyle = editor.emptyFill;
      ctx.fillRect(photo.x, photo.y, photo.w, photo.h);
      ctx.fillStyle = editor.emptyText;
      ctx.font = `600 ${Math.round(unit * 0.05)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        slot && !isEmptyPhoto(slot) ? '…' : editor.numbered ? String(i + 1) : '+',
        photo.x + photo.w / 2,
        photo.y + photo.h / 2,
      );
    }
    ctx.restore();

    // The photo's own line, drawn inside its edge so the size stays put.
    if (slot?.stroke && slot.stroke.width > 0 && !template.frame) {
      const lw = slot.stroke.width * unit;
      ctx.save();
      ctx.strokeStyle = slot.stroke.color;
      ctx.lineWidth = lw;
      const inner = { x: photo.x + lw / 2, y: photo.y + lw / 2, w: photo.w - lw, h: photo.h - lw };
      if (slot.mask) tracePhotoMask(ctx, slot.mask, inner);
      else roundedRect(ctx, inner, Math.max(0, corner - lw / 2));
      ctx.stroke();
      ctx.restore();
    }

    // A free frame's outline is drawn over the canvas by the editor, with its
    // handles, so nothing above it covers it and the canvas edge does not cut it.
    if (
      editor &&
      ((selectedCell === i && template.id !== FREE_LAYOUT_ID) || editor.swapTarget === i)
    ) {
      const lw = Math.max(2, unit * 0.006);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = editor.accent;
      ctx.lineWidth = lw;
      if (editor.swapTarget === i) ctx.setLineDash([lw * 3, lw * 2]);
      {
        roundedRect(
          ctx,
          { x: photo.x + lw / 2, y: photo.y + lw / 2, w: photo.w - lw, h: photo.h - lw },
          corner,
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  };

  /**
   * A photo cell, faded out as asked (`Slot.fade`): drawn into a layer of its
   * own, then a gradient mask keeps it solid where it should be and lets it
   * melt into whatever is under it — background, other photos — elsewhere.
   */
  const drawCell = (i: number) => {
    const slot = doc.slots[i] ?? null;
    const layout = layouts[i];
    const fade = slot?.fade;
    if (!fade || !layout || typeof document === 'undefined') {
      paintCell(ctx, i);
      return;
    }
    const layer = document.createElement('canvas');
    layer.width = ctx.canvas.width;
    layer.height = ctx.canvas.height;
    const lctx = layer.getContext('2d');
    if (!lctx) {
      paintCell(ctx, i);
      return;
    }
    lctx.setTransform(ctx.getTransform());
    paintCell(lctx, i);
    const { rect, rotate, photo } = layout;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    lctx.save();
    lctx.translate(cx, cy);
    lctx.rotate(rotate);
    lctx.translate(-cx, -cy);
    lctx.globalCompositeOperation = 'destination-in';
    lctx.fillStyle = gradientFill(lctx, fadeMask(fade), photo.w, photo.h, photo.x, photo.y);
    lctx.fillRect(photo.x, photo.y, photo.w, photo.h);
    lctx.restore();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  };

  // Layers, bottom to top. A ready-made layout's photos all sit at the bottom;
  // in the free layout each photo takes its place among text and stickers.
  const free = template.id === FREE_LAYOUT_ID;
  const stickerById2 = new Map(doc.stickers.map((s) => [stickerLayerKey(s.id), s]));
  // Background images go under a ready-made layout's photos.
  const behind = free ? new Set<string>() : behindKeys(doc);
  for (const key of layerKeys(doc)) {
    const sticker = behind.has(key) && !isLayerHidden(doc, key) ? stickerById2.get(key) : undefined;
    if (sticker && isPlaceholder(sticker.sticker)) {
      if (editor) drawPlaceholder(ctx, sticker, f, sticker.behind ? 'Gambar latar' : undefined);
    } else if (sticker && missing?.stickers.has(sticker.sticker)) {
      drawPlaceholder(ctx, sticker, f, 'Gambar hilang');
    } else if (sticker) drawSticker(ctx, sticker, f, assets.stickerImages);
  }
  if (!free && !isLayerHidden(doc, PHOTOS_LAYER)) layouts.forEach((_, i) => drawCell(i));
  const cellIndex = new Map(doc.freeCells.map((c, i) => [photoLayerKey(c.id), i]));
  const textById = new Map(doc.texts.map((t) => [textLayerKey(t.id), t]));
  for (const key of layerKeys(doc)) {
    if (isLayerHidden(doc, key) || behind.has(key)) continue;
    const cell = cellIndex.get(key);
    if (cell !== undefined) {
      drawCell(cell);
      continue;
    }
    const sticker = stickerById2.get(key);
    if (sticker) {
      if (isPlaceholder(sticker.sticker)) {
        if (editor) drawPlaceholder(ctx, sticker, f, sticker.behind ? 'Gambar latar' : undefined);
      } else if (missing?.stickers.has(sticker.sticker)) {
        drawPlaceholder(ctx, sticker, f, 'Gambar hilang');
      } else drawSticker(ctx, sticker, f, assets.stickerImages);
      continue;
    }
    const text = textById.get(key);
    if (text && text.id !== editor?.editingTextId) drawText(ctx, text, f, assets.families);
  }
  if (doc.watermark.enabled) {
    drawWatermark(ctx, doc.watermark, f, assets.studioName, assets.watermark, assets.families);
  }

  if (editor) {
    // Where a carousel will be cut into slides.
    if (doc.slides > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = Math.max(1, unit * 0.003);
      ctx.setLineDash([unit * 0.015, unit * 0.012]);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
      ctx.shadowBlur = unit * 0.004;
      for (let s = 1; s < doc.slides; s++) {
        ctx.beginPath();
        ctx.moveTo(s * unit, 0);
        ctx.lineTo(s * unit, height);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Selection box for the watermark. Texts, elements and free frames get
    // theirs from the editor, over the canvas, where nothing covers or cuts it.
    const sel = editor.selection;
    let box: { cx: number; cy: number; w: number; h: number; rotate: number } | null = null;
    if (sel?.kind === 'watermark' && doc.watermark.enabled) {
      const r = watermarkBox(
        doc.watermark,
        f,
        assets.studioName,
        assets.watermark,
        assets.families,
      );
      if (r) box = { cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h, rotate: 0 };
    }
    if (box) {
      const pad = unit * 0.012;
      const lw = Math.max(1.5, unit * 0.004);
      ctx.save();
      ctx.translate(box.cx, box.cy);
      ctx.rotate(box.rotate);
      ctx.strokeStyle = editor.accent;
      ctx.lineWidth = lw;
      ctx.setLineDash([lw * 3, lw * 2]);
      ctx.strokeRect(-box.w / 2 - pad, -box.h / 2 - pad, box.w + 2 * pad, box.h + 2 * pad);
      ctx.restore();
    }
  }
}

/**
 * Canvas-safe image URL for a Drive photo at a given width. lh3 answers with
 * `Access-Control-Allow-Origin: *`, which is what lets the canvas be exported.
 * Photos from the photographer's computer are object URLs and pass through.
 */
export function photoUrl(file: DriveFile, width: number): string {
  const src = file.previewUrl ?? file.thumbnailUrl ?? '';
  if (/googleusercontent\.com|drive\.google\.com/.test(src)) {
    return `https://lh3.googleusercontent.com/d/${file.fileId}=w${width}`;
  }
  return src;
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Both matter: without crossOrigin the canvas becomes tainted and cannot be
    // exported; with a Referer Google starts refusing Drive images (429).
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Gagal memuat foto: ${url}`));
    img.src = url;
  });
}

/** JPEG is small and what Instagram stores anyway; PNG keeps text edges crisp. */
/** PDF pages are JPEGs inside, at the print size when the format has one. */
export type ExportFormat = 'jpg' | 'png' | 'pdf';

export const EXPORT_MIME: Record<ExportFormat, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
};

const toBlob = (canvas: HTMLCanvasElement, format: 'jpg' | 'png', quality: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Gagal membuat file gambar.'))),
      EXPORT_MIME[format],
      quality,
    ),
  );

/**
 * JPEG quality, 0–1, when none is asked: 85% — no difference to see from
 * higher, and a fraction of the file (a 24 MP RAW: 4.5 MB here, 40 MB at 100%).
 */
export const DEFAULT_JPEG_QUALITY = 0.85;

/**
 * The most pixels one exported image may have: what the browser can draw.
 * iPhones and iPads stop at about 16.7 MP a canvas.
 */
function canvasPixelLimit() {
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios ? 16_000_000 : 60_000_000;
}

/**
 * "Resolusi asli": one slide's width at which the sharpest photo shows at its
 * own pixels — no photo made larger than it is, as a photo editor exports at
 * the original size. Null when no photo is loaded.
 */
function nativeSlideWidth(
  doc: CollageDoc,
  template: CollageTemplate,
  images: Map<string, { width: number; height: number }>,
): number | null {
  const W0 = 1000 * doc.slides;
  const layouts = cellLayouts(template, frameOf(doc, W0), doc.style, doc.slots);
  let best = 0;
  slotsFor(doc, template.cells.length).forEach((slot, i) => {
    const img = slot && images.get(slot.file.fileId);
    const photo = layouts[i]?.photo;
    if (!slot || !img || !photo || !img.width) return;
    const p = photoPlacement(img, photo, slot);
    best = Math.max(best, W0 * (img.width / p.dw));
  });
  return best > 0 ? best / doc.slides : null;
}

/**
 * One slide's width in a download: the size asked, or for 'asli' the photos'
 * own (`nativeSlideWidth`, at least 1080 px) — never above what the browser
 * can draw. `images` gives each photo's size, by file id.
 */
export function plannedSlideWidth(
  doc: CollageDoc,
  template: CollageTemplate,
  images: Map<string, { width: number; height: number }>,
  slideWidth: number | 'asli',
) {
  // One slide is slideWidth × (slideWidth × slides × ratio).
  const limit = Math.floor(Math.sqrt(canvasPixelLimit() / (canvasRatio(doc) * doc.slides)));
  return Math.round(
    slideWidth === 'asli'
      ? Math.min(limit, Math.max(1080, nativeSlideWidth(doc, template, images) ?? 2160))
      : Math.min(limit, slideWidth),
  );
}

/**
 * How large a download comes out, in bytes, without making it: nine pieces of
 * the design (512 px, spread in a 3 × 3 grid) drawn at the download's own size
 * and encoded as asked — a file's size lives in its fine detail and grain,
 * which a small copy of the whole loses — their bytes per pixel carried over
 * the whole. `assets` as the editor has them.
 */
export async function estimateExport(opts: {
  doc: CollageDoc;
  template: CollageTemplate;
  assets: DrawAssets;
  format: ExportFormat;
  quality: number;
  /** One slide's width in the download. */
  slideWidth: number;
}): Promise<number> {
  const { doc, template, assets, format, quality } = opts;
  const width = opts.slideWidth * doc.slides;
  const height = Math.round(width * canvasRatio(doc));
  const T = Math.max(8, Math.min(512, width, height));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = T;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Browser tidak mendukung canvas.');
  let bytes = 0;
  const at = [1 / 6, 1 / 2, 5 / 6];
  for (const [fx, fy] of at.flatMap((y) => at.map((x) => [x, y] as const))) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, T, T);
    ctx.translate(-Math.round(fx * width - T / 2), -Math.round(fy * height - T / 2));
    drawCollage(ctx, { width, doc, template, assets });
    bytes += (await toBlob(canvas, format === 'png' ? 'png' : 'jpg', quality)).size;
  }
  canvas.width = canvas.height = 0;
  const perPixel = bytes / (9 * T * T);
  // A PDF wraps its JPEG pages with a little of its own.
  return perPixel * width * height * (format === 'pdf' ? 1.01 : 1);
}

/**
 * Renders the collage at full size from high-resolution photos. Returns one
 * JPEG per slide — a single image, or each piece of a carousel in order.
 *
 * `slideWidth` is the width of one exported image (1080 or 2160).
 */
export async function exportCollage(opts: {
  /** One slide's width in pixels, or 'asli': as large as the photos themselves. */
  slideWidth: number | 'asli';
  doc: CollageDoc;
  template: CollageTemplate;
  assets: Omit<DrawAssets, 'images'>;
  format?: ExportFormat;
  /** JPEG quality, 0–1 (PDF pages too). */
  quality?: number;
  /** Photos to draw instead of loading them, by file id — a RAW read at full size. */
  pictures?: Map<string, HTMLCanvasElement>;
}): Promise<Blob[]> {
  const { doc, template, assets, format = 'jpg', quality = DEFAULT_JPEG_QUALITY } = opts;
  const full = opts.slideWidth === 'asli';
  const images = new Map<string, HTMLImageElement>();
  const count = template.cells.length;
  await Promise.all(
    slotsFor(doc, count).map(async (slot) => {
      if (!slot || images.has(slot.file.fileId)) return;
      const own = opts.pictures?.get(slot.file.fileId);
      // Drawn like an image: a canvas has the width and height the drawing reads.
      if (own) images.set(slot.file.fileId, own as unknown as HTMLImageElement);
      // Drive gives the original when asked for more than it has.
      else images.set(slot.file.fileId, await loadImage(photoUrl(slot.file, full ? 10000 : 2400)));
    }),
  );
  const ratio = canvasRatio(doc);
  const slideWidth = plannedSlideWidth(doc, template, images, opts.slideWidth);

  // Each slide on a canvas of its own, drawn from the whole design shifted
  // into place — a photo across a slide edge lands half on each. One wide
  // canvas for all slides would pass what Safari (and so every iPhone
  // browser) allows at HD sizes.
  const width = slideWidth * doc.slides;
  const height = Math.round(width * ratio);
  const blobs: Blob[] = [];
  for (let s = 0; s < doc.slides; s++) {
    const slide = document.createElement('canvas');
    slide.width = slideWidth;
    slide.height = height;
    const ctx = slide.getContext('2d');
    if (!ctx) throw new Error('Browser tidak mendukung canvas.');
    ctx.translate(-s * slideWidth, 0);
    // At full resolution, the edits too: developed as large as the GPU allows.
    setDevelopFullSize(full);
    try {
      drawCollage(ctx, { width, doc, template, assets: { ...assets, images } });
    } finally {
      setDevelopFullSize(false);
    }
    blobs.push(await toBlob(slide, format === 'png' ? 'png' : 'jpg', quality));
    // Let the browser free this slide before drawing the next.
    slide.width = slide.height = 0;
  }
  if (format !== 'pdf') return blobs;
  // One page per slide: its print size, or A4-wide for an Instagram canvas.
  const inches = FORMATS[doc.format].printInches;
  const pageW = inches ? inches * 72 : 595;
  const pageH = pageW * (height / slideWidth);
  const pdf = await makePdf(
    blobs.map((jpeg) => ({ jpeg, width: slideWidth, height })),
    pageW,
    pageH,
  );
  return [pdf];
}

const toHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/**
 * A handful of colors that actually occur in the photos, most common first —
 * for a background that belongs to the pictures instead of fighting them.
 * Pixels are bucketed coarsely, then near-duplicates are dropped.
 */
export function extractPalette(images: HTMLImageElement[], count = 6): string[] {
  const canvas = document.createElement('canvas');
  const size = 32;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (const img of images) {
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      bucket.n += 1;
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
      buckets.set(key, bucket);
    }
  }

  const colors = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .map((c) => [c.r / c.n, c.g / c.n, c.b / c.n] as const);

  const picked: (readonly [number, number, number])[] = [];
  for (const c of colors) {
    const distinct = picked.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 48);
    if (distinct) picked.push(c);
    if (picked.length === count) break;
  }
  return picked.map(([r, g, b]) => toHex(r, g, b));
}

/** Tones a stand-in photo is drawn in — light at the top, deeper below, as daylight falls. */
const STAND_IN_TONES: [string, string, string][] = [
  ['#efe2d3', '#c9a589', '#8f6a55'], // warm sand
  ['#e3e8dc', '#a9b5a0', '#6c7a67'], // sage
  ['#eadfe7', '#b9a3b8', '#7d6680'], // dusk mauve
  ['#dfe7ec', '#9fb3c1', '#62788a'], // soft sky
  ['#f0dcd5', '#cf9f93', '#91625a'], // rose clay
  ['#ece6d6', '#bfb28d', '#857752'], // olive gold
];

/**
 * An empty photo place in a template preview: a toned gradient with a soft
 * light and the shape of a person, so the layout reads as a photograph would
 * — and the photo's number, small, to say which one goes where.
 */
function drawStandInPhoto(
  ctx: CanvasRenderingContext2D,
  r: Rect,
  index: number,
  unit: number,
  label: string | null,
) {
  const [top, mid, low] = STAND_IN_TONES[index % STAND_IN_TONES.length]!;
  const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
  g.addColorStop(0, top);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, low);
  ctx.fillStyle = g;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  // A soft light up one side, like a window.
  const side = index % 2 === 0 ? 0.28 : 0.72;
  const glow = ctx.createRadialGradient(
    r.x + r.w * side,
    r.y + r.h * 0.2,
    0,
    r.x + r.w * side,
    r.y + r.h * 0.2,
    Math.max(r.w, r.h) * 0.7,
  );
  glow.addColorStop(0, 'rgba(255,255,255,0.45)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(r.x, r.y, r.w, r.h);

  // A figure: head and shoulders, sized to the place, darker than the ground.
  const s = Math.min(r.w, r.h * 0.9);
  const cx = r.x + r.w / 2;
  const base = r.y + r.h;
  ctx.fillStyle = 'rgba(40,30,25,0.16)';
  ctx.beginPath();
  ctx.ellipse(cx, base - s * 0.52, s * 0.13, s * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.36, base);
  ctx.bezierCurveTo(cx - s * 0.34, base - s * 0.3, cx - s * 0.16, base - s * 0.34, cx, base - s * 0.34);
  ctx.bezierCurveTo(cx + s * 0.16, base - s * 0.34, cx + s * 0.34, base - s * 0.3, cx + s * 0.36, base);
  ctx.closePath();
  ctx.fill();

  if (label) {
    const d = Math.max(unit * 0.045, Math.min(r.w, r.h) * 0.12);
    const bx = r.x + Math.min(r.w, r.h) * 0.06 + d / 2;
    const by = r.y + Math.min(r.w, r.h) * 0.06 + d / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.beginPath();
    ctx.arc(bx, by, d / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a4540';
    ctx.font = `600 ${Math.round(d * 0.55)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, bx, by + d * 0.03);
  }
}
