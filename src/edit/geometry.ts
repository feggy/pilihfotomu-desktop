/**
 * Crop & luruskan: a photo turned in quarter turns, mirrored, straightened by
 * a small angle and cropped — as Lightroom's Crop Overlay does, in that order.
 *
 * The frame is the picture after the quarter turns and mirroring. A
 * straightened picture is enlarged just enough to still cover the whole
 * frame (no empty corners), and the crop is a rectangle of that frame in
 * shares (0–1), so it holds at any size: the preview and the full-size
 * export cut the same part.
 */

import type { PhotoAdjust } from '../kreasi/engine/document';

export interface Geometry {
  /** Straighten, degrees: −45…45, positive turns clockwise. */
  angle: number;
  /** Quarter turns clockwise, 0–3. */
  rot: number;
  flipH: boolean;
  flipV: boolean;
  /** The part kept, as shares of the frame; unset keeps all of it. */
  crop?: { x: number; y: number; w: number; h: number };
}

/** Hapus objek: one sweep painted over something, filled from around it (heal.tsx). */
export interface HealSpot {
  id: string;
  /** Brush width, a share of the photo's width. */
  size: number;
  points: [number, number][];
}

/** Edit foto's settings for one photo: the develop settings, the crop, what was removed. */
export type EditSettings = PhotoAdjust & {
  geometry?: Geometry;
  heal?: HealSpot[];
  /** AI Denoise (`denoise_photo`): the cleaned photo mixed in at `amount`, 0–100. */
  aiDenoise?: { amount: number };
};

export const NO_GEOMETRY: Geometry = { angle: 0, rot: 0, flipH: false, flipV: false };

export const hasGeometry = (g: Geometry | undefined): g is Geometry =>
  !!g && (g.angle !== 0 || g.rot % 4 !== 0 || g.flipH || g.flipV || !!g.crop);

/** The frame's size for a picture `w` × `h` (a quarter turn swaps the sides). */
export const frameSize = (w: number, h: number, g: Geometry) => (g.rot % 2 ? { w: h, h: w } : { w, h });

/** How much a picture turned by `angle` is enlarged to cover its own frame `w` × `h`. */
export function coverScale(w: number, h: number, angle: number): number {
  const t = (Math.abs(angle) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return Math.max(c + (h / w) * s, (w / h) * s + c);
}

/** The size of what comes out (the crop of the frame), before any scaling. */
export function outputSize(w: number, h: number, g: Geometry) {
  const f = frameSize(w, h, g);
  const c = g.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  return { w: Math.max(1, Math.round(f.w * c.w)), h: Math.max(1, Math.round(f.h * c.h)) };
}

/**
 * Draws `src` (`w` × `h`) turned, mirrored, straightened and cropped into
 * `ctx`, filling `outW` × `outH`. With `whole`, the crop is ignored and the
 * whole straightened frame is drawn (the crop tool shows it all).
 */
export function drawGeometry(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  w: number,
  h: number,
  g: Geometry,
  outW: number,
  outH: number,
  /**
   * The crop tool's view, as Lightroom's: the whole frame, the photo turned
   * in it at its own size (corners showing) instead of enlarged to cover it.
   */
  whole = false,
) {
  const f = frameSize(w, h, g);
  const c = !whole && g.crop ? g.crop : { x: 0, y: 0, w: 1, h: 1 };
  ctx.save();
  ctx.scale(outW / (f.w * c.w), outH / (f.h * c.h));
  ctx.translate(-c.x * f.w, -c.y * f.h);
  ctx.translate(f.w / 2, f.h / 2);
  ctx.rotate((g.angle * Math.PI) / 180);
  const s = whole ? 1 : coverScale(f.w, f.h, g.angle);
  ctx.scale(s, s);
  // Mirrored as the frame is seen (after the quarter turns), not the file.
  ctx.scale(g.flipH ? -1 : 1, g.flipV ? -1 : 1);
  ctx.rotate(((g.rot % 4) * Math.PI) / 2);
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/**
 * The crop tool shows the photo turned at its own size: a crop (shares of the
 * covered frame, as kept) as shares of that view, and back. `s` is
 * `coverScale` for the angle; the crop shrinks round the middle as it grows.
 */
export const cropToView = (c: { x: number; y: number; w: number; h: number }, s: number) => ({
  x: 0.5 + (c.x - 0.5) / s,
  y: 0.5 + (c.y - 0.5) / s,
  w: c.w / s,
  h: c.h / s,
});
export const cropFromView = (c: { x: number; y: number; w: number; h: number }, s: number) => ({
  x: 0.5 + (c.x - 0.5) * s,
  y: 0.5 + (c.y - 0.5) * s,
  w: c.w * s,
  h: c.h * s,
});

/** A crop of the frame `fw` × `fh` with width ÷ height `ratio`, as large as fits, centred. */
export function cropForRatio(fw: number, fh: number, ratio: number | null) {
  if (!ratio) return undefined;
  const frame = fw / fh;
  return ratio > frame
    ? { x: 0, y: (1 - frame / ratio) / 2, w: 1, h: frame / ratio }
    : { x: (1 - ratio / frame) / 2, y: 0, w: ratio / frame, h: 1 };
}
