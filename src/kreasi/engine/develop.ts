import {
  COLOR_BANDS,
  curveBends,
  maskActive,
  maskParts,
  MAX_MASKS,
  type CurvePoint,
  type EditMask,
  type MaskPart,
  type GradeWheel,
  type PhotoAdjust,
} from './document';
import { canvasFilterSupported } from './filter-fallback';

/**
 * Develop: a photo's light, color, effects and detail worked out on the
 * graphics card (WebGL2), like a photo editor — exposure, highlights and
 * shadows, a tone curve, white balance, a color mixer, color grading,
 * texture, clarity, dehaze, sharpening, noise reduction. The result is a
 * canvas the collage draws in place of the photo; the vignette and grain are
 * laid over the photo as it is shown (see `drawAdjustOverlays`).
 *
 * Everything local — clarity, texture, dehaze, shadows and highlights —
 * compares the photo with blurred copies of itself made at sizes relative to
 * the photo, so the small preview and the full-size download look the same.
 * The first seven settings keep their older formulas, so a design made before
 * develop looks as it did.
 *
 * Without WebGL2 (rare) `developed` gives null and the collage falls back to
 * the older CSS look, which covers the first seven settings.
 */

/** Whether a photo needs developing — anything beyond blur, grain and the vignette. */
export function needsDevelop(a: PhotoAdjust | undefined): boolean {
  if (!a) return false;
  return Boolean(
    a.mono ||
    a.brightness ||
    a.contrast ||
    a.saturation ||
    a.warmth ||
    a.fade ||
    a.highlights ||
    a.shadows ||
    a.whites ||
    a.blacks ||
    a.tint ||
    a.vibrance ||
    a.texture ||
    a.clarity ||
    a.dehaze ||
    a.sharpen ||
    a.noise ||
    a.colorNoise ||
    (['rgb', 'r', 'g', 'b'] as const).some((k) => curveBends(a.curve?.[k])) ||
    hslActive(a) ||
    gradeActive(a) ||
    lutActive(a) ||
    denoiseActive(a) ||
    Boolean(a.raw && rawRenders.has(a.raw.id)) ||
    Boolean(a.masks?.some(maskActive)),
  );
}

// ── AI Denoise: the photo cleaned, registered once read from this browser ──

const denoisedImages = new Map<string, HTMLCanvasElement | ImageBitmap>();
export function registerDenoised(id: string, img: HTMLCanvasElement | ImageBitmap) {
  denoisedImages.set(id, img);
}
export const hasDenoised = (id: string) => denoisedImages.has(id);
/** Denoised pictures cleaned at full size, for the download under way only. */
const fullDenoised = new Map<string, HTMLCanvasElement>();
/** The full-size cleaned pictures a download uses (by denoise id); the others let go. */
export function setFullDenoised(pictures: Map<string, HTMLCanvasElement>) {
  fullDenoised.clear();
  for (const [id, c] of pictures) fullDenoised.set(id, c);
}
/** Whether a picture's denoise is in use now (amount, and made at this white balance). */
export const denoiseInUse = (a: PhotoAdjust | undefined) => Boolean(a && denoiseActive(a));
/** The white balance a picture is drawn at, as AI Denoise notes it: a RAW's, or none. */
export const wbKey = (a: PhotoAdjust | undefined) =>
  a?.raw ? `${Math.round(a.raw.kelvin)}/${Math.round(a.raw.tint)}` : undefined;
function denoiseActive(a: PhotoAdjust) {
  return Boolean(
    a.denoise &&
    (a.denoise.amount ?? 100) > 0 &&
    denoisedImages.has(a.denoise.id) &&
    // Made at another white balance: not this picture any more.
    a.denoise.wb === wbKey(a),
  );
}

// ── Camera RAW: the picture drawn at its white balance, by the worker ──

const rawRenders = new Map<string, { kelvin: number; tint: number; img: HTMLCanvasElement }>();
/** The latest drawing of RAW `id`, shown until the next one comes. */
export function registerRawRender(
  id: string,
  kelvin: number,
  tint: number,
  img: HTMLCanvasElement,
) {
  rawRenders.set(id, { kelvin, tint, img });
}
export const rawRenderOf = (id: string) => rawRenders.get(id);
/** The RAW's drawing to develop from, when there is one of this picture's shape. */
function rawBase(source: { width: number; height: number }, a: PhotoAdjust) {
  const r = a.raw && rawRenders.get(a.raw.id);
  if (!r || Math.abs(r.img.width / r.img.height - source.width / source.height) > 0.01) return null;
  // A download's full-size reading is already at this white balance, and sharper.
  if (source.width > r.img.width * 1.1) return null;
  return r.img;
}
/**
 * The photo to develop from: the cleaned one mixed in at its amount, at w × h.
 * Null when there is none for it (or it was made from a photo of another shape).
 */
function denoisedInput(source: CanvasImageSource, a: PhotoAdjust, w: number, h: number) {
  // A download at full resolution: the photo cleaned again at that size, when there is one.
  const full = fullSize && a.denoise ? fullDenoised.get(a.denoise.id) : undefined;
  const clean = full ?? (a.denoise && denoisedImages.get(a.denoise.id));
  if (!clean || !denoiseActive(a)) return null;
  if (Math.abs(clean.width / clean.height - w / h) > 0.01) return null;
  const amount = Math.min(1, (a.denoise!.amount ?? 100) / 100);
  // Made once for this photo, amount and size: a slider elsewhere reuses it.
  const hit = mixes.get(clean as object);
  if (hit && hit.source === source && hit.amount === amount && hit.w === w && hit.h === h) {
    return hit.canvas;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, w, h);
  ctx.globalAlpha = amount;
  ctx.drawImage(clean, 0, 0, w, h);
  mixes.set(clean as object, { source, amount, w, h, canvas: c });
  return c;
}
/** The latest mix per cleaned picture (see `denoisedInput`). */
const mixes = new WeakMap<
  object,
  { source: CanvasImageSource; amount: number; w: number; h: number; canvas: HTMLCanvasElement }
>();

// ── Masking: each mask drawn as a see-through picture (alpha = how much) ──

/** Subject masks, worked out once and kept in this browser, by id. */
const maskImages = new Map<string, CanvasImageSource>();
export function registerMaskImage(id: string, img: CanvasImageSource) {
  maskImages.set(id, img);
}
export const hasMaskImage = (id: string) => maskImages.has(id);

const MASK_SIDE = 512;
const masks = new Map<string, HTMLCanvasElement>();

/** Pictures by a number of their own, for the keys of what is worked out from them. */
const sourceIds = new WeakMap<object, number>();
let nextSourceId = 1;
function sourceId(source: object) {
  let id = sourceIds.get(source);
  if (!id) {
    id = nextSourceId++;
    sourceIds.set(source, id);
  }
  return id;
}

