/**
 * Samakan warna antar kamera: two bodies at one event (a second shooter, a
 * spare camera) rarely see color alike. Each camera's photos are averaged
 * (their thumbnails, the bright middle of each, gray-world), and the others
 * moved in Temp and Tint to sit where the reference camera's photos sit.
 * A starting point to fine-tune, not a calibration.
 */

import { thumbUrl, type PhotoEntry } from '../lib/api';
import { neutralBalance } from '../kreasi/engine/develop';
import { loadLocalImage } from '../kreasi/kit';

/** A photo's average color where it is neither dark nor blown (sRGB 0–255). */
async function averageOf(p: PhotoEntry): Promise<[number, number, number] | null> {
  const url = thumbUrl(p.thumb);
  if (!url) return null;
  const img = await loadLocalImage(url).catch(() => null);
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = Math.max(1, Math.round((64 * img.naturalHeight) / img.naturalWidth));
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
    if (l < 40 || l > 230) continue;
    for (let k = 0; k < 3; k++) sum[k]! += d[i + k]!;
    n++;
  }
  return n ? [sum[0]! / n, sum[1]! / n, sum[2]! / n] : null;
}

/**
 * Temp and Tint to add to each other camera's photos so their average color
 * meets `reference`'s. Keyed by camera name; cameras too alike are left out.
 */
export async function matchCameras(photos: PhotoEntry[], reference: string): Promise<Map<string, { warmth: number; tint: number }>> {
  const byCamera = new Map<string, PhotoEntry[]>();
  for (const p of photos) if (p.camera) byCamera.set(p.camera, [...(byCamera.get(p.camera) ?? []), p]);
  const balanceOf = async (list: PhotoEntry[]) => {
    const avgs = (await Promise.all(list.slice(0, 40).map(averageOf))).filter((x): x is [number, number, number] => !!x);
    if (!avgs.length) return null;
    const m = [0, 1, 2].map((k) => avgs.reduce((s, a) => s + a[k]!, 0) / avgs.length) as [number, number, number];
    return neutralBalance(...m);
  };
  const ref = byCamera.get(reference);
  const out = new Map<string, { warmth: number; tint: number }>();
  const target = ref && (await balanceOf(ref));
  if (!target) return out;
  for (const [camera, list] of byCamera) {
    if (camera === reference) continue;
    const own = await balanceOf(list);
    if (!own) continue;
    // What would neutralise each, the difference is how far apart they see.
    const warmth = Math.round(own.warmth - target.warmth);
    const tint = Math.round(own.tint - target.tint);
    if (Math.abs(warmth) + Math.abs(tint) >= 3) out.set(camera, { warmth, tint });
  }
  return out;
}
