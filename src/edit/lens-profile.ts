/**
 * Lens Corrections, as Lightroom's. Profile: the lens the photo was taken
 * with (its EXIF, `lens_info`), found in lensfun's database (CC BY-SA 3.0,
 * `public/lensfun.json` from `scripts/lensfun-to-json.py`) or chosen by
 * hand, and its barrel or pincushion, dark corners and colour fringes
 * (lateral chromatic aberration) taken out. Manual: distortion and corner
 * brightness by hand, for any lens.
 *
 * The models are lensfun's (`lensfun.h`): distortion r_d = r_u · f(r_u) and
 * TCA r_d = r_u · (b r² + c r + v) per colour, r = 1 half the shorter side of
 * the calibration's sensor; vignetting 1 + k1 r² + k2 r⁴ + k3 r⁶, r = 1 its
 * corner. A photo from a sensor of another size (crop factor) reads its
 * radii scaled to the calibration's.
 */

import { api } from '../lib/api';
import { meshWarp } from './geometry';

/** One lens in `lensfun.json`. */
export interface LfLens {
  maker: string;
  models: string[];
  crop: number;
  /** [focal, model, a | k1, b | k2, c] */
  dist: [number, 'ptlens' | 'poly3' | 'poly5', number, number, number][];
  /** [focal, aperture, k1, k2, k3] */
  vig: [number, number, number, number, number][];
  /** [focal, model, vr | kr, vb | kb, cr, cb, br, bb] */
  tca: [number, 'linear' | 'poly3', number, number, number, number, number, number][];
}

/** A photo's Profile settings, the lens's numbers worked out once and kept with its edit. */
export interface LensCorrection {
  /** The lens as lensfun names it, and its maker (for the Make / Model lists). */
  name: string;
  maker: string;
  /** Enable Profile Corrections. */
  profile: boolean;
  /** Remove Chromatic Aberration (from the profile's TCA). */
  ca: boolean;
  /** 0–200: how much of the profile's correction (100 = all of it). */
  distortion: number;
  vignetting: number;
  dist?: { model: 'ptlens' | 'poly3' | 'poly5'; a: number; b: number; c: number };
  vig?: { k1: number; k2: number; k3: number };
  tca?: { vr: number; vb: number; cr: number; cb: number; br: number; bb: number };
  /** The photo's radii in the calibration's: its crop factor ÷ the photo's. */
  rscale: number;
}

/** Manual: Distortion −100 (pincushion out) … 100 (barrel out); Lens Vignetting −100…100 and its Midpoint 0–100. */
export interface LensManual {
  distortion: number;
  vignette: number;
  midpoint: number;
}

type Pic = HTMLImageElement | HTMLCanvasElement;

let db: Promise<LfLens[]> | null = null;
/** The whole database (fetched once). */
export function lensDb(): Promise<LfLens[]> {
  db ??= fetch('/lensfun.json')
    .then((r) => r.json())
    .then((j: { lenses: LfLens[] }) => j.lenses);
  db.catch(() => (db = null));
  return db;
}
/** The name a lens is shown by. */
export const lensName = (l: LfLens) => l.models[l.models.length - 1]!;

/**
 * Words of a lens name, as compared: runs of letters and of numbers, so
 * "EF50mm f/1.8" and "EF 50mm F1.8" read alike ("ef", "50", "1.8"); "f" and
 * "mm" say nothing and are left out.
 */
const words = (s: string) => (s.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?/g) ?? []).filter((w) => w !== 'f' && w !== 'mm');
/** The focal lengths a name gives ("28-75mm" → "28-75"). */
const focals = (s: string) => (s.toLowerCase().match(/\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?\s*mm/g) ?? []).map((m) => m.replace(/\s*mm/, ''));

/**
 * The lens in the database that `exif` names: the same focal length(s), and
 * most of the EXIF's words found in one of its names (a word may be the
 * start of one: "a063" in "a063z"). Null when nothing fits well.
 */
export function matchLens(all: LfLens[], exif: string, maker?: string | null): LfLens | null {
  const want = words(exif);
  const wantFocal = focals(exif)[0];
  if (!want.length) return null;
  let best: { lens: LfLens; score: number } | null = null;
  for (const lens of all) {
    for (const name of lens.models) {
      if (wantFocal && !focals(name).includes(wantFocal)) continue;
      const have = words(`${lens.maker} ${name}`);
      const hit = want.filter((w) => have.some((h) => h === w || (w.length >= 3 && h.startsWith(w)))).length;
      let score = hit / want.length;
      if (maker && lens.maker.toLowerCase() === maker.toLowerCase()) score += 0.05;
      if (!best || score > best.score) best = { lens, score };
    }
  }
  return best && best.score >= 0.6 ? best.lens : null;
}

