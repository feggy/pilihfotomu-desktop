/**
 * Masking's Sky and Objects, made on this computer and kept as pictures like
 * the subject's mask.
 *
 * - **Langit**: the sky is what joins the top edge and stays smooth and
 *   bright, grown out from the top a pixel at a time (no model): clear and
 *   overcast skies, cut at branches, roofs and the horizon.
 * - **Objek**: a box dragged round a thing; U²-Netp (`cutout.rs`, the
 *   salient-object model) finds it inside the box, nothing outside.
 */

import { api } from '../lib/api';
import { canvasToPng } from '../kreasi/engine/cutout';
import { hasMaskImage, registerMaskImage } from '../kreasi/engine/develop';
import { saveMaskImage } from '../kreasi/engine/lut-store';

/** A mask from one alpha byte per pixel, at `w` × `h`, edges a little soft; kept under `id`. */
function keep(id: string, w: number, h: number, alpha: Uint8Array, soft = 1) {
  const raw = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    raw.data[i * 4] = raw.data[i * 4 + 1] = raw.data[i * 4 + 2] = 255;
    raw.data[i * 4 + 3] = alpha[i]!;
  }
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  tmp.getContext('2d')!.putImageData(raw, 0, 0);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.filter = `blur(${soft}px)`;
  ctx.drawImage(tmp, 0, 0);
  registerMaskImage(id, c);
  canvasToPng(c).then((png) => png && saveMaskImage(id, png)).catch(() => {});
  return id;
}

/** The sky of `img`, or null when there is none to speak of. */
export async function skyMask(root: string, photoId: number, img: HTMLImageElement): Promise<string | null> {
  const id = `sky-${root}#${photoId}`;
  if (hasMaskImage(id)) return id;
  const W = 512;
  const H = Math.max(8, Math.round((W * img.naturalHeight) / img.naturalWidth));
  const N = W * H;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const L = new Float32Array(N);
  for (let i = 0; i < N; i++) L[i] = 0.299 * d[i * 4]! + 0.587 * d[i * 4 + 1]! + 0.114 * d[i * 4 + 2]!;
  // How busy each spot is: the strongest step to a neighbour, a little spread.
  const busy = new Float32Array(N);
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      busy[i] = Math.max(Math.abs(L[i + 1]! - L[i - 1]!), Math.abs(L[i + W]! - L[i - W]!));
    }
  // Busy anywhere within two pixels: a wall's boards or a window's frame count, a sky's haze not.
  const near = new Float32Array(N);
  for (let y = 2; y < H - 2; y++)
    for (let x = 2; x < W - 2; x++) {
      let m = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx += 2) m = Math.max(m, busy[(y + dy) * W + x + dx]!);
      near[y * W + x] = m;
    }
  const smooth = (i: number) => near[i]! < 9;
  // Sky is brighter than the land under it, and not much warmer than blue-grey.
  const skyish = (i: number) => {
    const r = d[i * 4]!;
    const b = d[i * 4 + 2]!;
    return L[i]! > 70 && b >= r * 0.75;
  };
  const sky = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qt = 0;
  for (let x = 0; x < W; x++) if (smooth(x + W) && skyish(x + W)) (sky[x + W] = 1), (queue[qt++] = x + W);
  for (let qh = 0; qh < qt; qh++) {
    const k = queue[qh]!;
    const x = k % W;
    for (const n of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, k - W, k + W]) {
      if (n < W || n >= N - W || sky[n] || !skyish(n)) continue;
      // Over a soft change (a gradient sky, haze) but not across an edge.
      if (!smooth(n) && Math.abs(L[n]! - L[k]!) > 6) continue;
      sky[n] = 1;
      queue[qt++] = n;
    }
  }
  // Each piece that grew from the top kept only when it is broad there: a
  // sky spans the top third, a window or a pale wall's patch doesn't.
  const label = new Int32Array(N).fill(-1);
  const band = Math.round(H / 3);
  let pieces = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (!sky[s0] || label[s0] !== -1) continue;
    const members: number[] = [s0];
    label[s0] = pieces;
    let inBand = 0;
    for (let h = 0; h < members.length; h++) {
      const k = members[h]!;
      if (k < band * W) inBand++;
      const x = k % W;
      for (const n of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, k - W, k + W]) {
        if (n < 0 || n >= N || !sky[n] || label[n] !== -1) continue;
        label[n] = pieces;
        members.push(n);
      }
    }
    if (inBand < band * W * 0.15) for (const k of members) sky[k] = 0;
    pieces++;
  }
  // Holes the size of a bird or a cloud's sharp rim, filled: closed by a few pixels.
  const out = new Uint8Array(N);
  const R = 2;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let n = 0;
      let t = 0;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          t++;
          n += sky[yy * W + xx]!;
        }
      out[y * W + x] = n / t > 0.5 ? 255 : 0;
    }
  // The top row is read from the row under it.
  for (let x = 0; x < W; x++) out[x] = out[x + W]!;
  let on = 0;
  for (let i = 0; i < N; i++) if (out[i]) on++;
  if (on < N * 0.02) return null;
  return keep(id, W, H, out, 1.5);
}

/** A box on the photo, as shares of it. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The thing inside `box` (shares of `img`), or null when nothing stands out there. */
export async function objectMask(root: string, photoId: number, img: HTMLImageElement, box: Box): Promise<string | null> {
  const key = [box.x, box.y, box.w, box.h].map((v) => v.toFixed(4)).join(',');
  const id = `object-${root}#${photoId}#${key}`;
  if (hasMaskImage(id)) return id;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  // A square round the box (a little room so the model sees the thing's edge).
  const bw = box.w * iw;
  const bh = box.h * ih;
  const side = Math.max(bw, bh) * 1.15;
  const sx = box.x * iw + bw / 2 - side / 2;
  const sy = box.y * ih + bh / 2 - side / 2;
  const S = 320;
  const sc = document.createElement('canvas');
  sc.width = sc.height = S;
  const sctx = sc.getContext('2d', { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(img, sx, sy, side, side, 0, 0, S, S);
  const px = sctx.getImageData(0, 0, S, S).data;
  const rgb = new Uint8Array(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    rgb[i * 3] = px[i * 4]!;
    rgb[i * 3 + 1] = px[i * 4 + 1]!;
    rgb[i * 3 + 2] = px[i * 4 + 2]!;
  }
  const alpha = new Uint8Array(await api.cutoutMask('objek', S, S, rgb));
  // Back over the photo at 1024 across, kept inside the box.
  const W = 1024;
  const H = Math.max(8, Math.round((W * ih) / iw));
  const a = new ImageData(S, S);
  for (let i = 0; i < S * S; i++) a.data[i * 4 + 3] = alpha[i]!;
  sctx.putImageData(a, 0, 0);
  const g = document.createElement('canvas');
  g.width = W;
  g.height = H;
  const gx = g.getContext('2d', { willReadFrequently: true })!;
  gx.imageSmoothingQuality = 'high';
  gx.beginPath();
  gx.rect(box.x * W, box.y * H, box.w * W, box.h * H);
  gx.clip();
  gx.drawImage(sc, (sx / iw) * W, (sy / ih) * H, (side / iw) * W, (side / ih) * H);
  const gd = gx.getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H);
  let on = 0;
  for (let i = 0; i < W * H; i++) {
    out[i] = gd[i * 4 + 3]!;
    if (out[i]! > 128) on++;
  }
  if (on < box.w * W * box.h * H * 0.02) return null;
  return keep(id, W, H, out);
}
