import { shownAdjust, type CutoutMode, type Slot } from './document';
import { developed } from './develop';
import { colorFiltered } from './filter-fallback';
import { adjustFilter, drawAdjustOverlays, photoPlacement, type Rect } from './render';

/**
 * Hapus latar: done entirely on this computer — the photo is never sent
 * anywhere. Both models ship with the app (`src-tauri/models/`) and run in
 * Rust on the CPU (`cutout.rs`), about half a second a photo:
 *
 * - `potret`: MODNet (Apache-2.0) — people: hair and fine edges.
 * - `objek`: U²-Netp (Apache-2.0) — products, animals, vehicles, logos:
 *   firm edges round one clear subject.
 */
export type { CutoutMode } from './document';

/** Longest side the photo is cut out at: sharp enough for print, quick enough in a browser. */
const MAX_SIDE = 2048;

export type CutoutProgress = { stage: 'unduh'; progress: number } | { stage: 'proses' };

/** A mode's model: the whole photo in, a mask (alpha, any size, stretched over the photo) out. */
type Masker = (img: HTMLImageElement) => Promise<HTMLCanvasElement>;

const maskers = new Map<CutoutMode, Promise<Masker>>();
/** `img` drawn onto a canvas `w` × `h`, smoothly. */
function resized(img: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A mask canvas from one alpha value per pixel. */
function maskCanvas(w: number, h: number, alpha: (i: number) => number): HTMLCanvasElement {
  const data = new ImageData(w, h);
  for (let i = 0; i < w * h; i++) data.data[i * 4 + 3] = alpha(i);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.putImageData(data, 0, 0);
  return canvas;
}

/**
 * A mode's model, run by the app itself (`cutout.rs`): the picture squeezed
 * to the model's size here, its mask back from Rust. MODNet reads the short
 * side at 512 px (both sides a multiple of 32); U²-Netp a 320 × 320 square.
 */
async function loadMasker(mode: CutoutMode): Promise<Masker> {
  const { api } = await import('../../lib/api');
  return async (img) => {
    let w = 320;
    let h = 320;
    if (mode === 'potret') {
      const k = 512 / Math.min(img.width, img.height);
      w = Math.max(32, Math.round((img.width * k) / 32) * 32);
      h = Math.max(32, Math.round((img.height * k) / 32) * 32);
    }
    const px = resized(img, w, h).getContext('2d')!.getImageData(0, 0, w, h).data;
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      rgb[i * 3] = px[i * 4]!;
      rgb[i * 3 + 1] = px[i * 4 + 1]!;
      rgb[i * 3 + 2] = px[i * 4 + 2]!;
    }
    const alpha = new Uint8Array(await api.cutoutMask(mode, w, h, rgb));
    return maskCanvas(w, h, (i) => alpha[i]!);
  };
}

function masker(mode: CutoutMode): Promise<Masker> {
  let m = maskers.get(mode);
  if (!m) {
    m = loadMasker(mode).catch((err: unknown) => {
      // A failure can be tried again.
      maskers.delete(mode);
      throw err;
    });
    maskers.set(mode, m);
  }
  return m;
}

/** Draws `source` (the photo, or its mask) where the slot shows the photo, in `photo`'s own space. */
function drawPlaced(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  img: { width: number; height: number },
  photo: Rect,
  slot: Slot,
) {
  const p = photoPlacement(img, photo, slot);
  ctx.save();
  ctx.translate(p.cx - photo.x, p.cy - photo.y);
  ctx.rotate(p.angle);
  if (slot.flip) ctx.scale(-1, 1);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, -p.dw / 2, -p.dh / 2, p.dw, p.dh);
  ctx.restore();
}

/**
 * The part of a slot's photo that shows in its place, as it shows — zoom, pan,
 * turn, mirror and colors — at the photo's own resolution (up to MAX_SIDE),
 * without its background in `mode` (null: all of it, for "Jadikan elemen").
 * The model judges the whole photo, not just what shows: a close crop gives
 * it too little to go on. `scale`: pixels of the result per canvas unit of
 * `photo`.
 */
export async function cutOutPhoto(
  img: HTMLImageElement,
  photo: Rect,
  slot: Slot,
  mode: CutoutMode | null,
  onProgress: (p: CutoutProgress) => void,
): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  let mask: HTMLCanvasElement | null = null;
  if (mode) {
    const run = await masker(mode);
    onProgress({ stage: 'proses' });
    mask = await run(img);
  }
  const p = photoPlacement(img, photo, slot);
  const scale = Math.min(img.width / p.dw, MAX_SIDE / Math.max(photo.w, photo.h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(photo.w * scale));
  canvas.height = Math.max(1, Math.round(photo.h * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  const adjust = shownAdjust(slot.adjust);
  const dev = developed(img, adjust);
  const colors = dev ? '' : adjustFilter(adjust);
  const shown = dev ?? (colors ? colorFiltered(img, colors) : img);
  drawPlaced(ctx, shown, img, photo, slot);
  drawAdjustOverlays(ctx, { x: 0, y: 0, w: photo.w, h: photo.h }, adjust, Boolean(dev));
  if (mask) {
    // The mask, smoothly stretched over the photo and placed the same way, keeps the subject.
    ctx.globalCompositeOperation = 'destination-in';
    drawPlaced(ctx, mask, img, photo, slot);
  }
  return { canvas, scale };
}

/**
 * The cut-out without its see-through margin, and where what is left sat in
 * the original (pixels). Null when nothing was kept — nothing was found.
 */
export function trimCutout(
  canvas: HTMLCanvasElement,
): { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number } | null {
  const { width, height } = canvas;
  const data = canvas.getContext('2d')!.getImageData(0, 0, width, height).data;
  // Faint specks left by the model do not count.
  const SOLID = 24;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  let kept = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! < SOLID) continue;
      kept++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  // Less than half a percent of the picture: nothing worth keeping.
  if (x1 < 0 || kept < width * height * 0.005) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
  return { canvas: out, x: x0, y: y0, w, h };
}

export const canvasToPng = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG gagal dibuat'))), 'image/png'),
  );

/**
 * Masking › Pilih subjek: where the subject is in the whole picture, as a
 * see-through mask (alpha) — the people model first, the objects model when
 * it finds no one. Null when neither finds anything.
 */
export async function subjectMask(
  img: HTMLImageElement,
  onProgress: (p: CutoutProgress) => void,
): Promise<HTMLCanvasElement | null> {
  for (const mode of ['potret', 'objek'] as const) {
    const run = await masker(mode);
    onProgress({ stage: 'proses' });
    const mask = await run(img);
    const ctx = mask.getContext('2d');
    if (!ctx) continue;
    const data = ctx.getImageData(0, 0, mask.width, mask.height).data;
    let on = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i]! > 128) on++;
    // Less than one percent: nothing found; try the other model.
    if (on > (mask.width * mask.height) / 100) return mask;
  }
  return null;
}
