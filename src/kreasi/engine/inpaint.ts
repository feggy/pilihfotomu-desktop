/**
 * Hapus objek: the marked part of a picture filled in from its surroundings,
 * in this browser — nothing is sent anywhere, nothing is downloaded.
 *
 * It is the classic way photo editors did it before AI fills (Wexler et al.,
 * with PatchMatch): the hole is first washed in from its edge on a very small
 * copy, then, size by size up to the working size, every small square around
 * the hole is matched to the most alike square of the untouched picture and
 * the hole takes the average of what those squares say. Good for small things
 * — a passer-by, a sign, a spot, a stray hair — on texture, grass, sky, walls;
 * a big hole over detail comes out soft.
 *
 * Only a region round the marks is worked on, at most `MAX_SIDE` pixels
 * across, and put back into the picture with a soft edge.
 */

/** The longest side of the region solved; bigger regions are solved smaller and scaled back. */
const MAX_SIDE = 600;

interface Level {
  w: number;
  h: number;
  /** RGBA, 0–255, as floats. */
  px: Float32Array;
  /** 1: to fill. */
  hole: Uint8Array;
}

/**
 * Fills `mask` (one byte a pixel, non-zero = fill) of `img` in place.
 * Returns false when nothing was marked.
 */
export function inpaint(img: ImageData, mask: Uint8Array): boolean {
  const { width: W, height: H } = img;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (mask[y * W + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return false;

  // The region: the marks and enough around them to borrow from.
  const margin = Math.max(24, Math.round(Math.max(x1 - x0, y1 - y0) * 0.9));
  const rx = Math.max(0, x0 - margin);
  const ry = Math.max(0, y0 - margin);
  const rw = Math.min(W, x1 + margin + 1) - rx;
  const rh = Math.min(H, y1 + margin + 1) - ry;
  const k = Math.min(1, MAX_SIDE / Math.max(rw, rh));
  const sw = Math.max(8, Math.round(rw * k));
  const sh = Math.max(8, Math.round(rh * k));

  // The region at the working size (box-averaged down), and its hole.
  const base: Level = {
    w: sw,
    h: sh,
    px: new Float32Array(sw * sh * 4),
    hole: new Uint8Array(sw * sh),
  };
  const sums = new Float32Array(sw * sh * 4);
  const counts = new Float32Array(sw * sh);
  const holeHits = new Uint8Array(sw * sh);
  for (let y = 0; y < rh; y++) {
    const ty = Math.min(sh - 1, Math.floor(y * k));
    for (let x = 0; x < rw; x++) {
      const tx = Math.min(sw - 1, Math.floor(x * k));
      const t = ty * sw + tx;
      const s = (ry + y) * W + (rx + x);
      if (mask[s]) {
        holeHits[t] = 1;
        continue;
      }
      for (let c = 0; c < 4; c++) sums[t * 4 + c]! += img.data[s * 4 + c]!;
      counts[t]!++;
    }
  }
  for (let t = 0; t < sw * sh; t++) {
    // Any marked pixel under it makes it part of the hole: nothing of the object leaks in.
    if (holeHits[t] || !counts[t]) {
      base.hole[t] = 1;
      continue;
    }
    for (let c = 0; c < 4; c++) base.px[t * 4 + c] = sums[t * 4 + c]! / counts[t]!;
  }
  grow(base.hole, sw, sh, 1);

  // Smaller and smaller copies, until the hole is a few pixels across.
  const levels: Level[] = [base];
  while (true) {
    const l = levels[levels.length - 1]!;
    if (Math.min(l.w, l.h) < 40 || holeSpan(l) <= 6) break;
    levels.push(half(l));
  }

  // The smallest: washed in from the edge.
  const top = levels[levels.length - 1]!;
  washIn(top);
  for (let i = levels.length - 1; i >= 0; i--) {
    const l = levels[i]!;
    if (i < levels.length - 1) upInto(levels[i + 1]!, l);
    const coarse = i >= levels.length - 2;
    solve(l, coarse ? 4 : 2, coarse ? 3 : 2);
  }

  // Back into the picture, the hole only, its edge softened.
  const soft = feather(base.hole, sw, sh);
  for (let y = 0; y < rh; y++) {
    const fy = Math.min(sh - 1, y * k);
    for (let x = 0; x < rw; x++) {
      const fx = Math.min(sw - 1, x * k);
      const t = Math.min(sh - 1, Math.round(fy)) * sw + Math.min(sw - 1, Math.round(fx));
      const s = (ry + y) * W + (rx + x);
      const a = mask[s] ? 1 : soft[t]!;
      if (a <= 0) continue;
      for (let c = 0; c < 4; c++) {
        const v = sample(base, fx, fy, c);
        img.data[s * 4 + c] = Math.round(img.data[s * 4 + c]! * (1 - a) + v * a);
      }
    }
  }
  return true;
}

/** Widest the hole reaches, in pixels. */
function holeSpan(l: Level) {
  let x0 = l.w;
  let x1 = -1;
  let y0 = l.h;
  let y1 = -1;
  for (let y = 0; y < l.h; y++)
    for (let x = 0; x < l.w; x++)
      if (l.hole[y * l.w + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return Math.max(x1 - x0, y1 - y0);
}

/** The hole grown by `n` pixels, so its soft edge is filled too. */
function grow(hole: Uint8Array, w: number, h: number, n: number) {
  for (let pass = 0; pass < n; pass++) {
    const was = hole.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (was[y * w + x]) continue;
        if (
          (x > 0 && was[y * w + x - 1]) ||
          (x < w - 1 && was[y * w + x + 1]) ||
          (y > 0 && was[(y - 1) * w + x]) ||
          (y < h - 1 && was[(y + 1) * w + x])
        )
          hole[y * w + x] = 1;
      }
  }
}

/** Half the size: known pixels averaged; a pixel with any hole under it is hole. */
function half(l: Level): Level {
  const w = Math.max(1, Math.ceil(l.w / 2));
  const h = Math.max(1, Math.ceil(l.h / 2));
  const out: Level = { w, h, px: new Float32Array(w * h * 4), hole: new Uint8Array(w * h) };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0;
      let holed = false;
      const acc = [0, 0, 0, 0];
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const sx = x * 2 + dx;
          const sy = y * 2 + dy;
          if (sx >= l.w || sy >= l.h) continue;
          const s = sy * l.w + sx;
          if (l.hole[s]) {
            holed = true;
            continue;
          }
          for (let c = 0; c < 4; c++) acc[c]! += l.px[s * 4 + c]!;
          n++;
        }
      const t = y * w + x;
      if (holed || !n) out.hole[t] = 1;
      else for (let c = 0; c < 4; c++) out.px[t * 4 + c] = acc[c]! / n;
    }
  return out;
}

/** The hole filled ring by ring from its edge, each pixel the average of its filled neighbors. */
function washIn(l: Level) {
  const known = new Uint8Array(l.w * l.h);
  for (let i = 0; i < known.length; i++) known[i] = l.hole[i] ? 0 : 1;
  let left = known.length - known.reduce((a, b) => a + b, 0);
  while (left > 0) {
    const ring: number[] = [];
    for (let y = 0; y < l.h; y++)
      for (let x = 0; x < l.w; x++) {
        const i = y * l.w + x;
        if (known[i]) continue;
        const acc = [0, 0, 0, 0];
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= l.w || ny >= l.h) continue;
            const j = ny * l.w + nx;
            if (!known[j]) continue;
            for (let c = 0; c < 4; c++) acc[c]! += l.px[j * 4 + c]!;
            n++;
          }
        if (n) {
          for (let c = 0; c < 4; c++) l.px[i * 4 + c] = acc[c]! / n;
          ring.push(i);
        }
      }
    if (!ring.length) break;
    for (const i of ring) known[i] = 1;
    left -= ring.length;
  }
}

