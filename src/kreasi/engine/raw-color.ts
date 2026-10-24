/**
 * White balance of a camera RAW, as a photo editor shows it: a temperature in
 * Kelvin and a tint, turned into the camera's own channel multipliers (and
 * back). Colors are placed on the black-body line in CIE 1960 (u, v) —
 * Krystek's approximation — and the tint is how far off that line, in the
 * DNG SDK's scale (−3000 × Δuv: positive magenta, negative green).
 */

export type Matrix3 = [number, number, number][];

/** The temperature range a photo editor offers. */
export const MIN_KELVIN = 2000;
export const MAX_KELVIN = 50000;
const TINT_SCALE = -3000;

/** The black-body line at `t` Kelvin, in (u, v). */
function planck(t: number): [number, number] {
  const u =
    (0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t * t) /
    (1 + 8.42420235e-4 * t + 7.08145163e-7 * t * t);
  const v =
    (0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t * t) /
    (1 - 2.89741816e-5 * t + 1.61456053e-7 * t * t);
  return [u, v];
}

/** Across the line at `t`, towards green (higher v). */
function normal(t: number): [number, number] {
  const [u0, v0] = planck(t * 0.999);
  const [u1, v1] = planck(t * 1.001);
  let nu = -(v1 - v0);
  let nv = u1 - u0;
  const len = Math.hypot(nu, nv) || 1;
  nu /= len;
  nv /= len;
  return nv < 0 ? [-nu, -nv] : [nu, nv];
}

/** The white of a temperature and tint, as XYZ with Y = 1. */
export function whiteXyz(kelvin: number, tint: number): [number, number, number] {
  const t = Math.min(MAX_KELVIN, Math.max(MIN_KELVIN, kelvin));
  const [u0, v0] = planck(t);
  const [nu, nv] = normal(t);
  const duv = tint / TINT_SCALE;
  const u = u0 + nu * duv;
  const v = v0 + nv * duv;
  const d = 2 * u - 8 * v + 4;
  const x = (3 * u) / d;
  const y = (2 * v) / d;
  return [x / y, 1, (1 - x - y) / y];
}

/** The temperature and tint of a white given as XYZ. */
export function kelvinTintOf([X, Y, Z]: [number, number, number]): {
  kelvin: number;
  tint: number;
} {
  const s = X + 15 * Y + 3 * Z;
  const u = (4 * X) / s;
  const v = (6 * Y) / s;
  // The nearest point of the line, searched in mireds (even steps to the eye).
  const at = (m: number) => {
    const [pu, pv] = planck(1e6 / m);
    return (pu - u) ** 2 + (pv - v) ** 2;
  };
  let lo = 1e6 / MAX_KELVIN;
  let hi = 1e6 / MIN_KELVIN;
  for (let i = 0; i < 80; i++) {
    const a = lo + (hi - lo) / 3;
    const b = hi - (hi - lo) / 3;
    if (at(a) < at(b)) hi = b;
    else lo = a;
  }
  const kelvin = 1e6 / ((lo + hi) / 2);
  const [pu, pv] = planck(kelvin);
  const [nu, nv] = normal(kelvin);
  const duv = (u - pu) * nu + (v - pv) * nv;
  return { kelvin, tint: duv * TINT_SCALE };
}

const mul3 = (m: Matrix3, [a, b, c]: [number, number, number]): [number, number, number] => [
  m[0]![0]! * a + m[0]![1]! * b + m[0]![2]! * c,
  m[1]![0]! * a + m[1]![1]! * b + m[1]![2]! * c,
  m[2]![0]! * a + m[2]![1]! * b + m[2]![2]! * c,
];

export function invert3(m: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m as [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

/**
 * The camera's channel multipliers for a white of `kelvin` and `tint`, the
 * smallest 1 (so no channel is pushed before another clips). `camXyz` takes
 * XYZ to the camera's own RGB.
 */
export function multipliersFor(camXyz: Matrix3, kelvin: number, tint: number) {
  const neutral = mul3(camXyz, whiteXyz(kelvin, tint));
  const m = neutral.map((n) => 1 / Math.max(1e-6, n)) as [number, number, number];
  const least = Math.min(...m);
  return m.map((x) => x / least) as [number, number, number];
}

/** The temperature and tint the camera's own multipliers (As Shot) stand for. */
export function kelvinTintOfMultipliers(camXyz: Matrix3, mul: [number, number, number]) {
  const neutral = mul.map((x) => 1 / Math.max(1e-6, x)) as [number, number, number];
  return kelvinTintOf(mul3(invert3(camXyz), neutral));
}

/** White balance presets, as a photo editor names them (Kelvin, tint). */
export const WB_PRESETS: { id: string; label: string; kelvin: number; tint: number }[] = [
  { id: 'daylight', label: 'Daylight', kelvin: 5500, tint: 10 },
  { id: 'cloudy', label: 'Cloudy', kelvin: 6500, tint: 10 },
  { id: 'shade', label: 'Shade', kelvin: 7500, tint: 10 },
  { id: 'tungsten', label: 'Tungsten', kelvin: 2850, tint: 0 },
  { id: 'fluorescent', label: 'Fluorescent', kelvin: 3800, tint: 21 },
  { id: 'flash', label: 'Flash', kelvin: 5500, tint: 0 },
];
