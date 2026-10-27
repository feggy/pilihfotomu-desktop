/**
 * Lens Blur, as Lightroom's: the background (or foreground) softened by how
 * far it is from what is in focus, from the photo's depth (`depth.rs`,
 * Depth Anything V2 Small, read on this computer).
 *
 * The photo is softened at a few strengths, at most 2048 px across (a blur
 * needs no more), and each pixel takes the strength its distance from the
 * focus asks for, mixed between the two nearest; what is in focus stays the
 * photo's own sharp pixel at any size.
 */

import { api } from '../lib/api';

export interface LensBlur {
  /** 0–100: how soft the farthest parts get. */
  amount: number;
  /** The distance kept sharp: 0 the nearest … 100 the farthest. */
  focus: number;
  /** 0–100: how deep the sharp part reaches either side of `focus`. */
  range: number;
}

export interface DepthMap {
  w: number;
  h: number;
  /** Nearness per pixel, 255 the nearest. */
  data: Uint8Array;
}

const depths = new Map<string, Promise<DepthMap>>();
/** The photo's depth, worked out once (kept in the cache by Rust too). */
export function depthOf(root: string, id: number): Promise<DepthMap> {
  const key = `${root}#${id}`;
  let p = depths.get(key);
  if (!p) {
    p = api.depthMap(root, id).then((buf) => {
      const v = new DataView(buf);
      const w = v.getUint32(0, true);
      const h = v.getUint32(4, true);
      return { w, h, data: new Uint8Array(buf, 8, w * h) };
    });
    p.catch(() => depths.delete(key));
    depths.set(key, p);
    if (depths.size > 6) depths.delete(depths.keys().next().value!);
  }
  return p;
}

/**
 * The focus that suits most photos: the largest face (as Lightroom focuses
 * on the subject), its middle's distance; without a face, the nearest large
 * thing. `faces` as shares of the photo.
 */
export function autoFocus(d: DepthMap, faces: { x: number; y: number; w: number; h: number }[] = []): number {
  const face = [...faces].sort((a, b) => b.w * b.h - a.w * a.h)[0];
  if (face) {
    const vals: number[] = [];
    for (let y = face.y + face.h * 0.3; y < face.y + face.h * 0.7; y += face.h / 12)
      for (let x = face.x + face.w * 0.3; x < face.x + face.w * 0.7; x += face.w / 12) {
        const px = Math.min(d.w - 1, Math.max(0, Math.round(x * d.w)));
        const py = Math.min(d.h - 1, Math.max(0, Math.round(y * d.h)));
        vals.push(d.data[py * d.w + px]!);
      }
    vals.sort((a, b) => a - b);
    const mid = vals[Math.floor(vals.length / 2)];
    if (mid != null) return Math.round(((255 - mid) / 255) * 100);
  }
  const hist = new Array(256).fill(0);
  for (const v of d.data) hist[v]++;
  // The nearness that 15% of the photo is at least as near as.
  let seen = 0;
  for (let v = 255; v >= 0; v--) {
    seen += hist[v];
    if (seen >= d.data.length * 0.15) return Math.round(((255 - v) / 255) * 100);
  }
  return 20;
}

const LEVELS = 6;
const done = new WeakMap<object, { key: string; canvas: HTMLCanvasElement }>();

/** `img` (`w` × `h`) with Lens Blur `lb` from `depth`; the same back while nothing changed. */
export function lensBlurred(img: HTMLImageElement | HTMLCanvasElement, w: number, h: number, depth: DepthMap, lb: LensBlur): HTMLCanvasElement {
  const key = `${w}x${h}|${lb.amount}|${lb.focus}|${lb.range}|${depth.w}`;
  const hit = done.get(img as object);
  if (hit && hit.key === key) return hit.canvas;

  // The softened copies, small.
  const k = Math.min(1, 2048 / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * k));
  const sh = Math.max(1, Math.round(h * k));
  const maxR = (lb.amount / 100) * 0.018 * Math.max(sw, sh);
  const levels: Uint8ClampedArray[] = [];
  for (let i = 0; i < LEVELS; i++) {
    const c = document.createElement('canvas');
    c.width = sw;
    c.height = sh;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const r = (maxR * i) / (LEVELS - 1);
    // Near the edges the blur lets some of the clear outside in: it thins
    // there, but the colours (all that is read) stay the photo's.
    if (r > 0) ctx.filter = `blur(${r.toFixed(2)}px)`;
    ctx.drawImage(img, 0, 0, sw, sh);
    levels.push(ctx.getImageData(0, 0, sw, sh).data);
  }
  // The depth spread over the small size.
  const dc = document.createElement('canvas');
  dc.width = depth.w;
  dc.height = depth.h;
  const dd = new ImageData(depth.w, depth.h);
  for (let i = 0; i < depth.data.length; i++) dd.data[i * 4 + 3] = depth.data[i]!;
  dc.getContext('2d')!.putImageData(dd, 0, 0);
  const dsc = document.createElement('canvas');
  dsc.width = sw;
  dsc.height = sh;
  const dsx = dsc.getContext('2d', { willReadFrequently: true })!;
  dsx.imageSmoothingQuality = 'high';
  dsx.drawImage(dc, 0, 0, sw, sh);
  const near = dsx.getImageData(0, 0, sw, sh).data;

  // Each spot's strength: 0 inside the sharp range, rising to 1 a third of the way beyond it.
  const focusNear = 255 - (lb.focus / 100) * 255;
  const half = (lb.range / 100) * 128;
  const level = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    const off = Math.max(0, Math.abs(near[i * 4 + 3]! - focusNear) - half);
    level[i] = Math.min(1, off / 85) * (LEVELS - 1);
  }

  // At the photo's own size: sharp pixels from the photo, the rest from the copies.
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d', { willReadFrequently: true })!;
  octx.drawImage(img, 0, 0, w, h);
  const od = octx.getImageData(0, 0, w, h);
  const o = od.data;
  for (let y = 0; y < h; y++) {
    const yy = Math.min(sh - 1, Math.floor(y * k));
    for (let x = 0; x < w; x++) {
      const xx = Math.min(sw - 1, Math.floor(x * k));
      const s = yy * sw + xx;
      const f = level[s]!;
      if (f <= 0.02) continue;
      const lo = Math.floor(f);
      const hi = Math.min(LEVELS - 1, lo + 1);
      const t = f - lo;
      const a = levels[lo]!;
      const b = levels[hi]!;
      const p = (y * w + x) * 4;
      const q = s * 4;
      // The first level is the photo itself, at full sharpness.
      for (let c = 0; c < 3; c++) {
        const av = lo === 0 ? o[p + c]! : a[q + c]!;
        o[p + c] = av + (b[q + c]! - av) * t;
      }
    }
  }
  octx.putImageData(od, 0, 0);
  done.set(img as object, { key, canvas: out });
  return out;
}