/** sRGB (0–255) as CIE Lab: L 0–100, and a, b round 0 — colors apart as the eye sees them. */
const LINEAR = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
const labF = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
export function toLab(r: number, g: number, b: number): [number, number, number] {
  const R = LINEAR[Math.round(r)]!;
  const G = LINEAR[Math.round(g)]!;
  const B = LINEAR[Math.round(b)]!;
  const x = labF((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = labF(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = labF((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** The photo at a mask's size, as Lab, for the color and luminance ranges — worked out once. */
const labs = new WeakMap<
  object,
  { size: string; L: Float32Array; a: Float32Array; b: Float32Array }
>();
function photoLab(source: CanvasImageSource, W: number, H: number) {
  const size = `${W}x${H}`;
  const hit = labs.get(source as object);
  if (hit?.size === size) return hit;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;
  const L = new Float32Array(W * H);
  const a = new Float32Array(W * H);
  const b = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const lab = toLab(d[i * 4]!, d[i * 4 + 1]!, d[i * 4 + 2]!);
    L[i] = lab[0];
    a[i] = lab[1];
    b[i] = lab[2];
  }
  const out = { size, L, a, b };
  labs.set(source as object, out);
  return out;
}

const ramp = (x: number, from: number, to: number) => {
  if (to <= from) return x >= to ? 1 : 0;
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
};

/** How much a range part covers each pixel, 0–1; null when the photo cannot be read. */
function rangeWeights(p: MaskPart, source: CanvasImageSource, W: number, H: number) {
  const lab = photoLab(source, W, H);
  if (!lab) return null;
  const out = new Float32Array(W * H);
  if (p.kind === 'color') {
    const picks = (p.colors ?? []).map(([r, g, b]) => toLab(r, g, b));
    // Range 0–100 as a distance in Lab: from just the color picked to its whole family.
    const far = 4 + (p.range ?? 50) * 0.38;
    const near = far * 0.45;
    for (let i = 0; i < out.length; i++) {
      let w = 0;
      for (const [L, a, b] of picks) {
        const d = Math.hypot((lab.L[i]! - L) * 0.5, lab.a[i]! - a, lab.b[i]! - b);
        w = Math.max(w, 1 - ramp(d, near, far));
      }
      out[i] = w;
    }
  } else {
    const lo = p.lumLo ?? 60;
    const hi = p.lumHi ?? 100;
    const soft = (p.smooth ?? 30) * 0.5;
    for (let i = 0; i < out.length; i++) {
      const L = lab.L[i]!;
      out[i] = ramp(L, lo - soft, lo) * (1 - ramp(L, hi, hi + soft));
    }
  }
  return out;
}

/** One part of a mask on its own, white where it covers. Null: not ready (subject not read, no photo). */
function partRaster(
  p: MaskPart,
  W: number,
  H: number,
  source: CanvasImageSource | undefined,
): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const white = 'rgba(255,255,255,1)';
  if (p.unplaced) {
    // A gradient not drawn yet covers nothing.
  } else if (p.kind === 'linear') {
    const g = ctx.createLinearGradient(
      (p.x0 ?? 0.5) * W,
      (p.y0 ?? 0.1) * H,
      (p.x1 ?? 0.5) * W,
      (p.y1 ?? 0.5) * H,
    );
    g.addColorStop(0, white);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else if (p.kind === 'radial') {
    const inner = Math.max(0, 1 - (p.feather ?? 50) / 100);
    ctx.save();
    ctx.translate((p.cx ?? 0.5) * W, (p.cy ?? 0.5) * H);
    ctx.rotate(((p.angle ?? 0) * Math.PI) / 180);
    ctx.scale(Math.max(1e-3, (p.rx ?? 0.25) * W), Math.max(1e-3, (p.ry ?? 0.25) * H));
    const g = ctx.createRadialGradient(0, 0, inner * 0.999, 0, 0, 1);
    g.addColorStop(0, white);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (p.kind === 'brush') {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const st of p.strokes ?? []) {
      if (!st.points.length) continue;
      const width = Math.max(1, st.size * W);
      const blur = (st.feather / 100) * width * 0.45;
      ctx.save();
      ctx.globalCompositeOperation = st.erase ? 'destination-out' : 'source-over';
      if (blur > 0.5 && canvasFilterSupported()) ctx.filter = `blur(${blur}px)`;
      ctx.strokeStyle = white;
      ctx.fillStyle = white;
      // Soft edges shrink the line a little so its middle still covers.
      ctx.lineWidth = Math.max(1, width - blur);
      ctx.beginPath();
      const [first, ...rest] = st.points;
      ctx.moveTo(first![0] * W, first![1] * H);
      if (!rest.length) {
        ctx.arc(first![0] * W, first![1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        for (const [x, y] of rest) ctx.lineTo(x * W, y * H);
        ctx.stroke();
      }
      ctx.restore();
    }
  } else if (p.kind === 'subject' || p.kind === 'background') {
    const found = p.subject ? maskImages.get(p.subject) : undefined;
    if (!found) return null;
    ctx.drawImage(found, 0, 0, W, H);
  } else {
    if (!source) return null;
    const w = rangeWeights(p, source, W, H);
    if (!w) return null;
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < w.length; i++) {
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = Math.round(w[i]! * 255);
    }
    ctx.putImageData(img, 0, 0);
  }
  // Background is the subject turned inside out; Balik turns any part.
  if (Boolean(p.invert) !== (p.kind === 'background')) {
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const o = out.getContext('2d')!;
    o.fillStyle = white;
    o.fillRect(0, 0, W, H);
    o.globalCompositeOperation = 'destination-out';
    o.drawImage(canvas, 0, 0);
    return out;
  }
  return canvas;
}

/** Whether a part is worked out from the photo's own pixels. */
const fromPhoto = (p: MaskPart) => p.kind === 'color' || p.kind === 'luminance';

/**
 * A mask as a picture `aspect` (height ÷ width) in shape, at most 512 px:
 * white where it applies, see-through where not — its parts in order, each
 * added or taken away. `source` is the picture, for the color and luminance
 * ranges. Null while a part is not ready (a subject not read yet). The same
 * size at any photo size, so preview and download match.
 */
export function maskRaster(
  m: EditMask,
  aspect: number,
  source?: CanvasImageSource,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const W = aspect <= 1 ? MASK_SIDE : Math.max(8, Math.round(MASK_SIDE / aspect));
  const H = aspect <= 1 ? Math.max(8, Math.round(MASK_SIDE * aspect)) : MASK_SIDE;
  const parts = maskParts(m);
  const photo = parts.some(fromPhoto) && source ? sourceId(source as object) : 0;
  const key = `${JSON.stringify(parts)}|${W}x${H}|${photo}`;
  const hit = masks.get(key);
  if (hit) return hit;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  for (const p of parts) {
    const r = partRaster(p, W, H, source);
    if (!r) return null;
    ctx.globalCompositeOperation = p.subtract ? 'destination-out' : 'source-over';
    ctx.drawImage(r, 0, 0);
  }
  masks.set(key, out);
  if (masks.size > 24) masks.delete(masks.keys().next().value!);
  return out;
}

/** The mask in a color (red unless chosen), to see where it applies (drawn over the photo while working). */
export function maskPreview(
  m: EditMask,
  aspect: number,
  source?: CanvasImageSource,
  color = '#ff2d55',
): HTMLCanvasElement | null {
  const raster = maskRaster(m, aspect, source);
  if (!raster) return null;
  const c = document.createElement('canvas');
  c.width = raster.width;
  c.height = raster.height;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(raster, 0, 0);
  return c;
}

/**
 * A mask's coverage (its alpha, one byte a pixel), read once per mask picture
 * — `maskRaster` keeps the same picture while the mask is unchanged, so a
 * slider moving elsewhere reads nothing back from it.
 */
const coverages = new WeakMap<HTMLCanvasElement, Uint8Array>();
function coverageOf(raster: HTMLCanvasElement): Uint8Array | null {
  const hit = coverages.get(raster);
  if (hit) return hit;
  const px = raster.getContext('2d')?.getImageData(0, 0, raster.width, raster.height).data;
  if (!px) return null;
  const a = new Uint8Array(raster.width * raster.height);
  for (let i = 0; i < a.length; i++) a[i] = px[i * 4 + 3]!;
  coverages.set(raster, a);
  return a;
}

/** The masks that change anything, in order, at most MAX_MASKS. */
const liveMasks = (a: PhotoAdjust) => (a.masks ?? []).filter(maskActive).slice(0, MAX_MASKS);

// ── LUTs (.cube), registered once read from this browser's store ──
const luts = new Map<
  string,
  { size: number; data: Uint8Array; tex?: WebGLTexture; engine?: object }
>();
/** A LUT ready to develop with (read from IndexedDB by the editor). */
export function registerLut(id: string, size: number, data: Uint8Array) {
  luts.set(id, { size, data });
}
export const hasLut = (id: string) => luts.has(id);
const lutActive = (a: PhotoAdjust) =>
  Boolean(a.lut && luts.has(a.lut.id) && (a.lut.amount ?? 100) > 0);

const hslActive = (a: PhotoAdjust) =>
  Object.values(a.hsl ?? {}).some((v) => v && (v.h || v.s || v.l));
const gradeActive = (a: PhotoAdjust) =>
  [a.grade?.shadows, a.grade?.midtones, a.grade?.highlights, a.grade?.global].some(
    (w) => w && (w.sat || w.lum),
  );

// ── Tone curves ──

export const STRAIGHT: CurvePoint[] = [
  [0, 0],
  [1, 1],
];

/**
 * A curve through its points, sampled at `n` places (0–1 in, 0–1 out): a
 * smooth line that never overshoots between points (monotone cubic), flat
 * beyond the first and last.
 */
export function sampleCurve(points: CurvePoint[] | undefined, n = 256): Float32Array {
  const out = new Float32Array(n);
  const p = [...(points && points.length >= 2 ? points : STRAIGHT)].sort((a, b) => a[0] - b[0]);
  const k = p.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < k - 1; i++) {
    dx[i] = Math.max(1e-6, p[i + 1]![0] - p[i]![0]);
    m[i] = (p[i + 1]![1] - p[i]![1]) / dx[i]!;
  }
  // Tangents (Fritsch–Carlson), so the curve keeps the points' ups and downs.
  const t: number[] = new Array(k).fill(0);
  t[0] = m[0] ?? 0;
  t[k - 1] = m[k - 2] ?? 0;
  for (let i = 1; i < k - 1; i++) {
    t[i] = m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2;
  }
  for (let i = 0; i < k - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i]! / m[i]!;
    const b = t[i + 1]! / m[i]!;
    const h = a * a + b * b;
    if (h > 9) {
      const s = 3 / Math.sqrt(h);
      t[i] = s * a * m[i]!;
      t[i + 1] = s * b * m[i]!;
    }
  }
  let seg = 0;
  for (let j = 0; j < n; j++) {
    const x = j / (n - 1);
    if (x <= p[0]![0]) {
      out[j] = p[0]![1];
      continue;
    }
    if (x >= p[k - 1]![0]) {
      out[j] = p[k - 1]![1];
      continue;
    }
    while (seg < k - 2 && x > p[seg + 1]![0]) seg++;
    const h = dx[seg]!;
    const u = (x - p[seg]![0]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    const y =
      (2 * u3 - 3 * u2 + 1) * p[seg]![1] +
      (u3 - 2 * u2 + u) * h * t[seg]! +
      (-2 * u3 + 3 * u2) * p[seg + 1]![1] +
      (u3 - u2) * h * t[seg + 1]!;
    out[j] = Math.min(1, Math.max(0, y));
  }
  return out;
}

/** The curves as one table: each channel through the RGB curve, then its own. */
function curveTable(a: PhotoAdjust): Uint8Array {
  const all = sampleCurve(a.curve?.rgb);
  const own = [sampleCurve(a.curve?.r), sampleCurve(a.curve?.g), sampleCurve(a.curve?.b)];
  const table = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = all[i]!;
    for (let c = 0; c < 3; c++) {
      const curve = own[c]!;
      const at = v * 255;
      const lo = Math.floor(at);
      const hi = Math.min(255, lo + 1);
      const y = curve[lo]! + (curve[hi]! - curve[lo]!) * (at - lo);
      table[i * 4 + c] = Math.round(y * 255);
    }
    table[i * 4 + 3] = 255;
  }
  return table;
}

// ── Color helpers for the uniforms ──

/** A hue's pure color, less its own brightness: the push a grading wheel gives. */
function gradeOffset(w: GradeWheel | undefined): [number, number, number, number] {
  if (!w || (!w.sat && !w.lum)) return [0, 0, 0, 0];
  const h = (((w.hue % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((h % 2) - 1);
  const [r, g, b] =
    h < 1
      ? [1, x, 0]
      : h < 2
        ? [x, 1, 0]
        : h < 3
          ? [0, 1, x]
          : h < 4
            ? [0, x, 1]
            : h < 5
              ? [x, 0, 1]
              : [1, 0, x];
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const k = (w.sat / 100) * 0.3;
  return [(r - l) * k, (g - l) * k, (b - l) * k, w.lum / 100];
}

// ── The graphics card ──

const VERTEX = `#version 300 es
in vec2 p;
out vec2 v;
void main() {
  v = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

/** Halves (or resizes) a picture, averaging four samples; `pack` keeps the darkest channel in alpha. */
const DOWN = `#version 300 es
precision highp float;
in vec2 v;
out vec4 o;
uniform sampler2D t;
uniform vec2 texel;
uniform bool pack;
void main() {
  vec4 a = texture(t, v + texel * vec2(-0.5, -0.5));
  vec4 b = texture(t, v + texel * vec2(0.5, -0.5));
  vec4 c = texture(t, v + texel * vec2(-0.5, 0.5));
  vec4 d = texture(t, v + texel * vec2(0.5, 0.5));
  if (pack) {
    a.a = min(a.r, min(a.g, a.b));
    b.a = min(b.r, min(b.g, b.b));
    c.a = min(c.r, min(c.g, c.b));
    d.a = min(d.r, min(d.g, d.b));
  }
  o = (a + b + c + d) * 0.25;
}`;

/** A 9-tap Gaussian blur along one direction. */
const BLUR = `#version 300 es
precision highp float;
in vec2 v;
out vec4 o;
uniform sampler2D t;
uniform vec2 step;
void main() {
  vec4 s = texture(t, v) * 0.2270270270;
  s += (texture(t, v + step * 1.3846153846) + texture(t, v - step * 1.3846153846)) * 0.3162162162;
  s += (texture(t, v + step * 3.2307692308) + texture(t, v - step * 3.2307692308)) * 0.0702702703;
  o = s;
}`;

const FINAL = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 v;
out vec4 o;
uniform sampler2D src;
uniform sampler2D fine;
uniform sampler2D mid;
uniform sampler2D large;
uniform sampler2D lut;
uniform vec2 px;
uniform float bright;      // sRGB multiplier (Eksposur)
uniform float contrast;    // -1..1
uniform float saturation;  // -1..1
uniform float warmth;      // -1..1
uniform float tint;        // -1..1
uniform float fadeAmt;     // 0..1
uniform bool mono;
uniform float highlights, shadows, whites, blacks;
uniform float vibrance;
uniform float textureAmt, clarity, dehaze;
uniform float sharpen, sharpRadius, noiseLum, noiseColor;
// Detail's finer controls, each 0–1, and a pixel step that grows with the photo.
uniform float noiseDetail, noiseContrast, colorDetail, colorSmooth, sharpDetail, sharpMask, spread;
uniform bool useCurve;
uniform bool useHsl;
uniform float bandHue[8];
uniform vec3 bandShift[8];
uniform bool useGrade;
uniform vec4 gradeS, gradeM, gradeH, gradeG;
uniform float blending, balance;
// The masks, four to a texture (one in each channel): up to eight.
uniform sampler2D maskPack0, maskPack1;
uniform int maskCount;
// Per mask: (exposure, contrast, highlights, shadows), (temp, tint, saturation, clarity),
// (dehaze, texture, –, –), (whites, blacks, sharpness, noise).
uniform vec4 mA[8], mB[8], mC[8], mD[8];
uniform sampler3D lut3d;
uniform bool useLut3d;
uniform float lutAmount, lutN;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  float h = 0.0;
  float s = 0.0;
  if (d > 1e-5) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}
float hue2rgb(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 h) {
  if (h.y <= 0.0) return vec3(h.z);
  float q = h.z < 0.5 ? h.z * (1.0 + h.y) : h.z + h.y - h.z * h.y;
  float p = 2.0 * h.z - q;
  return vec3(hue2rgb(p, q, h.x + 1.0 / 3.0), hue2rgb(p, q, h.x), hue2rgb(p, q, h.x - 1.0 / 3.0));
}
vec3 tap(vec2 d) { return texture(src, v + d * px).rgb; }

// A mask's own edit, the same formulas as the photo's.
vec3 localEdit(
  vec3 c, vec4 A, vec4 B, vec4 C, vec4 D, float L0, float midL, float fineL, float dark, float edge
) {
  // Noise: the small, noise-sized differences from a smoothed copy taken out
  // (edges, which differ more, stay).
  if (D.w > 0.0) {
    float d = L0 - fineL;
    c -= D.w * d * exp(-d * d * 900.0);
  }
  // Sharpness: the brightness pushed from (or, below 0, towards) a softened copy.
  c += D.z * clamp(edge, -0.25, 0.25) * (D.z > 0.0 ? 2.0 : 1.0);
  vec3 lin = pow(max(c, 0.0), vec3(2.2));
  lin *= vec3(1.0 + B.x * 0.32 + B.y * 0.1, 1.0 - B.y * 0.2, 1.0 - B.x * 0.32 + B.y * 0.1);
  c = pow(max(lin, 0.0), vec3(1.0 / 2.2));
  c *= 1.0 + A.x;
  c = (c - 0.5) * (1.0 + A.y) + 0.5;
  float L = luma(c);
  c += A.w * 0.35 * (1.0 - smoothstep(0.0, 0.55, L)) * (A.w > 0.0 ? 1.0 - L : L);
  c += A.z * 0.35 * smoothstep(0.4, 1.0, L) * (A.z > 0.0 ? 1.0 - L : L);
  c += D.x * 0.25 * smoothstep(0.5, 1.0, L);
  c += D.y * 0.2 * (1.0 - smoothstep(0.0, 0.45, L));
  float Lc = clamp(luma(c), 0.0, 1.0);
  c += B.w * (L0 - midL) * 1.4 * (1.0 - pow(abs(Lc - 0.5) * 2.0, 2.0));
  c += C.y * (L0 - fineL) * 2.2;
  if (C.x > 0.0) {
    float t = max(1.0 - C.x * 0.85 * dark, 0.25);
    c = (c - 0.95) / t + 0.95;
  } else if (C.x < 0.0) {
    c = mix(c, vec3(0.82), -C.x * 0.5);
  }
  float l = luma(c);
  return l + (c - l) * (1.0 + B.z);
}

void main() {
  vec4 s = texture(src, v);
  vec3 c = s.rgb;
  float L0 = luma(c);

  // Noise reduction, as in a photo editor. Luminance: the brightness averaged
  // with neighbors near it in brightness (edges stay: across one the brightness
  // jumps), over a reach that grows with the amount. Detail keeps finer texture
  // out of the average; Contrast gives back what stood out above the noise.
  if (noiseLum > 0.0) {
    float sig = (0.012 + noiseLum * 0.1) * (1.45 - noiseDetail * 1.1);
    float k = 1.0 / (2.0 * sig * sig);
    float reachL = spread * (0.8 + noiseLum * 1.4);
    float sum = L0;
    float wsum = 1.0;
    for (int y = -3; y <= 3; y++) {
      for (int x = -3; x <= 3; x++) {
        if (x == 0 && y == 0) continue;
        vec2 o = vec2(float(x), float(y));
        float l = luma(tap(o * reachL));
        float dl = l - L0;
        float w = exp(-dot(o, o) / 8.0) * exp(-dl * dl * k);
        sum += l * w;
        wsum += w;
      }
    }
    float even = sum / wsum;
    float lost = L0 - even;
    even += lost * noiseContrast * smoothstep(sig, sig * 3.0, abs(lost));
    c += mix(L0, even, min(1.0, noiseLum * 1.3)) - L0;
  }
  // Color: the color (not the brightness) averaged over a wider reach
  // (Smoothness), keeping to its own side of a brightness edge (Detail).
  if (noiseColor > 0.0) {
    float Lc = luma(c);
    vec3 chroma = c - Lc;
    vec3 csum = chroma;
    float wsum = 1.0;
    float reach = spread * (2.0 + colorSmooth * 12.0);
    float kd = 4.0 + colorDetail * colorDetail * 400.0;
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 2.39996;
      float r = reach * sqrt((float(i) + 0.5) / 16.0);
      vec3 n = tap(vec2(cos(a), sin(a)) * r);
      float ln = luma(n);
      float dl = ln - Lc;
      float w = exp(-dl * dl * kd);
      csum += (n - ln) * w;
      wsum += w;
    }
    c = Lc + mix(chroma, csum / wsum, min(1.0, noiseColor * 1.1));
  }
  // Sharpening: the brightness pushed away from a softened copy of itself.
  // Detail: low holds the push back (no halos), high lets fine texture through.
  // Masking: only where there are edges, the smooth parts (skin, sky) left alone.
  if (sharpen > 0.0) {
    vec3 b = (tap(vec2(sharpRadius, 0.0)) + tap(vec2(-sharpRadius, 0.0)) +
              tap(vec2(0.0, sharpRadius)) + tap(vec2(0.0, -sharpRadius))) * 0.25;
    float cap = mix(0.035, 0.45, sharpDetail);
    float push = clamp(luma(c) - luma(b), -cap, cap);
    if (sharpMask > 0.0) {
      float gx = luma(tap(vec2(spread, 0.0))) - luma(tap(vec2(-spread, 0.0)));
      float gy = luma(tap(vec2(0.0, spread))) - luma(tap(vec2(0.0, -spread)));
      float edge = length(vec2(gx, gy));
      float t = sharpMask * 0.22;
      push *= smoothstep(t * 0.4, t + 0.015, edge);
    }
    c += push * sharpen * 2.2;
  }

  // White balance, in linear light.
  vec3 lin = pow(max(c, 0.0), vec3(2.2));
  lin *= vec3(1.0 + warmth * 0.32 + tint * 0.1, 1.0 - tint * 0.2, 1.0 - warmth * 0.32 + tint * 0.1);
  c = pow(max(lin, 0.0), vec3(1.0 / 2.2));
  // Eksposur, as the older brightness: a multiplier on the picture.
  c *= bright;

  // Dehaze: the haze (the darkest channel, smoothed) taken out, or fog laid in.
  if (dehaze > 0.0) {
    float dark = texture(large, v).a * bright;
    float t = max(1.0 - dehaze * 0.85 * dark, 0.25);
    c = (c - 0.95) / t + 0.95;
    float l = luma(c);
    c = l + (c - l) * (1.0 + dehaze * 0.25);
  } else if (dehaze < 0.0) {
    c = mix(c, vec3(0.82), -dehaze * 0.5);
  }

  // Contrast, as the older one: stretched round the middle grey.
  c = (c - 0.5) * (1.0 + contrast) + 0.5;

  // Highlights, shadows, whites, blacks — by the brightness of the area around
  // (a smoothed copy), so a region lightens as a whole instead of flattening.
  if (highlights != 0.0 || shadows != 0.0 || whites != 0.0 || blacks != 0.0) {
    float area = luma(texture(large, v).rgb) * bright;
    float L = luma(c);
    float d = 0.0;
    float sm = 1.0 - smoothstep(0.0, 0.55, area);
    float hm = smoothstep(0.4, 1.0, area);
    d += shadows * 0.35 * sm * (shadows > 0.0 ? (1.0 - L) : L);
    d += highlights * 0.35 * hm * (highlights > 0.0 ? (1.0 - L) : L);
    d += whites * 0.25 * smoothstep(0.5, 1.0, L);
    d += blacks * 0.2 * (1.0 - smoothstep(0.0, 0.45, L));
    c += d;
  }

  // Clarity and texture: the difference from a smoothed copy, added back.
  if (clarity != 0.0) {
    float detail = L0 - luma(texture(mid, v).rgb);
    float L = clamp(luma(c), 0.0, 1.0);
    float midtones = 1.0 - pow(abs(L - 0.5) * 2.0, 2.0);
    c += clarity * detail * 1.4 * midtones;
  }
  if (textureAmt != 0.0) {
    float detail = L0 - luma(texture(fine, v).rgb);
    c += textureAmt * detail * 2.2;
  }

  // Masking: each mask's edit, as strongly as the mask covers here.
  if (maskCount > 0) {
    float midL = luma(texture(mid, v).rgb);
    float fineL = luma(texture(fine, v).rgb);
    float dark = texture(large, v).a;
    // A small unsharp difference, for the masks' Sharpness.
    vec3 soft = (tap(vec2(spread, 0.0)) + tap(vec2(-spread, 0.0)) +
                 tap(vec2(0.0, spread)) + tap(vec2(0.0, -spread))) * 0.25;
    float edge = L0 - luma(soft);
    vec4 w0 = texture(maskPack0, v);
    vec4 w1 = texture(maskPack1, v);
    for (int i = 0; i < 8; i++) {
      if (i >= maskCount) break;
      float w = i < 4 ? w0[i] : w1[i - 4];
      if (w > 0.0) {
        c = mix(c, localEdit(c, mA[i], mB[i], mC[i], mD[i], L0, midL, fineL, dark, edge), w);
      }
    }
  }

  c = clamp(c, 0.0, 1.0);

  // Kurva titik.
  if (useCurve) {
    c = vec3(
      texture(lut, vec2((c.r * 255.0 + 0.5) / 256.0, 0.5)).r,
      texture(lut, vec2((c.g * 255.0 + 0.5) / 256.0, 0.5)).g,
      texture(lut, vec2((c.b * 255.0 + 0.5) / 256.0, 0.5)).b
    );
  }

  // Pencampuran warna: each hue range's own hue, saturation and luminance.
  if (useHsl) {
    vec3 h = rgb2hsl(c);
    vec3 shift = vec3(0.0);
    float hue = h.x;
    for (int i = 0; i < 8; i++) {
      int j = i == 7 ? 0 : i + 1;
      float a0 = bandHue[i];
      float a1 = bandHue[j] + (j == 0 ? 1.0 : 0.0);
      float x = hue < a0 ? hue + 1.0 : hue;
      if (x >= a0 && x < a1) {
        float t = (x - a0) / (a1 - a0);
        t = t * t * (3.0 - 2.0 * t);
        shift = mix(bandShift[i], bandShift[j], t);
      }
    }
    float weight = smoothstep(0.02, 0.25, h.y);
    h.x = fract(h.x + shift.x * (30.0 / 360.0) * weight);
    h.y = clamp(h.y * (1.0 + shift.y * weight), 0.0, 1.0);
    h.z = clamp(h.z + shift.z * 0.2 * weight * h.y * (shift.z > 0.0 ? (1.0 - h.z) * 2.0 : h.z * 2.0), 0.0, 1.0);
    c = hsl2rgb(h);
  }

  // Vibrance (the dull colors more than the strong), then saturation as before.
  if (vibrance != 0.0) {
    float mx = max(max(c.r, c.g), c.b);
    float mn = min(min(c.r, c.g), c.b);
    float sat = mx - mn;
    float l = luma(c);
    float amount = vibrance > 0.0 ? vibrance * (1.0 - sat) * 1.3 : vibrance;
    c = l + (c - l) * (1.0 + amount);
  }
  if (saturation != 0.0 && !mono) {
    float l = luma(c);
    c = l + (c - l) * (1.0 + saturation);
  }

  // Color grading: a tint in the shadows, midtones and highlights, and over all.
  if (useGrade) {
    float L = clamp(luma(c) + balance * 0.25, 0.0, 1.0);
    float spread = 1.0 + (1.0 - blending) * 2.5;
    float ws = pow(1.0 - L, spread);
    float wh = pow(L, spread);
    float wm = clamp(1.0 - ws - wh, 0.0, 1.0);
    c += gradeS.rgb * ws + gradeM.rgb * wm + gradeH.rgb * wh + gradeG.rgb;
    c += (gradeS.a * ws + gradeM.a * wm + gradeH.a * wh + gradeG.a) * 0.25;
  }

  // LUT (.cube): the whole look from a table, as strongly as asked.
  if (useLut3d) {
    vec3 q = (clamp(c, 0.0, 1.0) * (lutN - 1.0) + 0.5) / lutN;
    c = mix(c, texture(lut3d, q).rgb, lutAmount);
  }

  if (mono) c = vec3(luma(c));

  // Pudar, as before: a grey screened over the picture, lifting the blacks.
  if (fadeAmt > 0.0) c = c + fadeAmt * 0.35 * 0.42 * (1.0 - c);

  c = clamp(c, 0.0, 1.0);
  o = vec4(c * s.a, s.a);
}`;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

interface Engine {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  down: WebGLProgram;
  blur: WebGLProgram;
  final: WebGLProgram;
  buffer: WebGLBuffer;
  lut: WebGLTexture;
  blank: WebGLTexture;
  blank3d: WebGLTexture;
  max: number;
  /** The most the GPU takes, for a download at full resolution. */
  fullMax: number;
}

let engine: Engine | null | undefined;

function compile(gl: WebGL2RenderingContext, fragment: string): WebGLProgram | null {
  const make = (type: number, code: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, code);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error(gl.getShaderInfoLog(sh));
      return null;
    }
    return sh;
  };
  const vs = make(gl.VERTEX_SHADER, VERTEX);
  const fs = make(gl.FRAGMENT_SHADER, fragment);
  if (!vs || !fs) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

function texture(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function getEngine(): Engine | null {
  if (engine !== undefined && (!engine || !engine.gl.isContextLost())) return engine;
  engine = null;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    antialias: false,
  });
  if (!gl) return null;
  const down = compile(gl, DOWN);
  const blur = compile(gl, BLUR);
  const final = compile(gl, FINAL);
  if (!down || !blur || !final) return null;
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const blank = texture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  const blank3d = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_3D, blank3d);
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,
    gl.RGBA,
    1,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array(4),
  );
  engine = {
    canvas,
    gl,
    down,
    blur,
    final,
    buffer,
    lut: texture(gl),
    blank,
    blank3d,
    max: Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number),
    fullMax: Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE) as number),
  };
  return engine;
}

