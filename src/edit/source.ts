/**
 * The picture Edit foto develops from: the photo, its AI Denoise result mixed
 * in, then what was removed filled in (heal.tsx) — in that order, so a
 * removal is never brought back by the cleaned copy.
 */

import { convertFileSrc } from '@tauri-apps/api/core';

import { api } from '../lib/api';
import { healed } from './heal';
import { lensBlurred, type DepthMap } from './lens-blur';
import { devignetted, undistorted, withoutFringes } from './lens-profile';
import type { EditSettings } from './geometry';

/** Cleaned pictures read back, by path; the last few kept. */
const cleaned = new Map<string, Promise<HTMLImageElement>>();
async function readImage(path: string): Promise<HTMLImageElement> {
  const blob = await (await fetch(convertFileSrc(path))).blob();
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A photo's AI Denoise result (made once, kept in the cache): the 2048 px
 * copy, or the full size. Asks Rust, which answers at once when it is there.
 */
export function cleanedImage(root: string, id: number, full: boolean, onProgress?: (p: { done: number; total: number }) => void) {
  const key = `${root}#${id}#${full ? 'full' : 'preview'}`;
  let p = cleaned.get(key);
  if (!p) {
    p = api.denoisePhoto(root, id, onProgress ?? (() => {})).then((d) => readImage(full ? d.full : d.preview));
    p.catch(() => cleaned.delete(key));
    cleaned.set(key, p);
    if (cleaned.size > 4) cleaned.delete(cleaned.keys().next().value!);
  }
  return p;
}

const mixes = new WeakMap<object, { clean: object; amount: number; canvas: HTMLCanvasElement }>();

/**
 * `img` (`w` × `h`) with the cleaned copy at `amount` (0–100), the lens's
 * dark corners lifted, its distortion and colour fringes taken out, the removals filled, then Lens Blur (with the
 * photo's `depth`, once read).
 */
export function prepared(
  img: HTMLImageElement | HTMLCanvasElement,
  w: number,
  h: number,
  s: EditSettings | undefined,
  clean: CanvasImageSource | null,
  depth: DepthMap | null = null,
): HTMLImageElement | HTMLCanvasElement {
  let base: HTMLImageElement | HTMLCanvasElement = img;
  const amount = s?.aiDenoise?.amount ?? 0;
  if (clean && amount > 0) {
    const hit = mixes.get(img as object);
    if (hit && hit.clean === clean && hit.amount === amount) base = hit.canvas;
    else {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);
      ctx.globalAlpha = Math.min(1, amount / 100);
      ctx.drawImage(clean, 0, 0, w, h);
      mixes.set(img as object, { clean: clean as object, amount, canvas: c });
      base = c;
    }
  }
  const lens = s?.geometry?.lens;
  const manual = s?.lensManual;
  const lit = lens || manual ? withoutFringes(undistorted(devignetted(base, w, h, lens, manual), w, h, lens, manual), w, h, lens) : base;
  const filled = s?.heal?.length ? healed(lit, w, h, s.heal) : lit;
  const lb = s?.lensBlur;
  return lb && lb.amount > 0 && depth ? lensBlurred(filled, w, h, depth, lb) : filled;
}
