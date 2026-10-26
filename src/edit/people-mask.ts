/**
 * Masking › Orang, as Lightroom's People: each person found, and the parts
 * of them — the whole person, face and body skin, brows, the whites of the
 * eyes, iris and pupil, lips, teeth, hair, clothes.
 *
 * Made from two things read on this computer: Face Mesh's 478 points per
 * face (Rust `face_landmarks`, MediaPipe's outlines and iris points) and
 * MODNet's matte of everyone (`personMatte`). The matte is shared out to
 * the faces by where each body sits below its face; hair is the person
 * round the head that is neither face nor skin; body skin is the person's
 * skin-coloured part below the head; clothes the rest of the body.
 * Kept as a picture, like the subject's mask.
 */

import { api } from '../lib/api';
import { canvasToPng, personMatte, personParts } from '../kreasi/engine/cutout';
import { hasMaskImage, registerMaskImage } from '../kreasi/engine/develop';
import { saveMaskImage } from '../kreasi/engine/lut-store';

export type FacePart = 'orang' | 'kulit' | 'kulit-badan' | 'alis' | 'sklera' | 'iris' | 'bibir' | 'gigi' | 'rambut' | 'pakaian';
export const FACE_PARTS: { id: FacePart; label: string }[] = [
  { id: 'orang', label: 'Seluruh orang' },
  { id: 'kulit', label: 'Kulit wajah' },
  { id: 'kulit-badan', label: 'Kulit badan' },
  { id: 'alis', label: 'Alis' },
  { id: 'sklera', label: 'Putih mata' },
  { id: 'iris', label: 'Iris & pupil' },
  { id: 'bibir', label: 'Bibir' },
  { id: 'gigi', label: 'Gigi' },
  { id: 'rambut', label: 'Rambut' },
  { id: 'pakaian', label: 'Pakaian' },
];
/** Parts that need the person's matte (MODNet); the others are the face's points alone. */
const BODY: FacePart[] = ['orang', 'kulit-badan', 'rambut', 'pakaian'];