function target(gl: WebGL2RenderingContext, w: number, h: number): Target {
  const tex = texture(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo, w, h };
}

function draw(e: Engine, program: WebGLProgram, out: Target | null, w: number, h: number) {
  const { gl } = e;
  gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fbo : null);
  gl.viewport(0, 0, w, h);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, e.buffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/**
 * A smoothed copy of the photo whose long side is `long` pixels: halved
 * (averaging) until close, then blurred a little — its darkest channel kept
 * in alpha for dehaze.
 */
function level(e: Engine, src: Target, long: number, made: Target[]): Target {
  const { gl } = e;
  let cur = src;
  let first = true;
  const step = (w: number, h: number) => {
    const next = target(gl, Math.max(1, w), Math.max(1, h));
    made.push(next);
    gl.useProgram(e.down);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cur.tex);
    gl.uniform1i(gl.getUniformLocation(e.down, 't'), 0);
    gl.uniform2f(gl.getUniformLocation(e.down, 'texel'), 1 / cur.w, 1 / cur.h);
    gl.uniform1i(gl.getUniformLocation(e.down, 'pack'), first ? 1 : 0);
    draw(e, e.down, next, next.w, next.h);
    first = false;
    cur = next;
  };
  const scale = long / Math.max(src.w, src.h);
  const tw = Math.max(1, Math.round(src.w * scale));
  const th = Math.max(1, Math.round(src.h * scale));
  while (cur.w / 2 >= tw && cur.h / 2 >= th) step(Math.round(cur.w / 2), Math.round(cur.h / 2));
  if (first || cur.w !== tw || cur.h !== th) step(tw, th);
  for (const dir of [
    [1, 0],
    [0, 1],
  ]) {
    const next = target(gl, cur.w, cur.h);
    made.push(next);
    gl.useProgram(e.blur);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cur.tex);
    gl.uniform1i(gl.getUniformLocation(e.blur, 't'), 0);
    gl.uniform2f(gl.getUniformLocation(e.blur, 'step'), dir[0]! / cur.w, dir[1]! / cur.h);
    draw(e, e.blur, next, next.w, next.h);
    cur = next;
  }
  return cur;
}

