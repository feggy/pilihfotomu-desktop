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
  /**
   * Upright (Lightroom's Transform), −100…100: lines that lean together put
   * straight. Vertical above 0 widens the top (a building shot from below);
   * Horizontal above 0 opens the left side. The picture is stretched to fill
   * the frame, losing a little at the edges, never leaving them empty.
   */
  vertical?: number;
  horizontal?: number;
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
  !!g && (g.angle !== 0 || g.rot % 4 !== 0 || g.flipH || g.flipV || !!g.crop || !!g.vertical || !!g.horizontal);

/** How far a full Upright slider pulls an edge in, as a share of the side. */
const UPRIGHT_PULL = 0.3;

/**
 * The part of the frame (shares) that Upright stretches to fill it: a
 * four-sided shape, corners top-left, top-right, bottom-right, bottom-left.
 */
export function uprightQuad(g: Pick<Geometry, 'vertical' | 'horizontal'>): [number, number][] {
  const v = (g.vertical ?? 0) / 100;
  const hz = (g.horizontal ?? 0) / 100;
  const top = Math.max(0, v) * UPRIGHT_PULL;
  const bottom = Math.max(0, -v) * UPRIGHT_PULL;
  const left = Math.max(0, hz) * UPRIGHT_PULL;
  const right = Math.max(0, -hz) * UPRIGHT_PULL;
  return [
    [top, left],
    [1 - top, right],
    [1 - bottom, 1 - right],
    [bottom, 1 - left],
  ];
}

/**
 * The perspective map from the unit square onto a four-sided shape
 * (Heckbert's square-to-quad): where each point of the result comes from.
 */
export function squareToQuad(q: [number, number][]) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q as [[number, number], [number, number], [number, number], [number, number]];
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let a: number, b: number, d: number, e: number, gg = 0, hh = 0;
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    a = x1 - x0;
    b = x3 - x0;
    d = y1 - y0;
    e = y3 - y0;
  } else {
    const det = dx1 * dy2 - dx2 * dy1;
    gg = (dx3 * dy2 - dx2 * dy3) / det;
    hh = (dx1 * dy3 - dx3 * dy1) / det;
    a = x1 - x0 + gg * x1;
    b = x3 - x0 + hh * x3;
    d = y1 - y0 + gg * y1;
    e = y3 - y0 + hh * y3;
  }
  return (u: number, v: number): [number, number] => {
    const z = gg * u + hh * v + 1;
    return [(a * u + b * v + x0) / z, (d * u + e * v + y0) / z];
  };
}

/**
 * `src` (`w` × `h`) turned and mirrored into its frame, then Upright: a mesh
 * of small triangles, each drawn with the flat (affine) map of its corners —
 * close enough to the true perspective at this fineness.
 */
function uprighted(src: CanvasImageSource, w: number, h: number, g: Geometry): HTMLCanvasElement {
  const f = frameSize(w, h, g);
  const W = Math.max(1, Math.round(f.w));
  const H = Math.max(1, Math.round(f.h));
  const turned = document.createElement('canvas');
  turned.width = W;
  turned.height = H;
  const tx = turned.getContext('2d')!;
  tx.translate(W / 2, H / 2);
  tx.scale(g.flipH ? -1 : 1, g.flipV ? -1 : 1);
  tx.rotate(((g.rot % 4) * Math.PI) / 2);
  tx.drawImage(src, -w / 2, -h / 2, w, h);
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  const from = squareToQuad(uprightQuad(g));
  const n = 16;
  const at = (i: number, j: number) => {
    const [u, v] = from(i / n, j / n);
    return { s: [u * W, v * H] as [number, number], d: [(i / n) * W, (j / n) * H] as [number, number] };
  };
  const tri = (p: ReturnType<typeof at>, q: ReturnType<typeof at>, r: ReturnType<typeof at>) => {
    const [[sx0, sy0], [sx1, sy1], [sx2, sy2]] = [p.s, q.s, r.s];
    const [[dx0, dy0], [dx1, dy1], [dx2, dy2]] = [p.d, q.d, r.d];
    const den = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
    if (Math.abs(den) < 1e-9) return;
    // The affine map taking the source triangle onto the destination one.
    const m11 = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / den;
    const m12 = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / den;
    const m13 = (dx0 * (sx1 * sy2 - sx2 * sy1) + dx1 * (sx2 * sy0 - sx0 * sy2) + dx2 * (sx0 * sy1 - sx1 * sy0)) / den;
    const m21 = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / den;
    const m22 = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / den;
    const m23 = (dy0 * (sx1 * sy2 - sx2 * sy1) + dy1 * (sx2 * sy0 - sx0 * sy2) + dy2 * (sx0 * sy1 - sx1 * sy0)) / den;
    // Clipped a hair beyond its edges, so neighbours leave no seam.
    const cx = (dx0 + dx1 + dx2) / 3;
    const cy = (dy0 + dy1 + dy2) / 3;
    const grow = (x: number, y: number) => {
      const l = Math.hypot(x - cx, y - cy) || 1;
      return [x + ((x - cx) / l) * 0.7, y + ((y - cy) / l) * 0.7] as const;
    };
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(...grow(dx0, dy0));
    ctx.lineTo(...grow(dx1, dy1));
    ctx.lineTo(...grow(dx2, dy2));
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(m11, m21, m12, m22, m13, m23);
    ctx.drawImage(turned, 0, 0);
    ctx.restore();
  };
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      tri(a, b, c);
      tri(a, c, d);
    }
  return out;
}

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
  // Upright first, in the frame's own way up; the rest then turns that.
  if (g.vertical || g.horizontal) {
    const up = uprighted(src, w, h, g);
    return drawGeometry(ctx, up, up.width, up.height, { ...g, rot: 0, flipH: false, flipV: false, vertical: 0, horizontal: 0 }, outW, outH, whole);
  }
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