const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const EYES = [
  [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
];
const BROWS = [
  [276, 283, 282, 295, 285, 336, 296, 334, 293, 300],
  [46, 53, 52, 65, 55, 107, 66, 105, 63, 70],
];
const LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
const MOUTH = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
/** Face Mesh V2's iris points: the middle, then four round it (each eye). */
const IRIS = [
  [473, 474, 475, 476, 477],
  [468, 469, 470, 471, 472],
];

const found = new Map<string, Promise<[number, number][][]>>();
/** The photo's faces' points, read once. */
export function landmarksOf(root: string, id: number) {
  const key = `${root}#${id}`;
  let p = found.get(key);
  if (!p) {
    p = api.faceLandmarks(root, id);
    p.catch(() => found.delete(key));
    found.set(key, p);
  }
  return p;
}

const mattes = new Map<string, Promise<HTMLCanvasElement>>();
function matteOf(key: string, img: HTMLImageElement) {
  let p = mattes.get(key);
  if (!p) {
    p = personMatte(img);
    p.catch(() => mattes.delete(key));
    mattes.set(key, p);
    if (mattes.size > 4) mattes.delete(mattes.keys().next().value!);
  }
  return p;
}

/** A face's box (shares of the photo) from its outline. */
export function faceBox(pts: [number, number][]) {
  const xs = OVAL.map((i) => pts[i]![0]);
  const ys = OVAL.map((i) => pts[i]![1]);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  return { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 };
}

/** A small picture of each face, for choosing who (as Lightroom's people thumbnails). */
export function faceThumbs(img: HTMLImageElement, points: [number, number][][]): string[] {
  return points.map((pts) => {
    const b = faceBox(pts);
    const side = Math.max(b.w * img.naturalWidth, b.h * img.naturalHeight) * 1.5;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    c.getContext('2d')!.drawImage(
      img,
      (b.x + b.w / 2) * img.naturalWidth - side / 2,
      (b.y + b.h / 2) * img.naturalHeight - side / 2,
      side,
      side,
      0,
      0,
      64,
      64,
    );
    return c.toDataURL('image/jpeg', 0.8);
  });
}

/**
 * The mask of `parts` of the people `faces` (indexes into `points`), as an
 * id the engine draws — registered, and kept in this browser for next time.
 */
export async function peopleMask(
  root: string,
  photoId: number,
  img: HTMLImageElement,
  points: [number, number][][],
  faces: number[],
  parts: FacePart[],
): Promise<string> {
  const id = `people-${root}#${photoId}#${faces.join(',')}#${parts.join(',')}`;
  if (hasMaskImage(id)) return id;
  const W = 1024;
  const H = Math.max(8, Math.round((W * img.naturalHeight) / img.naturalWidth));
  const N = W * H;

  // Shapes from the face's points, as one byte a pixel.
  const draw = (fn: (ctx: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    fn(ctx);
    const d = ctx.getImageData(0, 0, W, H).data;
    const out = new Uint8Array(N);
    for (let i = 0; i < N; i++) out[i] = d[i * 4 + 3]!;
    return out;
  };
  const shape = (ctx: CanvasRenderingContext2D, pts: [number, number][], idx: number[]) => {
    ctx.beginPath();
    idx.forEach((i, k) => {
      const [x, y] = pts[i]!;
      if (k) ctx.lineTo(x * W, y * H);
      else ctx.moveTo(x * W, y * H);
    });
    ctx.closePath();
    ctx.fill();
  };
  const iris = (ctx: CanvasRenderingContext2D, pts: [number, number][], idx: number[]) => {
    const [cx, cy] = pts[idx[0]!]!;
    const r = Math.max(...idx.slice(1).map((i) => Math.hypot((pts[i]![0] - cx) * W, (pts[i]![1] - cy) * H)));
    ctx.beginPath();
    ctx.arc(cx * W, cy * H, r, 0, Math.PI * 2);
    ctx.fill();
  };
  /** The head round a face: a little wider than the face, reaching above it (hair, hijab). */
  const head = (ctx: CanvasRenderingContext2D, pts: [number, number][]) => {
    const b = faceBox(pts);
    ctx.beginPath();
    ctx.ellipse((b.x + b.w / 2) * W, (b.y + b.h * 0.42) * H, b.w * 0.95 * W, b.h * 0.95 * H, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  // Everyone's matte, shared out: each pixel to the face whose body it sits under.
  const needBody = parts.some((p) => BODY.includes(p));
  let owner: Int16Array | null = null;
  let matte: Uint8Array | null = null;
  if (needBody) {
    const m = await matteOf(`${root}#${photoId}`, img);
    const mc = document.createElement('canvas');
    mc.width = W;
    mc.height = H;
    const mx = mc.getContext('2d', { willReadFrequently: true })!;
    mx.drawImage(m, 0, 0, W, H);
    const md = mx.getImageData(0, 0, W, H).data;
    matte = new Uint8Array(N);
    for (let i = 0; i < N; i++) matte[i] = md[i * 4 + 3]!;
    // Shared out by growing from every face at once through the matte
    // (breadth first): each pixel goes to the face that reaches it first, so
    // a body is followed however it bends, and two people touching split
    // halfway. A body reaches at most some five faces from its face.
    const boxes = points.map(faceBox);
    owner = new Int16Array(N).fill(-1);
    const dist = new Int32Array(N).fill(-1);
    const queue = new Int32Array(N);
    let qh = 0;
    let qt = 0;
    const limit = boxes.map((b) => Math.round(Math.max(b.w * W, b.h * H) * 5));
    points.forEach((pts, f) => {
      const oval = draw((c) => shape(c, pts, OVAL));
      for (let k = 0; k < N; k++) {
        if (oval[k]! > 128 && owner![k] === -1) {
          owner![k] = f;
          dist[k] = 0;
          queue[qt++] = k;
        }
      }
    });
    while (qh < qt) {
      const k = queue[qh++]!;
      const f = owner[k]!;
      const d = dist[k]! + 1;
      if (d > limit[f]!) continue;
      const x = k % W;
      const tryAt = (n: number) => {
        if (dist[n] !== -1 || matte![n]! < 40) return;
        dist[n] = d;
        owner![n] = f;
        queue[qt++] = n;
      };
      if (x > 0) tryAt(k - 1);
      if (x < W - 1) tryAt(k + 1);
      if (k >= W) tryAt(k - W);
      if (k < N - W) tryAt(k + W);
    }
  }

  // The photo at this size, as luma and chroma (YCbCr) for judging skin.
  const pc = document.createElement('canvas');
  pc.width = W;
  pc.height = H;
  const px = pc.getContext('2d', { willReadFrequently: true })!;
  px.drawImage(img, 0, 0, W, H);
  const pd = px.getImageData(0, 0, W, H).data;
  const Y = new Float32Array(N);
  const CB = new Float32Array(N);
  const CR = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = pd[i * 4]!;
    const g = pd[i * 4 + 1]!;
    const b = pd[i * 4 + 2]!;
    Y[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    CB[i] = 128 - 0.1687 * r - 0.3313 * g + 0.5 * b;
    CR[i] = 128 + 0.5 * r - 0.4187 * g - 0.0813 * b;
  }
  /**
   * This person's own skin, learned from their face (inside the outline,
   * away from eyes, brows and lips): how alike each pixel is, 0–255 — by
   * its colour (Mahalanobis distance in Cb/Cr) and, loosely, its brightness.
   * Pale skin and a white hijab differ in colour though not in brightness.
   */
  const skinOf = (sample: Uint8Array) => {
    let pick = (i: number) => sample[i]! > 200;
    let st = { cb: 0, cr: 0, vbb: 1, vrr: 1, vbr: 0, y: 128, sy: 40 };
    // Twice: the second time without what the first found unlike (shadow, glasses, beard).
    for (let pass = 0; pass < 2; pass++) {
      let n = 0;
      let sb = 0;
      let sr = 0;
      let syy = 0;
      for (let i = 0; i < N; i++) if (pick(i)) (n++, (sb += CB[i]!), (sr += CR[i]!), (syy += Y[i]!));
      if (n < 30) break;
      const cb = sb / n;
      const cr = sr / n;
      const y = syy / n;
      let vbb = 0;
      let vrr = 0;
      let vbr = 0;
      let vy = 0;
      for (let i = 0; i < N; i++) {
        if (!pick(i)) continue;
        const db = CB[i]! - cb;
        const dr = CR[i]! - cr;
        vbb += db * db;
        vrr += dr * dr;
        vbr += db * dr;
        vy += (Y[i]! - y) ** 2;
      }
      st = { cb, cr, vbb: vbb / n + 4, vrr: vrr / n + 4, vbr: vbr / n, y, sy: Math.sqrt(vy / n) + 8 };
      const prev = pick;
      pick = (i) => prev(i) && dist(i) < 2.5;
    }
    function dist(i: number) {
      const det = st.vbb * st.vrr - st.vbr * st.vbr;
      const db = CB[i]! - st.cb;
      const dr = CR[i]! - st.cr;
      return Math.sqrt(Math.max(0, (st.vrr * db * db - 2 * st.vbr * db * dr + st.vbb * dr * dr) / det));
    }
    return (i: number) => {
      const d = dist(i) + Math.max(0, Math.abs(Y[i]! - st.y) / st.sy - 2);
      return d <= 1.6 ? 255 : d >= 2.8 ? 0 : Math.round((255 * (2.8 - d)) / 1.2);
    };
  };
  /** Only what joins `seed` through `m` (above half), so skin elsewhere (a hand, a neighbour) is left out. */
  const joined = (m: Uint8Array, seed: Uint8Array) => {
    const keep = new Uint8Array(N);
    const queue = new Int32Array(N);
    let qh = 0;
    let qt = 0;
    for (let i = 0; i < N; i++) if (seed[i]! > 200 && m[i]! > 128) (keep[i] = 1), (queue[qt++] = i);
    while (qh < qt) {
      const k = queue[qh++]!;
      const x = k % W;
      for (const n of [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, k - W, k + W]) {
        if (n < 0 || n >= N || keep[n] || m[n]! < 64) continue;
        keep[n] = 1;
        queue[qt++] = n;
      }
    }
    for (let i = 0; i < N; i++) if (!keep[i]) m[i] = 0;
    return m;
  };

  /**
   * The parts model's view of a square round someone (shares of the photo:
   * left, top, side across), its classes spread back over the W × H grid —
   * 0 outside the square. Null when the model can't run (then colour decides).
   */
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const partsIn = async (x: number, y: number, side: number) => {
    const sq = { x: x * iw, y: y * ih, side: side * iw };
    const raw = await personParts(img, sq).catch(() => null);
    if (!raw) return null;
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = document.createElement('canvas');
    g.width = W;
    g.height = H;
    const gx = g.getContext('2d', { willReadFrequently: true })!;
    gx.imageSmoothingQuality = 'high';
    return Array.from({ length: 6 }, (_, k) => {
      const d = new ImageData(S, S);
      for (let i = 0; i < S * S; i++) d.data[i * 4 + 3] = raw[i * 6 + k]!;
      c.getContext('2d')!.putImageData(d, 0, 0);
      gx.clearRect(0, 0, W, H);
      gx.drawImage(c, sq.x * (W / iw), sq.y * (H / ih), sq.side * (W / iw), sq.side * (H / ih));
      const a = gx.getImageData(0, 0, W, H).data;
      const m = new Uint8Array(N);
      for (let i = 0; i < N; i++) m[i] = a[i * 4 + 3]!;
      return m;
    });
  };
  const HAIR = 1;
  const BODY_SKIN = 2;
  const FACE_SKIN = 3;
  const CLOTHES = 4;
  /** Accessories and the like: shiny sleeves and songket land here too. */
  const OTHERS = 5;

  const out = new Uint8Array(N);
  const add = (m: Uint8Array) => {
    for (let i = 0; i < N; i++) if (m[i]! > out[i]!) out[i] = m[i]!;
  };
  for (const f of faces) {
    const pts = points[f];
    if (!pts) continue;
    const faceOval = draw((c) => shape(c, pts, OVAL));
    const fb = faceBox(pts);
    // Eyes, brows and lips with a little room round them.
    const features = draw((c) => {
      c.strokeStyle = '#fff';
      c.lineJoin = 'round';
      c.lineWidth = Math.max(2, fb.w * W * 0.025);
      for (const idx of [...EYES, ...BROWS, LIPS]) {
        shape(c, pts, idx);
        c.stroke();
      }
    });
    const headArea = needBody ? draw((c) => head(c, pts)) : null;
    // The parts model, twice: close round the head (face skin, hair), and
    // wide round the body (body skin, clothes) — a head is too small in the
    // wide view for a face's edge.
    const fcx = fb.x + fb.w / 2;
    const fh = Math.max(fb.w * (iw / ih), fb.h);
    const headSide = (fh * 2.4 * ih) / iw;
    const near = await partsIn(fcx - headSide / 2, fb.y + fb.h / 2 - (fh * 1.25), headSide);
    const bodySide = (fh * 7 * ih) / iw;
    const wide = parts.some((p) => p === 'kulit-badan' || p === 'pakaian') ? await partsIn(fcx - bodySide / 2, fb.y - fh * 0.8, bodySide) : null;
    // Learned from the cheeks and under the eyes only: a hijab or hair over
    // the forehead, inside the outline, would teach it the cloth's colour.
    const cheeks = draw((c) => {
      for (const i of [50, 280, 101, 330, 205, 425]) {
        const [x, y] = pts[i]!;
        c.beginPath();
        c.arc(x * W, y * H, Math.max(2, fb.w * W * 0.07), 0, Math.PI * 2);
        c.fill();
      }
    });
    const skinLike = skinOf(Uint8Array.from(cheeks, (v, i) => (features[i] ? 0 : v)));
    /** The face's skin: inside the head from the hairline to the chin, as alike as the face's own. */
    const facialSkin = () => {
      // The outline a little wider, and the forehead above it up to the
      // hairline (a hijab's edge): the cheeks' sides stay inside, so cloth
      // of a skin-like colour beside the face isn't taken.
      const cx = (fb.x + fb.w / 2) * W;
      const cy = (fb.y + fb.h / 2) * H;
      const area = draw((c) => {
        c.beginPath();
        OVAL.forEach((i, k) => {
          const x = cx + (pts[i]![0] * W - cx) * 1.06;
          const y = cy + (pts[i]![1] * H - cy) * 1.04;
          if (k) c.lineTo(x, y);
          else c.moveTo(x, y);
        });
        c.closePath();
        c.fill();
        const [tx, ty] = pts[10]!;
        c.beginPath();
        c.ellipse(tx * W, ty * H, fb.w * 0.36 * W, fb.h * 0.22 * H, 0, 0, Math.PI * 2);
        c.fill();
      });
      const m = new Uint8Array(N);
      for (let i = 0; i < N; i++) if (area[i]! > 128 && !features[i]) m[i] = Math.min(area[i]!, skinLike(i));
      return joined(m, faceOval);
    };
    const mine = (i: number) => (owner && owner[i] === f ? matte![i]! : 0);
    for (const part of parts) {
      const m = new Uint8Array(N);
      if (part === 'kulit' && near) {
        for (let i = 0; i < N; i++) m[i] = features[i] ? 0 : near[FACE_SKIN]![i]!;
        joined(m, faceOval);
      } else if (part === 'kulit') {
        m.set(facialSkin());
      } else if (part === 'alis') {
        m.set(draw((c) => BROWS.forEach((idx) => shape(c, pts, idx))));
      } else if (part === 'sklera' || part === 'iris') {
        const eyes = draw((c) => EYES.forEach((idx) => shape(c, pts, idx)));
        const irises = draw((c) => IRIS.forEach((idx) => iris(c, pts, idx)));
        for (let i = 0; i < N; i++) m[i] = part === 'iris' ? Math.min(eyes[i]!, irises[i]!) : irises[i] ? 0 : eyes[i]!;
      } else if (part === 'bibir') {
        const mouth = draw((c) => shape(c, pts, MOUTH));
        const lips = draw((c) => shape(c, pts, LIPS));
        for (let i = 0; i < N; i++) m[i] = mouth[i] ? 0 : lips[i]!;
      } else if (part === 'gigi') {
        // Inside the open mouth, only what is bright and not red: the teeth,
        // not the tongue, gums or the dark between them.
        const mouth = draw((c) => shape(c, pts, MOUTH));
        const ys: number[] = [];
        for (let i = 0; i < N; i++) if (mouth[i]! > 128) ys.push(Y[i]!);
        ys.sort((p, q) => p - q);
        const mid = ys.length ? ys[Math.floor(ys.length * 0.5)]! : 255;
        for (let i = 0; i < N; i++) {
          if (!mouth[i]) continue;
          const bright = Math.min(1, Math.max(0, (Y[i]! - mid * 0.85) / Math.max(8, mid * 0.3)));
          const red = Math.min(1, Math.max(0, (CR[i]! - 150) / 12));
          m[i] = Math.round(mouth[i]! * bright * (1 - red));
        }
      } else if (part === 'orang') {
        for (let i = 0; i < N; i++) m[i] = Math.max(mine(i), faceOval[i]!);
      } else if (part === 'rambut' && near) {
        for (let i = 0; i < N; i++) m[i] = Math.min(near[HAIR]![i]!, Math.max(mine(i), headArea![i]! ? 255 : 0));
      } else if (part === 'kulit-badan' && wide) {
        // Below the head the wide view; round the neck and ears the close one.
        for (let i = 0; i < N; i++) m[i] = Math.min(mine(i), Math.max(wide[BODY_SKIN]![i]!, near ? near[BODY_SKIN]![i]! : 0));
      } else if (part === 'pakaian' && wide) {
        for (let i = 0; i < N; i++) m[i] = Math.min(mine(i), Math.max(wide[CLOTHES]![i]!, wide[OTHERS]![i]!, near ? near[CLOTHES]![i]! : 0));
      } else if (part === 'rambut') {
        const face = facialSkin();
        for (let i = 0; i < N; i++) m[i] = headArea![i] && !faceOval[i] && !face[i] && skinLike(i) < 128 ? mine(i) : 0;
      } else if (part === 'kulit-badan') {
        for (let i = 0; i < N; i++) m[i] = !headArea![i] ? Math.min(mine(i), skinLike(i)) : 0;
      } else if (part === 'pakaian') {
        for (let i = 0; i < N; i++) m[i] = !headArea![i] && skinLike(i) < 128 ? mine(i) : 0;
      }
      add(m);
    }
  }

  // Edges a pixel or two soft, as a hand-made mask would be.
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const raw = new ImageData(W, H);
  for (let i = 0; i < N; i++) {
    raw.data[i * 4] = raw.data[i * 4 + 1] = raw.data[i * 4 + 2] = 255;
    raw.data[i * 4 + 3] = out[i]!;
  }
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  tmp.getContext('2d')!.putImageData(raw, 0, 0);
  const ctx = c.getContext('2d')!;
  ctx.filter = 'blur(1px)';
  ctx.drawImage(tmp, 0, 0);
  registerMaskImage(id, c);
  canvasToPng(c).then((png) => saveMaskImage(id, png)).catch(() => {});
  return id;
}

/**
 * Everyone whose face was found, as one mask at 1024 across: the parts
 * model's "not background" on a wide square round each (body to the knees),
 * for filling what the whole-photo matte misses on people sitting or cut
 * off by the frame. Null when the model can't run.
 */
export async function peopleCover(img: HTMLImageElement, points: [number, number][][]): Promise<HTMLCanvasElement | null> {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const W = 1024;
  const H = Math.max(8, Math.round((W * ih) / iw));
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const ctx = out.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighten';
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  let any = false;
  for (const pts of points) {
    const fb = faceBox(pts);
    const fh = Math.max(fb.w * (iw / ih), fb.h);
    const side = fh * 7 * ih;
    const sq = { x: (fb.x + fb.w / 2) * iw - side / 2, y: (fb.y - fh * 0.8) * ih, side };
    const raw = await personParts(img, sq).catch(() => null);
    if (!raw) continue;
    any = true;
    const d = new ImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = 255;
      d.data[i * 4 + 3] = 255 - raw[i * 6]!;
    }
    c.getContext('2d')!.putImageData(d, 0, 0);
    ctx.drawImage(c, (sq.x / iw) * W, (sq.y / ih) * H, (side / iw) * W, (side / ih) * H);
  }
  return any ? out : null;
}