/** The picture last developed, on the card with its softened copies (see `run`). */
let held: {
  source: CanvasImageSource;
  w: number;
  h: number;
  src: Target;
  levels: Map<number, Target>;
  keep: Target[];
} | null = null;
function dropTarget(gl: WebGL2RenderingContext, t: Target) {
  gl.deleteFramebuffer(t.fbo);
  gl.deleteTexture(t.tex);
}

function run(
  e: Engine,
  source: CanvasImageSource,
  w: number,
  h: number,
  a: PhotoAdjust,
  /** The picture as it came (`source` may be it made smaller): the ranges are read from it. */
  original: CanvasImageSource,
) {
  const { gl, canvas } = e;
  const made: Target[] = [];
  // The photo on the card, and its softened copies: the same picture at the
  // same size as last time (a slider moving) uses them again, uploaded once.
  if (!held || held.source !== source || held.w !== w || held.h !== h) {
    if (held) for (const t of held.keep) dropTarget(gl, t);
    const fresh = target(gl, w, h);
    gl.bindTexture(gl.TEXTURE_2D, fresh.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    held = { source, w, h, src: fresh, levels: new Map(), keep: [fresh] };
  }
  const kept = held;
  const src = kept.src;
  const softened = (size: number) => {
    const hit = kept.levels.get(size);
    if (hit) return hit;
    const steps: Target[] = [];
    const t = level(e, src, size, steps);
    // Only the result stays; the steps to it go.
    for (const x of steps) if (x !== t) dropTarget(gl, x);
    kept.levels.set(size, t);
    kept.keep.push(t);
    return t;
  };

  const long = Math.max(w, h);
  const live = liveMasks(a);
  const byMask = (k: 'texture' | 'clarity' | 'dehaze') => live.some((m) => m.adjust[k]);
  const fine =
    a.texture || a.colorNoise || byMask('texture') ? softened(Math.min(long, 1000)) : null;
  const mid = a.clarity || byMask('clarity') ? softened(Math.min(long, 100)) : null;
  const large =
    a.dehaze || a.highlights || a.shadows || a.whites || a.blacks || byMask('dehaze')
      ? softened(Math.min(long, 48))
      : null;

  const p = e.final;
  gl.useProgram(p);
  const u = (name: string) => gl.getUniformLocation(p, name);
  const bind = (unit: number, name: string, tex: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(u(name), unit);
  };
  bind(0, 'src', src.tex);
  bind(1, 'fine', fine?.tex ?? e.blank);
  bind(2, 'mid', mid?.tex ?? e.blank);
  bind(3, 'large', large?.tex ?? e.blank);
  const curve = (['rgb', 'r', 'g', 'b'] as const).some((k) => curveBends(a.curve?.[k]));
  if (curve) {
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, e.lut);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, curveTable(a));
    gl.uniform1i(u('lut'), 4);
  } else bind(4, 'lut', e.blank);

  // The LUT as a 3D texture, made once per LUT and graphics context.
  const cube = a.lut && lutActive(a) ? luts.get(a.lut.id)! : null;
  gl.activeTexture(gl.TEXTURE5);
  if (cube) {
    if (!cube.tex || cube.engine !== e) {
      cube.tex = gl.createTexture()!;
      cube.engine = e;
      gl.bindTexture(gl.TEXTURE_3D, cube.tex);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const wrap of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R])
        gl.texParameteri(gl.TEXTURE_3D, wrap, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.RGBA,
        cube.size,
        cube.size,
        cube.size,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        cube.data,
      );
    }
    gl.bindTexture(gl.TEXTURE_3D, cube.tex);
  } else gl.bindTexture(gl.TEXTURE_3D, e.blank3d);
  gl.uniform1i(u('lut3d'), 5);
  gl.uniform1i(u('useLut3d'), cube ? 1 : 0);
  gl.uniform1f(u('lutAmount'), (a.lut?.amount ?? 100) / 100);
  gl.uniform1f(u('lutN'), cube?.size ?? 2);

  const n = (v: number | undefined) => (v ?? 0) / 100;
  // Pixels from edge to edge for sharpening and noise: a bigger photo, a wider reach.
  const unit = Math.max(1, long / 2000);
  gl.uniform2f(u('px'), 1 / w, 1 / h);
  gl.uniform1f(u('bright'), 1 + n(a.brightness));
  gl.uniform1f(u('contrast'), n(a.contrast));
  gl.uniform1f(u('saturation'), n(a.saturation));
  gl.uniform1f(u('warmth'), a.mono ? 0 : n(a.warmth));
  gl.uniform1f(u('tint'), a.mono ? 0 : n(a.tint));
  gl.uniform1f(u('fadeAmt'), n(a.fade));
  gl.uniform1i(u('mono'), a.mono ? 1 : 0);
  gl.uniform1f(u('highlights'), n(a.highlights));
  gl.uniform1f(u('shadows'), n(a.shadows));
  gl.uniform1f(u('whites'), n(a.whites));
  gl.uniform1f(u('blacks'), n(a.blacks));
  gl.uniform1f(u('vibrance'), n(a.vibrance));
  gl.uniform1f(u('textureAmt'), n(a.texture));
  gl.uniform1f(u('clarity'), n(a.clarity));
  gl.uniform1f(u('dehaze'), n(a.dehaze));
  gl.uniform1f(u('sharpen'), n(a.sharpen));
  gl.uniform1f(u('sharpRadius'), (0.6 + n(a.sharpenRadius ?? 30) * 2.4) * unit);
  gl.uniform1f(u('noiseLum'), n(a.noise));
  gl.uniform1f(u('noiseColor'), n(a.colorNoise));
  gl.uniform1f(u('noiseDetail'), n(a.noiseDetail ?? 50));
  gl.uniform1f(u('noiseContrast'), n(a.noiseContrast));
  gl.uniform1f(u('colorDetail'), n(a.colorNoiseDetail ?? 50));
  gl.uniform1f(u('colorSmooth'), n(a.colorNoiseSmooth ?? 50));
  gl.uniform1f(u('sharpDetail'), n(a.sharpenDetail ?? 25));
  gl.uniform1f(u('sharpMask'), n(a.sharpenMasking));
  gl.uniform1f(u('spread'), unit);
  gl.uniform1i(u('useCurve'), curve ? 1 : 0);
  const hsl = hslActive(a);
  gl.uniform1i(u('useHsl'), hsl ? 1 : 0);
  if (hsl) {
    gl.uniform1fv(
      u('bandHue'),
      COLOR_BANDS.map((b) => b.hue / 360),
    );
    gl.uniform3fv(
      u('bandShift'),
      COLOR_BANDS.flatMap((b) => {
        const s = a.hsl?.[b.id];
        return [n(s?.h), n(s?.s), n(s?.l)];
      }),
    );
  }
  const grade = gradeActive(a);
  gl.uniform1i(u('useGrade'), grade ? 1 : 0);
  if (grade) {
    gl.uniform4fv(u('gradeS'), gradeOffset(a.grade?.shadows));
    gl.uniform4fv(u('gradeM'), gradeOffset(a.grade?.midtones));
    gl.uniform4fv(u('gradeH'), gradeOffset(a.grade?.highlights));
    gl.uniform4fv(u('gradeG'), gradeOffset(a.grade?.global));
    gl.uniform1f(u('blending'), (a.grade?.blending ?? 50) / 100);
    gl.uniform1f(u('balance'), n(a.grade?.balance));
  }

  // The masks over the picture (flipped as the picture is), four to a texture:
  // each mask's coverage in one channel of it.
  const maskTex: WebGLTexture[] = [];
  const A: number[] = [];
  const B: number[] = [];
  const C: number[] = [];
  const D: number[] = [];
  const rasters: { data: Uint8Array; w: number; h: number }[] = [];
  for (const m of live) {
    const raster = maskRaster(m, h / w, original);
    const data = raster && coverageOf(raster);
    if (!raster || !data) continue;
    rasters.push({ data, w: raster.width, h: raster.height });
    const l = m.adjust;
    A.push(n(l.exposure), n(l.contrast), n(l.highlights), n(l.shadows));
    B.push(n(l.temp), n(l.tint), n(l.saturation), n(l.clarity));
    C.push(n(l.dehaze), n(l.texture), 0, 0);
    D.push(n(l.whites), n(l.blacks), n(l.sharpness), n(l.noise));
  }
  for (let pack = 0; pack < 2; pack++) {
    gl.activeTexture(gl.TEXTURE6 + pack);
    gl.uniform1i(u(`maskPack${pack}`), 6 + pack);
    const group = rasters.slice(pack * 4, pack * 4 + 4);
    if (!group.length) {
      gl.bindTexture(gl.TEXTURE_2D, e.blank);
      continue;
    }
    // Every mask of a photo is the same size (`maskRaster`).
    const { w: mw, h: mh } = group[0]!;
    const packed = new ImageData(mw, mh);
    const out = packed.data;
    group.forEach((r, ch) => {
      for (let p = 0; p < mw * mh; p++) out[p * 4 + ch] = r.data[p]!;
    });
    maskTex.push(texture(gl));
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, packed);
  }
  for (let i = rasters.length; i < MAX_MASKS; i++) {
    A.push(0, 0, 0, 0);
    B.push(0, 0, 0, 0);
    C.push(0, 0, 0, 0);
    D.push(0, 0, 0, 0);
  }
  gl.uniform1i(u('maskCount'), rasters.length);
  gl.uniform4fv(u('mA'), A);
  gl.uniform4fv(u('mB'), B);
  gl.uniform4fv(u('mC'), C);
  gl.uniform4fv(u('mD'), D);

  canvas.width = w;
  canvas.height = h;
  draw(e, p, null, w, h);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')?.drawImage(canvas, 0, 0);

  for (const t of made) {
    gl.deleteFramebuffer(t.fbo);
    gl.deleteTexture(t.tex);
  }
  for (const t of maskTex) gl.deleteTexture(t);
  return out;
}

