/**
 * Camera RAW (Sony .ARW and others), off the page's thread: LibRaw (CDDL,
 * public/wasm) reads the file once into the camera's own linear colors, at
 * half size — 6 MP from a 24 MP sensor, plenty for the editor and a download,
 * and quick. Each white balance is then drawn from those numbers: the
 * camera's multipliers for the Kelvin and tint asked, its color matrix, and
 * the sRGB curve.
 */
import { LibRaw } from '@colorhythm/libraw-wasm';
import { kelvinTintOfMultipliers, multipliersFor, type Matrix3 } from './raw-color';

export type RawRequest =
  /** `full`: read at the sensor's full size (shown at most 4096 px; a download takes it all). */
  | { type: 'decode'; key: string; bytes: ArrayBuffer; full?: boolean }
  | { type: 'render'; id: number; key: string; kelvin: number; tint: number }
  | { type: 'neutral'; id: number; key: string; u: number; v: number }
  /**
   * For a download, at the sensor's full size: from what `key` already holds
   * when it was read in full, else from `bytes` (drawn once, not kept).
   */
  | { type: 'full'; id: number; key: string; bytes?: ArrayBuffer; kelvin: number; tint: number };
export type RawMessage =
  | {
      type: 'decoded';
      key: string;
      width: number;
      height: number;
      /** The sensor's full size — what a download at full resolution comes out at. */
      sensor: { width: number; height: number };
      asShot: { kelvin: number; tint: number };
    }
  | {
      type: 'rendered';
      id: number;
      key: string;
      width: number;
      height: number;
      pixels: Uint8ClampedArray;
    }
  | { type: 'neutral'; id: number; kelvin: number; tint: number }
  /** Not read in this worker (yet, or any more): send the file again. */
  | { type: 'missing'; id: number; key: string }
  | { type: 'error'; key: string; id?: number; message: string };

const WASM = '/wasm/libraw-0.22.1.wasm';

type Decoded = {
  width: number;
  height: number;
  /** Read at half size (the sensor's full size otherwise). */
  half: boolean;
  /** Camera RGB, linear, 0–65535 = the sensor full. */
  data: Uint16Array;
  camXyz: Matrix3;
  rgbCam: Matrix3;
  asShot: { kelvin: number; tint: number };
  /** Brightness as a photo editor opens it: the brightest 1% just white, at As Shot. */
  bright: number;
};

/** The latest two read, at most: each is some 36 MB at half size, 144 MB in full. */
const kept = new Map<string, Decoded>();
const keep = (key: string, d: Decoded) => {
  kept.delete(key);
  kept.set(key, d);
  while (kept.size > 2) kept.delete(kept.keys().next().value!);
};

const post = (m: RawMessage, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage: (m: unknown, t: Transferable[]) => void }).postMessage(
    m,
    transfer,
  );

let ready: Promise<unknown> | null = null;

/** sRGB's curve from linear light, 4096 steps in, bytes out. */
const CURVE = new Uint8ClampedArray(4096);
for (let i = 0; i < 4096; i++) {
  const x = i / 4095;
  CURVE[i] = Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255);
}