/** The finer level's hole started from the coarser level's fill. */
function upInto(coarse: Level, fine: Level) {
  const sx = coarse.w / fine.w;
  const sy = coarse.h / fine.h;
  for (let y = 0; y < fine.h; y++)
    for (let x = 0; x < fine.w; x++) {
      const i = y * fine.w + x;
      if (!fine.hole[i]) continue;
      const fx = Math.min(coarse.w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const fy = Math.min(coarse.h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
      for (let c = 0; c < 4; c++) fine.px[i * 4 + c] = sample(coarse, fx, fy, c);
    }
}

/** Bilinear sample of channel `c` at (fx, fy). */
function sample(l: Level, fx: number, fy: number, c: number) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(l.w - 1, x0 + 1);
  const y1 = Math.min(l.h - 1, y0 + 1);
  const ax = fx - x0;
  const ay = fy - y0;
  const p = l.px;
  const a = p[(y0 * l.w + x0) * 4 + c]!;
  const b = p[(y0 * l.w + x1) * 4 + c]!;
  const d = p[(y1 * l.w + x0) * 4 + c]!;
  const e = p[(y1 * l.w + x1) * 4 + c]!;
  return (a * (1 - ax) + b * ax) * (1 - ay) + (d * (1 - ax) + e * ax) * ay;
}

/** The hole's edge as a 0–1 blend, one pixel of the working size wide. */
function feather(hole: Uint8Array, w: number, h: number) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0;
      let on = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          n++;
          on += hole[ny * w + nx]!;
        }
      out[y * w + x] = on / n;
    }
  return out;
}

/**
 * One level: `em` rounds of matching every square touching the hole to its
 * most alike square of the untouched picture (PatchMatch, `passes` sweeps)
 * and filling the hole with what the matches say.
 */