/**
 * Developed photos, by the picture and the settings — the latest ones, as
 * sliders move. Kept by size, not count: a few full-size photos, or many
 * small previews, never hundreds of megabytes.
 */
const results = new WeakMap<object, Map<string, HTMLCanvasElement>>();
const order: { source: WeakRef<object>; key: string; pixels: number }[] = [];
/** About 160 MB of pictures. */
const KEEP_PIXELS = 40_000_000;
const KEEP_MAX = 48;
let kept = 0;

/** Develop settings only (blur, grain and vignette are drawn over the shown photo instead). */
function developKey(a: PhotoAdjust, w: number, h: number) {
  const rest: Partial<PhotoAdjust> = { ...a };
  delete rest.blur;
  delete rest.grain;
  delete rest.grainSize;
  delete rest.grainRough;
  delete rest.vignette;
  // Whether its LUT is read yet: once it is, the photo is developed again with it.
  // …and whether each subject mask is read yet.
  const read = (a.masks ?? [])
    .flatMap(maskParts)
    .map((p) => (p.subject ? hasMaskImage(p.subject) : ''))
    .join();
  // …and whether its AI Denoise result is read yet.
  const clean = a.denoise ? hasDenoised(a.denoise.id) : '';
  // …and which drawing of its RAW is there.
  const r = a.raw && rawRenders.get(a.raw.id);
  const drawn = r ? `${r.kelvin}/${r.tint}` : '';
  return `${w}x${h}|${JSON.stringify(rest)}|${a.lut ? lutActive(a) : ''}|${read}|${clean}|${drawn}`;
}