async function decode(bytes: ArrayBuffer, half = true): Promise<Decoded> {
  ready ??= LibRaw.initialize(fetch(WASM));
  await ready;
  const raw = new LibRaw();
  await raw.waitUntilReady();
  try {
    raw.open(bytes);
    raw.unpack();
    const camXyz = [0, 1, 2].map((i) => [0, 1, 2].map((j) => raw.getCamXyz(i, j))) as Matrix3;
    const rgbCam = [0, 1, 2].map((i) => [0, 1, 2].map((j) => raw.getRgbCam(i, j))) as Matrix3;
    const g = raw.getCamMul(1) || 1;
    const shot = [raw.getCamMul(0) / g, 1, raw.getCamMul(2) / g] as [number, number, number];
    // The camera's colors as they are: no white balance, linear, 16-bit, half size
    // (full for a download).
    raw.setHalfSize(half ? 1 : 0);
    raw.setOutputColor(0);
    raw.setOutputBps(16);
    raw.setGamma(0, 1);
    raw.setGamma(1, 1);
    raw.setNoAutoBright(1);
    raw.setUseCameraWb(0);
    for (let i = 0; i < 4; i++) raw.setUserMul(i, 1);
    raw.setHighlight(0);
    raw.dcrawProcess();
    const img = raw.dcrawMakeMemImage();
    const src = img.data as unknown as Uint8Array;
    const data = new Uint16Array(src.byteLength / 2);
    new Uint8Array(data.buffer).set(src);
    const hasShot = shot.every((x) => Number.isFinite(x) && x > 0) && shot[0] !== 1;
    const asShot = hasShot ? kelvinTintOfMultipliers(camXyz, shot) : { kelvin: 5500, tint: 0 };
    const d: Decoded = {
      width: img.width,
      height: img.height,
      half,
      data,
      camXyz,
      rgbCam,
      asShot,
      bright: 1,
    };
    d.bright = brightness(d);
    return d;
  } finally {
    raw.dispose();
  }
}

/** The brightest 1% (of a sample) just white at As Shot — how a RAW opens in a photo editor. */
function brightness(d: Decoded) {
  const m = multipliersFor(d.camXyz, d.asShot.kelvin, d.asShot.tint);
  const M = d.rgbCam;
  const values: number[] = [];
  const n = d.width * d.height;
  const step = Math.max(1, Math.floor(n / 50000));
  for (let p = 0; p < n; p += step) {
    const r = Math.min(1, (d.data[p * 3]! / 65535) * m[0]);
    const g = Math.min(1, (d.data[p * 3 + 1]! / 65535) * m[1]);
    const b = Math.min(1, (d.data[p * 3 + 2]! / 65535) * m[2]);
    values.push(
      Math.max(
        M[0]![0]! * r + M[0]![1]! * g + M[0]![2]! * b,
        M[1]![0]! * r + M[1]![1]! * g + M[1]![2]! * b,
        M[2]![0]! * r + M[2]![1]! * g + M[2]![2]! * b,
      ),
    );
  }
  values.sort((a, b) => a - b);
  const top = values[Math.floor(values.length * 0.99)] ?? 1;
  return Math.min(8, Math.max(1, 1 / Math.max(1e-3, top)));
}

/** The size the editor shows a RAW at, at most: what photos are developed at. */
const SHOWN_SIDE = 4096;

/** The size `d` is drawn at, its longest side at most `side`. */
function drawnSize(d: Decoded, side: number) {
  const k = Math.min(1, side / Math.max(d.width, d.height));
  return { k, w: Math.max(1, Math.round(d.width * k)), h: Math.max(1, Math.round(d.height * k)) };
}