function solve(l: Level, em: number, passes: number) {
  const { w, h, px, hole } = l;
  const r = Math.min(w, h) < 24 ? 2 : 3;
  // Sources: squares wholly inside and wholly untouched (a running count of hole pixels).
  const sat = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += hole[y * w + x]!;
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1]! + row;
    }
  }
  const valid = new Uint8Array(w * h);
  const sources: number[] = [];
  for (let y = r; y < h - r; y++)
    for (let x = r; x < w - r; x++) {
      const a = sat[(y - r) * (w + 1) + (x - r)]!;
      const b = sat[(y - r) * (w + 1) + (x + r + 1)]!;
      const c = sat[(y + r + 1) * (w + 1) + (x - r)]!;
      const d = sat[(y + r + 1) * (w + 1) + (x + r + 1)]!;
      if (d - b - c + a === 0) {
        valid[y * w + x] = 1;
        sources.push(y * w + x);
      }
    }
  if (!sources.length) return;

  // Targets: every square that covers a hole pixel.
  const isTarget = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!hole[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const tx = x + dx;
          const ty = y + dy;
          if (tx >= r && ty >= r && tx < w - r && ty < h - r) isTarget[ty * w + tx] = 1;
        }
    }
  const targets: number[] = [];
  for (let i = 0; i < w * h; i++) if (isTarget[i]) targets.push(i);
  if (!targets.length) return;

  const nnf = new Int32Array(w * h).fill(-1);
  const cost = new Float32Array(w * h);
  const dist = (t: number, s: number, limit: number) => {
    const tx = t % w;
    const ty = (t / w) | 0;
    const sx = s % w;
    const sy = (s / w) | 0;
    let sum = 0;
    for (let dy = -r; dy <= r; dy++) {
      const to = ((ty + dy) * w + tx - r) * 4;
      const so = ((sy + dy) * w + sx - r) * 4;
      for (let k = 0; k < (2 * r + 1) * 4; k++) {
        const d = px[to + k]! - px[so + k]!;
        sum += d * d;
      }
      if (sum >= limit) return sum;
    }
    return sum;
  };
  const random = () => sources[(Math.random() * sources.length) | 0]!;
  for (const t of targets) {
    nnf[t] = random();
    cost[t] = dist(t, nnf[t]!, Infinity);
  }

  const tryMatch = (t: number, s: number) => {
    if (s < 0 || !valid[s] || s === nnf[t]) return;
    const d = dist(t, s, cost[t]!);
    if (d < cost[t]!) {
      cost[t] = d;
      nnf[t] = s;
    }
  };

  for (let round = 0; round < em; round++) {
    // Costs follow the fill as it changes.
    for (const t of targets) cost[t] = dist(t, nnf[t]!, Infinity);
    for (let pass = 0; pass < passes; pass++) {
      const forward = pass % 2 === 0;
      const step = forward ? 1 : -1;
      for (let n = 0; n < targets.length; n++) {
        const t = targets[forward ? n : targets.length - 1 - n]!;
        const tx = t % w;
        const ty = (t / w) | 0;
        // Propagation: the neighbor's match, moved along.
        const left = t - step;
        if (tx - step >= 0 && tx - step < w && nnf[left]! >= 0) {
          const s = nnf[left]! + step;
          if ((s % w) - (nnf[left]! % w) === step) tryMatch(t, s);
        }
        const up = t - step * w;
        if (ty - step >= 0 && ty - step < h && nnf[up]! >= 0) tryMatch(t, nnf[up]! + step * w);
        // Random search round the best, closer and closer.
        const bx = nnf[t]! % w;
        const by = (nnf[t]! / w) | 0;
        for (let rad = Math.max(w, h); rad >= 1; rad = Math.floor(rad / 2)) {
          const sx = Math.min(
            w - 1 - r,
            Math.max(r, bx + Math.round((Math.random() * 2 - 1) * rad)),
          );
          const sy = Math.min(
            h - 1 - r,
            Math.max(r, by + Math.round((Math.random() * 2 - 1) * rad)),
          );
          tryMatch(t, sy * w + sx);
        }
        // Now and then a fresh start anywhere, against getting stuck.
        if (Math.random() < 0.05) tryMatch(t, random());
      }
    }
    // Voting: each hole pixel the average of what the squares over it say, closer matches louder.
    const acc = new Float32Array(w * h * 4);
    const wsum = new Float32Array(w * h);
    const area = (2 * r + 1) * (2 * r + 1);
    for (const t of targets) {
      const s = nnf[t]!;
      const weight = 1 / (1 + cost[t]! / (area * 64));
      const tx = t % w;
      const ty = (t / w) | 0;
      const sx = s % w;
      const sy = (s / w) | 0;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const p = (ty + dy) * w + tx + dx;
          if (!hole[p]) continue;
          const q = ((sy + dy) * w + sx + dx) * 4;
          for (let c = 0; c < 4; c++) acc[p * 4 + c]! += px[q + c]! * weight;
          wsum[p]! += weight;
        }
    }
    for (let p = 0; p < w * h; p++) {
      if (!hole[p] || !wsum[p]) continue;
      for (let c = 0; c < 4; c++) px[p * 4 + c] = acc[p * 4 + c]! / wsum[p]!;
    }
  }
}