/**
 * `source` developed as `a` says, as a canvas — at the picture's own size, up
 * to 4096 pixels on the long side — or null when there is nothing to develop
 * or this browser cannot.
 */
/**
 * The picture at w × h, made once: while a slider moves only the settings
 * change, so the same smaller copy goes to the graphics card each time
 * instead of shrinking a large photo again. The latest size per picture.
 */
const shrunkCopies = new WeakMap<object, { w: number; h: number; canvas: HTMLCanvasElement }>();
function shrunkOf(base: CanvasImageSource, w: number, h: number) {
  const hit = shrunkCopies.get(base as object);
  if (hit && hit.w === w && hit.h === h) return hit.canvas;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const c = canvas.getContext('2d');
  if (!c) return null;
  c.imageSmoothingQuality = 'high';
  c.drawImage(base, 0, 0, w, h);
  shrunkCopies.set(base as object, { w, h, canvas });
  return canvas;
}

/** Downloads at full resolution: the photos developed as large as the GPU allows. */
let fullSize = false;
export function setDevelopFullSize(on: boolean) {
  fullSize = on;
  // A download's full-size photo does not stay on the card after it.
  if (!on && held && Math.max(held.w, held.h) > 4096) {
    const gl = getEngine()?.gl;
    if (gl) for (const t of held.keep) dropTarget(gl, t);
    held = null;
  }
}
/** At most this many pixels a photo, developed for a download (some 36 MP). */
const FULL_PIXELS = 36_000_000;