/** `d` at a white balance, its longest side at most `side` (smaller: averaged, not skipped). */
function render(d: Decoded, kelvin: number, tint: number, side = SHOWN_SIDE) {
  const m = multipliersFor(d.camXyz, kelvin, tint);
  const k = d.bright;
  const M = d.rgbCam.map((row) => row.map((x) => x * k * 4095));
  const [m0, m1, m2] = m;
  const { k: scale, w, h } = drawnSize(d, side);
  const out = new Uint8ClampedArray(w * h * 4);
  const src = d.data;
  const W = d.width;
  const s = 1 / 65535;
  const at = (x: number) => CURVE[x <= 0 ? 0 : x >= 4095 ? 4095 : x | 0]!;
  const put = (o: number, R: number, G: number, B: number) => {
    // White balance, clipped where the sensor was full so highlights stay white.
    const r = Math.min(1, R * s * m0);
    const g = Math.min(1, G * s * m1);
    const b = Math.min(1, B * s * m2);
    out[o] = at(M[0]![0]! * r + M[0]![1]! * g + M[0]![2]! * b);
    out[o + 1] = at(M[1]![0]! * r + M[1]![1]! * g + M[1]![2]! * b);
    out[o + 2] = at(M[2]![0]! * r + M[2]![1]! * g + M[2]![2]! * b);
    out[o + 3] = 255;
  };
  if (scale === 1) {
    for (let p = 0; p < w * h; p++) put(p * 4, src[p * 3]!, src[p * 3 + 1]!, src[p * 3 + 2]!);
    return { pixels: out, width: w, height: h };
  }
  // Smaller: each pixel the average of the 2×2 of the sensor's under it (bilinear).
  const inv = 1 / scale;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(d.height - 2, Math.max(0, (y + 0.5) * inv - 0.5));
    const y0 = sy | 0;
    const fy = sy - y0;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(W - 2, Math.max(0, (x + 0.5) * inv - 0.5));
      const x0 = sx | 0;
      const fx = sx - x0;
      const a = (y0 * W + x0) * 3;
      const b = a + 3;
      const c = a + W * 3;
      const e = c + 3;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      put(
        (y * w + x) * 4,
        src[a]! * w00 + src[b]! * w10 + src[c]! * w01 + src[e]! * w11,
        src[a + 1]! * w00 + src[b + 1]! * w10 + src[c + 1]! * w01 + src[e + 1]! * w11,
        src[a + 2]! * w00 + src[b + 2]! * w10 + src[c + 2]! * w01 + src[e + 2]! * w11,
      );
    }
  }
  return { pixels: out, width: w, height: h };
}

/** The white balance that makes the spot at (u, v) — shares of the picture — neutral. */
function neutralAt(d: Decoded, u: number, v: number) {
  const cx = Math.round(u * (d.width - 1));
  const cy = Math.round(v * (d.height - 1));
  const sum = [0, 0, 0];
  const R = Math.max(1, Math.round(Math.min(d.width, d.height) * 0.004));
  for (let y = cy - R; y <= cy + R; y++) {
    for (let x = cx - R; x <= cx + R; x++) {
      const p =
        Math.min(d.height - 1, Math.max(0, y)) * d.width + Math.min(d.width - 1, Math.max(0, x));
      for (let c = 0; c < 3; c++) sum[c]! += d.data[p * 3 + c]!;
    }
  }
  const g = sum[1] || 1;
  const mul = [g / (sum[0] || 1), 1, g / (sum[2] || 1)] as [number, number, number];
  return kelvinTintOfMultipliers(d.camXyz, mul);
}

self.onmessage = async (e: MessageEvent<RawRequest>) => {
  const q = e.data;
  try {
    if (q.type === 'decode') {
      const d = await decode(q.bytes, !q.full);
      keep(q.key, d);
      // The size it is shown at.
      const { w, h } = drawnSize(d, SHOWN_SIDE);
      // Read at half size, the sensor is twice as large each way.
      const sensor = d.half
        ? { width: d.width * 2, height: d.height * 2 }
        : { width: d.width, height: d.height };
      post({ type: 'decoded', key: q.key, width: w, height: h, sensor, asShot: d.asShot });
      return;
    }
    if (q.type === 'full') {
      const held = kept.get(q.key);
      const d = held && !held.half ? held : q.bytes ? await decode(q.bytes, false) : null;
      if (!d) {
        post({ type: 'missing', id: q.id, key: q.key });
        return;
      }
      const r = render(d, q.kelvin, q.tint, Infinity);
      post({ type: 'rendered', id: q.id, key: q.key, ...r }, [r.pixels.buffer]);
      return;
    }
    const d = kept.get(q.key);
    if (!d) {
      post({ type: 'missing', id: q.id, key: q.key });
      return;
    }
    keep(q.key, d);
    if (q.type === 'render') {
      const r = render(d, q.kelvin, q.tint);
      post({ type: 'rendered', id: q.id, key: q.key, ...r }, [r.pixels.buffer]);
    } else {
      post({ type: 'neutral', id: q.id, ...neutralAt(d, q.u, q.v) });
    }
  } catch (err) {
    post({
      type: 'error',
      key: q.key,
      id: 'id' in q ? q.id : undefined,
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