/** Linear between the two nearest calibrations of `focal` (nearest one beyond the ends). */
function between<T extends object>(rows: T[], focal: number, at: (r: T) => number): { lo: T; hi: T; t: number } | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => at(a) - at(b));
  let lo = sorted[0]!;
  let hi = sorted[sorted.length - 1]!;
  for (const r of sorted) {
    if (at(r) <= focal) lo = r;
    if (at(r) >= focal) {
      hi = r;
      break;
    }
  }
  const span = at(hi) - at(lo);
  return { lo, hi, t: span > 0 ? (focal - at(lo)) / span : 0 };
}

export type ShotLens = Awaited<ReturnType<typeof api.lensInfo>>;
const infos = new Map<string, Promise<ShotLens>>();
/** The photo's camera, lens, focal length and aperture (EXIF), read once. */
export function shotLens(root: string, id: number) {
  const key = `${root}#${id}`;
  let p = infos.get(key);
  if (!p) {
    p = api.lensInfo(root, id);
    p.catch(() => infos.delete(key));
    infos.set(key, p);
  }
  return p;
}

/** `lens`'s numbers for a photo taken at `info`'s focal length and aperture; `keep` carries the switches and amounts over. */
export function correctionFor(lens: LfLens, info: ShotLens, keep?: Partial<Pick<LensCorrection, 'profile' | 'ca' | 'distortion' | 'vignetting'>>): LensCorrection {
  const focal = info.focal ?? lens.dist[0]?.[0] ?? lens.vig[0]?.[0] ?? 50;
  const aperture = info.aperture ?? 8;
  const crop = info.focal35 && info.focal ? info.focal35 / info.focal : lens.crop;
  const out: LensCorrection = {
    name: lensName(lens),
    maker: lens.maker,
    profile: keep?.profile ?? true,
    ca: keep?.ca ?? false,
    distortion: keep?.distortion ?? 100,
    vignetting: keep?.vignetting ?? 100,
    rscale: lens.crop / crop,
  };
  // Distortion: the model of the nearest calibration; its numbers between the two nearest of that model.
  const d = between(lens.dist, focal, (r) => r[0]);
  if (d) {
    const model = d.lo[1];
    const same = d.hi[1] === model;
    const mix = (i: 2 | 3 | 4) => (same ? d.lo[i] + (d.hi[i] - d.lo[i]) * d.t : d.lo[i]);
    out.dist = { model, a: mix(2), b: mix(3), c: mix(4) };
  }
  // Vignetting: at the aperture nearest the photo's (in stops), between focal lengths.
  if (lens.vig.length) {
    const stops = (f: number) => Math.log2(f) * 2;
    const nearest = lens.vig.reduce((b, r) => (Math.abs(stops(r[1]) - stops(aperture)) < Math.abs(stops(b) - stops(aperture)) ? r[1] : b), lens.vig[0]![1]);
    const v = between(
      lens.vig.filter((r) => r[1] === nearest),
      focal,
      (r) => r[0],
    );
    if (v) {
      const mix = (i: 2 | 3 | 4) => v.lo[i] + (v.hi[i] - v.lo[i]) * v.t;
      out.vig = { k1: mix(2), k2: mix(3), k3: mix(4) };
    }
  }
  // Chromatic aberration (linear kr, kb read as poly3 with v alone).
  const t = between(lens.tca ?? [], focal, (r) => r[0]);
  if (t) {
    const mix = (i: 2 | 3 | 4 | 5 | 6 | 7) => t.lo[i] + (t.hi[i] - t.lo[i]) * t.t;
    out.tca = { vr: mix(2), vb: mix(3), cr: mix(4), cb: mix(5), br: mix(6), bb: mix(7) };
  }
  return out;
}

/** The photo's lens found from its EXIF; null when it isn't known. */
export async function lensCorrectionFor(root: string, id: number): Promise<{ found: LensCorrection | null; exifLens: string | null }> {
  const info = await shotLens(root, id);
  if (!info.lens) return { found: null, exifLens: null };
  const lens = matchLens(await lensDb(), info.lens, info.make);
  return { found: lens ? correctionFor(lens, info) : null, exifLens: info.lens };
}

