import { SHAPE_PREFIX, stopsOf, type Gradient } from './document';

/**
 * Ready-made gradients for the Elemen panel: a box filled with a fade, laid
 * against an edge of the slide (or over all of it) — the dark band behind a
 * title over a photo, a vignette, a color wash. The box is an ordinary shape:
 * its colors, direction and size can all be changed after.
 */
export interface GradientPreset {
  id: string;
  name: string;
  /** Where it sits on the slide, and how much of the slide's height it covers. */
  place: 'atas' | 'bawah' | 'penuh';
  height: number;
  gradient: Gradient;
}

/** The plain box every preset is drawn with. */
export const GRADIENT_SHAPE = `${SHAPE_PREFIX}kotak`;

const DARK = '#1f2433';

export const GRADIENT_PRESETS: GradientPreset[] = [
  {
    id: 'gelap-bawah',
    name: 'Gelap bawah',
    place: 'bawah',
    height: 0.45,
    gradient: {
      type: 'linear',
      angle: 0,
      from: { color: DARK, alpha: 0 },
      to: { color: DARK, alpha: 0.9 },
    },
  },
  {
    id: 'gelap-atas',
    name: 'Gelap atas',
    place: 'atas',
    height: 0.4,
    gradient: {
      type: 'linear',
      angle: 180,
      from: { color: DARK, alpha: 0 },
      to: { color: DARK, alpha: 0.85 },
    },
  },
  {
    id: 'gelap-penuh',
    name: 'Gelap ke bawah',
    place: 'penuh',
    height: 1,
    gradient: {
      type: 'linear',
      angle: 0,
      from: { color: DARK, alpha: 0.1 },
      to: { color: DARK, alpha: 0.75 },
    },
  },
  {
    id: 'vignette',
    name: 'Vignette',
    place: 'penuh',
    height: 1,
    gradient: {
      type: 'radial',
      angle: 0,
      from: { color: '#000000', alpha: 0 },
      to: { color: '#000000', alpha: 0.65 },
    },
  },
  {
    id: 'terang-bawah',
    name: 'Terang bawah',
    place: 'bawah',
    height: 0.4,
    gradient: {
      type: 'linear',
      angle: 0,
      from: { color: '#ffffff', alpha: 0 },
      to: { color: '#ffffff', alpha: 0.9 },
    },
  },
  {
    id: 'terang-atas',
    name: 'Terang atas',
    place: 'atas',
    height: 0.35,
    gradient: {
      type: 'linear',
      angle: 180,
      from: { color: '#ffffff', alpha: 0 },
      to: { color: '#ffffff', alpha: 0.9 },
    },
  },
  {
    id: 'senja',
    name: 'Senja',
    place: 'penuh',
    height: 1,
    gradient: {
      type: 'linear',
      angle: 45,
      from: { color: '#7c3aed', alpha: 0.35 },
      to: { color: '#f59e0b', alpha: 0.35 },
    },
  },
  {
    id: 'hangat',
    name: 'Hangat',
    place: 'penuh',
    height: 1,
    gradient: {
      type: 'linear',
      angle: 135,
      from: { color: '#f97316', alpha: 0.3 },
      to: { color: '#ec4899', alpha: 0.3 },
    },
  },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** One sampled point of a gradient: where (0–1 along it) and its color. */
export interface GradientStop {
  at: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

/**
 * A gradient as many close stops, so it reads the way design apps draw one:
 * each blend eased in and out (`smooth`), biased to its midpoint, and mixed
 * with premultiplied alpha — a fade to see-through never goes grey on the way.
 * Before the first color and after the last, they simply carry on.
 */
export function gradientStops(g: Gradient, perBlend = 24): GradientStop[] {
  const smooth = clamp01(g.smooth ?? 1);
  const mp = Math.min(0.95, Math.max(0.05, g.midpoint ?? 0.5));
  const bias = (u: number) => (mp === 0.5 ? u : Math.pow(u, Math.log(0.5) / Math.log(mp)));
  const ease = (u: number) => u + (u * u * (3 - 2 * u) - u) * smooth;
  const stops = stopsOf(g).map((s) => ({ ...s, at: clamp01(s.at) }));
  const out: GradientStop[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const p0 = stops[i]!;
    const p1 = stops[i + 1]!;
    const [r0, g0, b0] = rgbOf(p0.color);
    const [r1, g1, b1] = rgbOf(p1.color);
    const steps = p1.at - p0.at < 1e-4 ? 1 : perBlend;
    for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
      const l = ease(bias(k / steps));
      const a = p0.alpha + (p1.alpha - p0.alpha) * l;
      const mix = (x0: number, x1: number) =>
        a > 0.0001 ? (x0 * p0.alpha + (x1 * p1.alpha - x0 * p0.alpha) * l) / a : x0 + (x1 - x0) * l;
      out.push({
        at: p0.at + (p1.at - p0.at) * (k / steps),
        r: mix(r0, r1),
        g: mix(g0, g1),
        b: mix(b0, b1),
        a,
      });
    }
  }
  return out;
}

/** One color of a gradient where it is at `t` (0–1) — for a color added in between. */
export function gradientColorAt(g: Gradient, t: number): { color: string; alpha: number } {
  const all = gradientStops(g, 48);
  const s = all.reduce(
    (best, x) => (Math.abs(x.at - t) < Math.abs(best.at - t) ? x : best),
    all[0]!,
  );
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return { color: `#${hex(s.r)}${hex(s.g)}${hex(s.b)}`, alpha: Math.round(s.a * 100) / 100 };
}

export const stopCss = (s: GradientStop) =>
  `rgba(${Math.round(s.r)}, ${Math.round(s.g)}, ${Math.round(s.b)}, ${s.a.toFixed(3)})`;

/** A gradient as CSS, for previews and the editor's strip — as close as CSS gets. */
export function gradientCss(g: Gradient): string {
  const list = gradientStops(g, 8);
  const stops = (map: (at: number) => number = (at) => at) =>
    list.map((s) => `${stopCss(s)} ${(map(s.at) * 100).toFixed(1)}%`).join(', ');
  const cx = `${Math.round((g.cx ?? 0.5) * 100)}%`;
  const cy = `${Math.round((g.cy ?? 0.5) * 100)}%`;
  // A line set on the canvas, as the nearest CSS angle.
  const angle = g.line
    ? (Math.atan2(g.line.x1 - g.line.x0, g.line.y1 - g.line.y0) * 180) / Math.PI
    : g.angle;
  if (g.type === 'radial') {
    return `radial-gradient(${g.ellipse ? 'ellipse' : 'circle'} at ${cx} ${cy}, ${stops((at) => at * (g.radius ?? 1))})`;
  }
  if (g.type === 'conic') {
    return `conic-gradient(from ${Math.round(g.angle)}deg at ${cx} ${cy}, ${stops()})`;
  }
  if (g.type === 'reflected') {
    const half = list.map((s) => `${stopCss(s)} ${(50 + s.at * 50).toFixed(1)}%`);
    const back = [...list].reverse().map((s) => `${stopCss(s)} ${(50 - s.at * 50).toFixed(1)}%`);
    return `linear-gradient(${180 - angle}deg, ${[...back, ...half].join(', ')})`;
  }
  // CSS 180deg runs top to bottom; ours does at 0.
  return `linear-gradient(${180 - angle}deg, ${stops()})`;
}

// ── Gradasi saya: gradients the photographer kept, in this browser ──

const MINE_KEY = 'pilihfotomu-kolase-gradasi-saya';
/** How many are kept; the oldest go first. */
const MINE_MAX = 24;
const mineListeners = new Set<() => void>();

/** The raw list, for `useSyncExternalStore` (a string, so equal lists compare equal). */
export function readMineRaw(): string {
  try {
    return localStorage.getItem(MINE_KEY) ?? '[]';
  } catch {
    return '[]';
  }
}

export function parseMine(raw: string): Gradient[] {
  try {
    const list: unknown = JSON.parse(raw || '[]');
    return Array.isArray(list) ? (list as Gradient[]) : [];
  } catch {
    return [];
  }
}

function writeMine(list: Gradient[]) {
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(list.slice(0, MINE_MAX)));
  } catch {
    // Storage full or disabled — the list just does not change.
  }
  mineListeners.forEach((l) => l());
}

/** Keeps a gradient, newest first; the same one again moves to the front. */
export function saveMine(g: Gradient) {
  const key = JSON.stringify(g);
  writeMine([g, ...parseMine(readMineRaw()).filter((x) => JSON.stringify(x) !== key)]);
}

export function removeMine(index: number) {
  writeMine(parseMine(readMineRaw()).filter((_, i) => i !== index));
}

export const subscribeMine = (listener: () => void) => {
  mineListeners.add(listener);
  return () => {
    mineListeners.delete(listener);
  };
};