export function developed(
  source: HTMLImageElement | HTMLCanvasElement,
  a: PhotoAdjust | undefined,
  /** At most this large (a preview while a slider moves); the engine's own size unless asked. */
  maxSide?: number,
): HTMLCanvasElement | null {
  if (!a || !needsDevelop(a)) return null;
  const e = getEngine();
  if (!e) return null;
  const iw =
    source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
  const ih =
    source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;
  if (!iw || !ih) return null;
  const k = fullSize
    ? Math.min(1, e.fullMax / Math.max(iw, ih), Math.sqrt(FULL_PIXELS / (iw * ih)))
    : Math.min(1, Math.min(e.max, maxSide ?? Infinity) / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * k));
  const h = Math.max(1, Math.round(ih * k));
  const key = developKey(a, w, h);
  let byKey = results.get(source);
  const hit = byKey?.get(key);
  if (hit) return hit;
  // A RAW is developed from its drawing at the white balance asked.
  const base: CanvasImageSource = rawBase({ width: iw, height: ih }, a) ?? source;
  let input: CanvasImageSource = base;
  const clean = denoisedInput(base, a, w, h);
  if (clean) input = clean;
  else if (k < 1 || base !== source) {
    const shrunk = shrunkOf(base, w, h);
    if (!shrunk) return null;
    input = shrunk;
  }
  let out: HTMLCanvasElement;
  try {
    out = run(e, input, w, h, a, source);
  } catch (err) {
    console.error('develop', err);
    return null;
  }
  if (!byKey) {
    byKey = new Map();
    results.set(source, byKey);
  }
  byKey.set(key, out);
  order.push({ source: new WeakRef(source), key, pixels: w * h });
  kept += w * h;
  // The newest always stays: it is the one being shown.
  while (order.length > 1 && (kept > KEEP_PIXELS || order.length > KEEP_MAX)) {
    const old = order.shift()!;
    kept -= old.pixels;
    results.get(old.source.deref() ?? {})?.delete(old.key);
  }
  return out;
}