/** r_d ÷ r_u at `r` (calibration units), the correction's share `amount` (0–2) of the way. */
function distortRatio(c: NonNullable<LensCorrection['dist']>, r: number, amount: number) {
  const f =
    c.model === 'ptlens'
      ? c.a * r ** 3 + c.b * r ** 2 + c.c * r + 1 - c.a - c.b - c.c
      : c.model === 'poly3'
        ? 1 - c.a + c.a * r * r
        : 1 + c.a * r * r + c.b * r ** 4;
  return 1 + (f - 1) * amount;
}

/** Manual Distortion's pull at `r` (half the shorter side = 1): 100 takes out a strong barrel. */
const manualRatio = (m: LensManual | undefined, r: number) => 1 - ((m?.distortion ?? 0) / 100) * 0.12 * r * r;

/**
 * Where each point of the corrected photo (shares) is found in the photo
 * (`W` × `H`): the profile's distortion and Manual's, enlarged just enough
 * that its edges stay inside (Lightroom's Constrain Crop).
 */
export function distortionMap(lc: LensCorrection | undefined, manual: LensManual | undefined, W: number, H: number): ((u: number, v: number) => [number, number]) | null {
  const c = lc?.profile ? lc.dist : undefined;
  const amount = (lc?.distortion ?? 0) / 100;
  const profile = c && amount ? { c, amount, rscale: lc!.rscale } : null;
  if (!profile && !manual?.distortion) return null;
  const half = Math.min(W, H) / 2;
  const ratioAt = (px: number, py: number) => {
    const r = Math.hypot(px, py) / half;
    return (profile ? distortRatio(profile.c, r * profile.rscale, profile.amount) : 1) * manualRatio(manual, r);
  };
  // How far the edges reach beyond the photo: the zoom that keeps them in.
  let worst = 1;
  for (let i = 0; i <= 16; i++) {
    const s = i / 16;
    for (const [u, v] of [[s, 0], [s, 1], [0, s], [1, s]] as const) {
      const px = (u - 0.5) * W;
      const py = (v - 0.5) * H;
      const k = ratioAt(px, py);
      worst = Math.max(worst, Math.abs(px * k) / (W / 2), Math.abs(py * k) / (H / 2));
    }
  }
  const zoom = 1 / worst;
  return (u, v) => {
    const px = (u - 0.5) * W * zoom;
    const py = (v - 0.5) * H * zoom;
    const k = ratioAt(px, py);
    return [0.5 + (px * k) / W, 0.5 + (py * k) / H];
  };
}

/** `img` on a canvas `w` × `h` whose pixels can be read and written. */
function workCanvas(img: Pic, w: number, h: number) {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return { out, ctx, d: ctx.getImageData(0, 0, w, h) };
}

const brightened = new WeakMap<object, { key: string; canvas: HTMLCanvasElement }>();
/**
 * `img` (`w` × `h`) with its corners' brightness corrected: the profile's
 * vignetting taken out, then Manual's Lens Vignetting (above 0 lighter
 * corners; Midpoint where it starts, 0 near the middle … 100 near the corners).
 */
