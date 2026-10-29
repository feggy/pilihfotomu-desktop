/**
 * Clean edges for a cut-out: no light (or dark) rim of the old background.
 * A pixel on the edge is part subject, part background; left as it is, its
 * color still carries the background (the white halo round a logo taken off
 * white). Here each one is split again: how much of it is the background
 * (its alpha) and what the subject's color is without it — GIMP's "color to
 * alpha", against the background color around that pixel.
 */

type RGB = [number, number, number];

export interface EdgeOptions {
  /** The background's one color (a logo on a plain color); otherwise read from around each edge pixel. */
  bg?: RGB;
  /** Tighten a soft model mask first, so its faint outer rim goes. */
  choke?: boolean;
}

/** How solid `c` is over `b` (GIMP's color to alpha). */
function unmix(c: RGB, b: RGB): number {
  let a = 0;
  for (let k = 0; k < 3; k++) {
    const d = c[k]! - b[k]!;
    const ch = d > 0 ? (b[k]! < 255 ? d / (255 - b[k]!) : 0) : d < 0 ? (b[k]! > 0 ? -d / b[k]! : 0) : 0;
    if (ch > a) a = ch;
  }
  return Math.min(1, a);
}

/**
 * `cut` (the subject, see-through around it) cleaned in place, its edge
 * colors read from `src`, the picture uncut at the same size.
 */
export function cleanEdges(cut: ImageData, src: Uint8ClampedArray, opts: EdgeOptions = {}) {
  const { width: w, height: h, data: d } = cut;
  const n = w * h;
  if (opts.choke) {
    // A model's mask fades over a few pixels; its faintest part is mostly background.
    for (let i = 0; i < n; i++) {
      const a = d[i * 4 + 3]! / 255;
      d[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, (a - 0.15) / 0.7)) * 255);
    }
  }
  // The edge: kept pixels within `ring` steps of a see-through one.
  const ring = Math.min(6, Math.max(3, Math.round(Math.max(w, h) / 500)));
  const depth = new Uint8Array(n);
  let wave: number[] = [];
  for (let i = 0; i < n; i++) {
    if (d[i * 4 + 3] === 0) continue;
    const x = i % w;
    if ((x > 0 && d[(i - 1) * 4 + 3] === 0) || (x < w - 1 && d[(i + 1) * 4 + 3] === 0) || (i >= w && d[(i - w) * 4 + 3] === 0) || (i < n - w && d[(i + w) * 4 + 3] === 0)) {
      depth[i] = 1;
      wave.push(i);
    }
  }
  const edge = [...wave];
  for (let step = 2; step <= ring && wave.length; step++) {
    const next: number[] = [];
    for (const i of wave) {
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || depth[j] || d[j * 4 + 3] === 0) continue;
        depth[j] = step;
        next.push(j);
      }
    }
    edge.push(...next);
    wave = next;
  }

  // Around each edge pixel, the background it sat on: the uncut picture where the cut-out is see-through.
  const reach = ring + 3;
  const stride = reach > 4 ? 2 : 1;
  const alphas = new Map<number, number>();
  for (const i of edge) {
    const c: RGB = [src[i * 4]!, src[i * 4 + 1]!, src[i * 4 + 2]!];
    let b = opts.bg;
    if (!b) {
      const x0 = i % w, y0 = (i / w) | 0;
      let r = 0, g = 0, bl = 0, k = 0;
      for (let y = Math.max(0, y0 - reach); y <= Math.min(h - 1, y0 + reach); y += stride)
        for (let x = Math.max(0, x0 - reach); x <= Math.min(w - 1, x0 + reach); x += stride) {
          const j = y * w + x;
          if (d[j * 4 + 3] !== 0) continue;
          r += src[j * 4]!;
          g += src[j * 4 + 1]!;
          bl += src[j * 4 + 2]!;
          k++;
        }
      if (!k) continue;
      b = [r / k, g / k, bl / k];
    }
    // The outermost pixels are judged by color alone; deeper in, the mask is trusted more, so a
    // subject the color of the background (a white shirt on a white wall) keeps its edge.
    const trust = ((depth[i]! - 1) / ring) ** 2;
    const a0 = unmix(c, b);
    const alpha = Math.min(d[i * 4 + 3]! / 255, a0 + trust * (1 - a0));
    // Alphas are set after every pixel is read: only what was see-through before counts as background.
    alphas.set(i, alpha);
    if (alpha <= 0.004) continue;
    // The subject's own color: what is left of the pixel once its share of background is taken out.
    for (let k = 0; k < 3; k++) d[i * 4 + k] = Math.min(255, Math.max(0, b[k]! + (c[k]! - b[k]!) / alpha));
  }
  for (const [i, alpha] of alphas) d[i * 4 + 3] = Math.round(alpha * 255);
}