// ── Auto, and the white balance pipette ──

/**
 * Auto: Exposure, Contrast, Highlights, Shadows, Whites, Blacks and Vibrance
 * worked out from the picture's own brightness spread, as a photo editor's
 * Auto does — the middle brought to a mid grey, the ends stretched without
 * clipping, flat pictures given some contrast and color. Null if it cannot
 * be read.
 */
export function autoAdjust(img: HTMLImageElement | HTMLCanvasElement): Partial<PhotoAdjust> | null {
  if (typeof document === 'undefined') return null;
  const iw = img instanceof HTMLImageElement ? img.naturalWidth || img.width : img.width;
  const ih = img instanceof HTMLImageElement ? img.naturalHeight || img.height : img.height;
  if (!iw || !ih) return null;
  const k = Math.min(1, 256 / Math.max(iw, ih));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(iw * k));
  c.height = Math.max(1, Math.round(ih * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  let data: Uint8ClampedArray;
  try {
    ctx.drawImage(img, 0, 0, c.width, c.height);
    data = ctx.getImageData(0, 0, c.width, c.height).data;
  } catch {
    return null;
  }
  const lum: number[] = [];
  let chroma = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 128) continue; // a cut-out's see-through part says nothing
    const r = data[i]! / 255;
    const g = data[i + 1]! / 255;
    const b = data[i + 2]! / 255;
    lum.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    chroma += Math.max(r, g, b) - Math.min(r, g, b);
  }
  if (lum.length < 16) return null;
  lum.sort((a, b) => a - b);
  const at = (q: number) => lum[Math.min(lum.length - 1, Math.floor(q * lum.length))]!;
  const mean = lum.reduce((a, b) => a + b, 0) / lum.length;
  const std = Math.sqrt(lum.reduce((a, b) => a + (b - mean) * (b - mean), 0) / lum.length);
  const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));

  // Exposure: the median to a mid grey (it multiplies, as Eksposur does).
  const m = Math.min(1.7, Math.max(0.65, 0.46 / Math.max(0.02, at(0.5))));
  const brightness = clamp((m - 1) * 100, -35, 60);
  const e = 1 + brightness / 100;
  const p01 = at(0.01) * e;
  const p10 = at(0.1) * e;
  const p95 = Math.min(1, at(0.95) * e);
  const p99 = Math.min(1, at(0.99) * e);
  const highlights = p95 > 0.88 ? -clamp((p95 - 0.82) * 260, 0, 70) : 0;
  const shadows = p10 < 0.14 ? clamp((0.17 - p10) * 300, 0, 55) : 0;
  const whites = p99 < 0.93 ? clamp((0.97 - p99) * 160, 0, 40) : p99 >= 0.999 ? -12 : 0;
  const blacks = p01 > 0.05 ? -clamp((p01 - 0.03) * 320, 0, 40) : p01 <= 0.002 ? 8 : 0;
  const contrast = clamp((0.22 / Math.max(0.05, std * e) - 1) * 35, -15, 25);
  const vibrance = clamp((0.24 - chroma / lum.length) * 120, 0, 25);
  return { brightness, contrast, highlights, shadows, whites, blacks, vibrance };
}

/**
 * The white balance that turns this color (sRGB 0–255, a spot that should be
 * white or grey) neutral: Temp and Tint, −100…100, as the develop shader
 * applies them (a gain per channel in linear light).
 */
export function neutralBalance(r: number, g: number, b: number): { warmth: number; tint: number } {
  const lin = (v: number) => Math.pow(Math.max(1, v) / 255, 2.2);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  // Gains (1 + .32w + .1t, 1 − .2t, 1 − .32w + .1t) make R, G and B equal.
  const s = G / R + G / B;
  const t = (s - 2) / (0.2 * (1 + s));
  const w = ((G / R - G / B) * (1 - 0.2 * t)) / 0.64;
  const clamp = (v: number) => Math.round(Math.min(100, Math.max(-100, v * 100)));
  return { warmth: clamp(w), tint: clamp(t) };
}