export function devignetted(img: Pic, w: number, h: number, lc: LensCorrection | undefined, manual: LensManual | undefined): Pic {
  const c = lc?.profile ? lc.vig : undefined;
  const amount = (lc?.vignetting ?? 0) / 100;
  const mv = (manual?.vignette ?? 0) / 100;
  if ((!c || !amount) && !mv) return img;
  const key = `${w}x${h}|${amount}|${JSON.stringify(c)}|${lc?.rscale}|${mv}|${manual?.midpoint}`;
  const hit = brightened.get(img as object);
  if (hit && hit.key === key) return hit.canvas;
  // The gain at distances from the middle (corner = 1), in the photo's gamma.
  const start = 0.15 + ((manual?.midpoint ?? 50) / 100) * 0.7;
  const gainAt = (r: number) => {
    let g = 1;
    if (c && amount) {
      const q = r * lc!.rscale;
      const r2 = q * q;
      const fall = Math.max(0.2, 1 + c.k1 * r2 + c.k2 * r2 * r2 + c.k3 * r2 * r2 * r2);
      g *= (1 + (1 / fall - 1) * amount) ** (1 / 2.2);
    }
    if (mv) {
      const t = Math.min(1, Math.max(0, (r - start) / (1.05 - start)));
      g *= Math.max(0, 1 + mv * 0.9 * t * t);
    }
    return g;
  };
  // Drawn, not computed pixel by pixel (that made the slider lag): the photo
  // added to itself through a round gradient where it brightens (gain − 1),
  // and black over it through another where it darkens (1 − gain).
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const corner = Math.hypot(w, h) / 2;
  const ring = (alpha: (g: number) => number, rgb: string) => {
    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, corner);
    for (let i = 0; i <= 24; i++) grad.addColorStop(i / 24, `rgba(${rgb},${Math.min(1, Math.max(0, alpha(gainAt(i / 24)))).toFixed(4)})`);
    return grad;
  };
  const extra = document.createElement('canvas');
  extra.width = w;
  extra.height = h;
  const ex = extra.getContext('2d')!;
  ex.drawImage(img, 0, 0, w, h);
  ex.globalCompositeOperation = 'destination-in';
  ex.fillStyle = ring((g) => g - 1, '0,0,0');
  ex.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(extra, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = ring((g) => 1 - g, '0,0,0');
  ctx.fillRect(0, 0, w, h);
  brightened.set(img as object, { key, canvas: out });
  return out;
}

/** `img` (`w` × `h`) with its barrel or pincushion taken out (profile and Manual). */
export function undistorted(img: Pic, w: number, h: number, lc: LensCorrection | undefined, manual: LensManual | undefined): Pic {
  const map = distortionMap(lc, manual, w, h);
  if (!map) return img;
  const key = `${w}x${h}|${lc?.profile}|${lc?.distortion}|${JSON.stringify(lc?.dist)}|${lc?.rscale}|${manual?.distortion}`;
  return warping(img, key, map, w, h);
}
const warpCache = new WeakMap<object, { key: string; canvas: HTMLCanvasElement }>();
function warping(img: Pic, key: string, map: (u: number, v: number) => [number, number], w: number, h: number) {
  const hit = warpCache.get(img as object);
  if (hit && hit.key === key) return hit.canvas;
  const canvas = meshWarp(img, Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), map, 24);
  warpCache.set(img as object, { key, canvas });
  return canvas;
}

/**
 * `img` (`w` × `h`) with its colour fringes taken out: red and blue each
 * read from where the lens put them (the profile's TCA), green as it is.
 */
export function withoutFringes(img: Pic, w: number, h: number, lc: LensCorrection | undefined): Pic {
  const t = lc?.ca ? lc.tca : undefined;
  if (!t) return img;
  return fringes(img, `${w}x${h}|${JSON.stringify(t)}|${lc!.rscale}`, w, h, t, lc!.rscale);
}
const fringeCache = new WeakMap<object, { key: string; canvas: HTMLCanvasElement }>();
function fringes(img: Pic, key: string, w: number, h: number, t: NonNullable<LensCorrection['tca']>, rscale: number) {
  const hit = fringeCache.get(img as object);
  if (hit && hit.key === key) return hit.canvas;
  const { out, ctx, d } = workCanvas(img, w, h);
  const src = new Uint8ClampedArray(d.data);
  const p = d.data;
  const half = Math.min(w, h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  // Channel `c` read between pixels at (x, y).
  const read = (x: number, y: number, c: number) => {
    const x0 = Math.max(0, Math.min(w - 2, Math.floor(x)));
    const y0 = Math.max(0, Math.min(h - 2, Math.floor(y)));
    const fx = Math.min(1, Math.max(0, x - x0));
    const fy = Math.min(1, Math.max(0, y - y0));
    const i = (y0 * w + x0) * 4 + c;
    const a = src[i]! + (src[i + 4]! - src[i]!) * fx;
    const b = src[i + w * 4]! + (src[i + w * 4 + 4]! - src[i + w * 4]!) * fx;
    return a + (b - a) * fy;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const r = (Math.hypot(dx, dy) / half) * rscale;
      const kr = t.br * r * r + t.cr * r + t.vr;
      const kb = t.bb * r * r + t.cb * r + t.vb;
      const i = (y * w + x) * 4;
      p[i] = read(cx + dx * kr, cy + dy * kr, 0);
      p[i + 2] = read(cx + dx * kb, cy + dy * kb, 2);
    }
  }
  ctx.putImageData(d, 0, 0);
  fringeCache.set(img as object, { key, canvas: out });
  return out;
}
