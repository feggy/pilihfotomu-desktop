/**
 * Canvas filters for browsers without `ctx.filter` — Safari, and so every
 * browser on iPhone and iPad, which all run on Safari's engine.
 *
 * The color filters the editor uses (brightness, contrast, saturate,
 * grayscale, sepia) are worked out per pixel with the formulas from the CSS
 * Filter Effects spec, so the picture matches Chrome's. Blur is approximated
 * by shrinking and growing the image, which looks close to a Gaussian blur.
 * Results are kept per image, so a photo is processed once, not every frame.
 */

export type Drawable = HTMLImageElement | HTMLCanvasElement;

let supported: boolean | null = null;

/** Whether this browser applies `ctx.filter` — checked once by drawing a pixel. */
export function canvasFilterSupported(): boolean {
  if (supported !== null) return supported;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return (supported = false);
    ctx.filter = 'grayscale(1)';
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    // Grey if the filter ran; still pure red if it was ignored.
    supported = r !== undefined && Math.abs(r - (g ?? 0)) < 8 && Math.abs(r - (b ?? 0)) < 8;
  } catch {
    supported = false;
  }
  return supported;
}

type Op = { fn: string; v: number };

/** `brightness(1.1) saturate(0.8) blur(4px)` → the color steps, and the blur apart. */
export function parseFilter(filter: string): { ops: Op[]; blur: number } {
  const ops: Op[] = [];
  let blur = 0;
  for (const m of filter.matchAll(/([a-z-]+)\(\s*([-\d.]+)(px|%)?\s*\)/g)) {
    const fn = m[1]!;
    let v = Number(m[2]);
    if (m[3] === '%') v /= 100;
    if (fn === 'blur') blur = v;
    else ops.push({ fn, v });
  }
  return { ops, blur };
}

type Matrix = [number, number, number, number, number, number, number, number, number];

function colorMatrix(fn: string, v: number): Matrix | null {
  if (fn === 'saturate') {
    const s = v;
    return [
      0.213 + 0.787 * s,
      0.715 - 0.715 * s,
      0.072 - 0.072 * s,
      0.213 - 0.213 * s,
      0.715 + 0.285 * s,
      0.072 - 0.072 * s,
      0.213 - 0.213 * s,
      0.715 - 0.715 * s,
      0.072 + 0.928 * s,
    ];
  }
  if (fn === 'grayscale') {
    const k = 1 - Math.min(1, v);
    return [
      0.2126 + 0.7874 * k,
      0.7152 - 0.7152 * k,
      0.0722 - 0.0722 * k,
      0.2126 - 0.2126 * k,
      0.7152 + 0.2848 * k,
      0.0722 - 0.0722 * k,
      0.2126 - 0.2126 * k,
      0.7152 - 0.7152 * k,
      0.0722 + 0.9278 * k,
    ];
  }
  if (fn === 'sepia') {
    const k = 1 - Math.min(1, v);
    return [
      0.393 + 0.607 * k,
      0.769 - 0.769 * k,
      0.189 - 0.189 * k,
      0.349 - 0.349 * k,
      0.686 + 0.314 * k,
      0.168 - 0.168 * k,
      0.272 - 0.272 * k,
      0.534 - 0.534 * k,
      0.131 + 0.869 * k,
    ];
  }
  return null;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Runs the color steps over every pixel, in order, clamping after each — as CSS does. */
function applyOps(data: Uint8ClampedArray, ops: Op[]) {
  for (const { fn, v } of ops) {
    const m = colorMatrix(fn, v);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      if (m) {
        data[i] = clamp255(m[0] * r + m[1] * g + m[2] * b);
        data[i + 1] = clamp255(m[3] * r + m[4] * g + m[5] * b);
        data[i + 2] = clamp255(m[6] * r + m[7] * g + m[8] * b);
      } else if (fn === 'brightness') {
        data[i] = clamp255(r * v);
        data[i + 1] = clamp255(g * v);
        data[i + 2] = clamp255(b * v);
      } else if (fn === 'contrast') {
        data[i] = clamp255((r - 127.5) * v + 127.5);
        data[i + 1] = clamp255((g - 127.5) * v + 127.5);
        data[i + 2] = clamp255((b - 127.5) * v + 127.5);
      }
    }
  }
}

const colorCache = new WeakMap<Drawable, Map<string, HTMLCanvasElement>>();

/** A copy of the image with the filter's color steps applied (blur is left out). */
export function colorFiltered(img: Drawable, filter: string): Drawable {
  const { ops } = parseFilter(filter);
  if (ops.length === 0) return img;
  const key = ops.map((o) => `${o.fn}${o.v}`).join(' ');
  let byFilter = colorCache.get(img);
  const hit = byFilter?.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return img;
  ctx.drawImage(img, 0, 0);
  try {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    applyOps(pixels.data, ops);
    ctx.putImageData(pixels, 0, 0);
  } catch {
    // A tainted image cannot be read back: draw it as it is rather than not at all.
    return img;
  }
  if (!byFilter) {
    byFilter = new Map();
    colorCache.set(img, byFilter);
  }
  byFilter.set(key, canvas);
  return canvas;
}

const blurCache = new WeakMap<Drawable, { key: string; canvas: HTMLCanvasElement }>();

/**
 * The image at `w` × `h` pixels, blurred by about `radius` pixels: shrunk so
 * each pixel covers the radius, then grown back smoothly — twice, so the edges
 * of the little squares melt away.
 */
export function blurredCopy(img: Drawable, w: number, h: number, radius: number): Drawable {
  // Big enough to look sharp where it is sharp, small enough to stay quick.
  const scale = Math.min(1, 2048 / Math.max(w, h));
  const W = Math.max(1, Math.round(w * scale));
  const H = Math.max(1, Math.round(h * scale));
  const r = radius * scale;
  if (r < 0.5) return img;
  const key = `${W}x${H}:${Math.round(r * 10)}`;
  const cached = blurCache.get(img);
  if (cached?.key === key) return cached.canvas;

  const shrink = Math.max(1, r / 1.5);
  const sw = Math.max(1, Math.round(W / shrink));
  const sh = Math.max(1, Math.round(H / shrink));
  const small = document.createElement('canvas');
  small.width = sw;
  small.height = sh;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const sctx = small.getContext('2d');
  const octx = out.getContext('2d');
  if (!sctx || !octx) return img;
  sctx.imageSmoothingQuality = 'high';
  octx.imageSmoothingQuality = 'high';
  sctx.drawImage(img, 0, 0, sw, sh);
  // Second pass: through a canvas half the size again, then up to full.
  const tiny = document.createElement('canvas');
  tiny.width = Math.max(1, Math.round(sw / 2));
  tiny.height = Math.max(1, Math.round(sh / 2));
  const tctx = tiny.getContext('2d');
  if (tctx) {
    tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(small, 0, 0, tiny.width, tiny.height);
    sctx.clearRect(0, 0, sw, sh);
    sctx.drawImage(tiny, 0, 0, sw, sh);
  }
  octx.drawImage(small, 0, 0, W, H);
  blurCache.set(img, { key, canvas: out });
  return out;
}
