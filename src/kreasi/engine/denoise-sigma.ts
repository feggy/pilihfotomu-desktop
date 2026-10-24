/**
 * How noisy a photo is, as the σ (0–255) to ask the model for.
 *
 * Measured where the photo is flat: in blocks of 32 px, each channel's noise
 * is read with Immerkær's filter (a Laplacian-like kernel) at the pixel and on
 * a copy half the size, the block keeping its worst; the flattest quarter of
 * the blocks — no texture there, only noise — gives the level. Texture never
 * reads as noise that way (a sharp ISO 100 photo stays near 1).
 *
 * Camera noise clings to its neighbours — demosaicing a RAW spreads each
 * grain over a few pixels, JPEG too — so at the pixel it reads small; at half
 * size it shows (the half-size reading about 1.9× the pixel's). Such noise
 * is asked for at 1.25× its level — tried on a Sony ISO 6400 RAW at full size:
 * level 12.4 → σ 15.5, clean with hair kept (σ 25 turned skin waxy; the old
 * whole-photo brightness estimate said 5.5 and cleaned nothing); ISO 100–160
 * RAWs ≈ 3.6, left as they are. Noise pixel by pixel (both readings alike)
 * reads low through JPEG, and is asked for at up to 1.6× — between the two,
 * in proportion.
 */
export function estimateSigma(px: Uint8ClampedArray, w: number, h: number) {
  const B = 32;
  const cols = Math.floor(w / B);
  const rows = Math.floor(h / B);
  if (!cols || !rows) return 3;
  // Some 3000 blocks are plenty, spread over the whole photo.
  const every = Math.max(1, Math.round(Math.sqrt((cols * rows) / 3000)));
  const K = Math.sqrt(Math.PI / 2) / 6;
  const half = new Float32Array((B / 2) * (B / 2));
  const lap = (g: (x: number, y: number) => number, x: number, y: number) =>
    Math.abs(
      g(x - 1, y - 1) -
        2 * g(x, y - 1) +
        g(x + 1, y - 1) -
        2 * g(x - 1, y) +
        4 * g(x, y) -
        2 * g(x + 1, y) +
        g(x - 1, y + 1) -
        2 * g(x, y + 1) +
        g(x + 1, y + 1),
    );
  const blocks: { level: number; pixel: number; halfSize: number }[] = [];
  for (let by = 0; by < rows; by += every) {
    for (let bx = 0; bx < cols; bx += every) {
      const x0 = bx * B;
      const y0 = by * B;
      let worst = { level: 0, pixel: 0, halfSize: 0 };
      for (let c = 0; c < 3; c++) {
        const at = (x: number, y: number) => px[((y0 + y) * w + x0 + x) * 4 + c]!;
        let s = 0;
        for (let y = 1; y < B - 1; y++) for (let x = 1; x < B - 1; x++) s += lap(at, x, y);
        const pixel = (K * s) / ((B - 2) * (B - 2));
        // The block at half size (each pixel the mean of 2×2).
        const H = B / 2;
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < H; x++) {
            half[y * H + x] =
              (at(2 * x, 2 * y) +
                at(2 * x + 1, 2 * y) +
                at(2 * x, 2 * y + 1) +
                at(2 * x + 1, 2 * y + 1)) /
              4;
          }
        }
        const atHalf = (x: number, y: number) => half[y * H + x]!;
        let t = 0;
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < H - 1; x++) t += lap(atHalf, x, y);
        // ×2: noise pixel by pixel reads half as much at half size.
        const halfSize = (2 * K * t) / ((H - 2) * (H - 2));
        const level = Math.max(pixel, halfSize);
        if (level > worst.level) worst = { level, pixel, halfSize };
      }
      blocks.push(worst);
    }
  }
  blocks.sort((a, b) => a.level - b.level);
  // The flattest quarter: its top is the level (flat enough to be texture-free,
  // not the rare dead-flat block); all of it says how much the noise clings.
  const flat = blocks.slice(0, Math.max(1, Math.floor(blocks.length / 4)));
  const level = flat[flat.length - 1]!.level;
  const pixel = flat.reduce((a, b) => a + b.pixel, 0);
  const halfSize = flat.reduce((a, b) => a + b.halfSize, 0);
  const clings = halfSize / Math.max(1e-6, pixel);
  const factor = Math.min(1.6, Math.max(1.25, 1.25 + (1.9 - clings) * 0.4));
  // A clean photo stays as it was; the model knows up to 75.
  return Math.min(60, Math.max(3, level * factor));
}
