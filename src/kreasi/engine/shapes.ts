import { SHAPE_PREFIX, type StickerLayer } from './document';

/**
 * Basic shapes: boxes behind text, dividers, thin frames.
 *
 * Unlike stickers they are drawn from their current size rather than scaled
 * from a fixed drawing, so a stretched box keeps round corners round and a
 * line keeps its thickness however long it gets.
 */
export type ShapeKind = 'rect' | 'ellipse' | 'arch' | 'line' | 'polygon' | 'ring';

export interface ShapeDef {
  id: string;
  name: string;
  kind: ShapeKind;
  /** Height ÷ width it starts with. */
  ratio: number;
  /** Rectangles: starting corner, a share of the short side. */
  corner?: number;
  /** Lines: how the stroke is broken up. */
  dash?: 'dash' | 'dot';
  /** Polygons: the corners, as shares (0–1) of the box's width and height. */
  points?: readonly (readonly [number, number])[];
  /** Rings: the hole, as a share of the outer size. */
  inner?: number;
  /** How it starts out — a box behind text wants to be light and see-through. */
  color: string;
  opacity: number;
  size: number;
}

/** Corners of a regular polygon (or a star, with `inner`) filling a unit box. */
function regular(sides: number, inner?: number): [number, number][] {
  const count = inner ? sides * 2 : sides;
  const pts = Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 - Math.PI / 2;
    const r = inner && i % 2 ? inner : 1;
    return [Math.cos(a) * r, Math.sin(a) * r] as const;
  });
  // Stretched to touch every side of the box, so the handles sit on it.
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return pts.map(([x, y]) => [(x - x0) / (x1 - x0), (y - y0) / (y1 - y0)]);
}

/** Points round part of a circle in a unit box — from `a0` to `a1` (radians), about `(cx, cy)`. */
function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, n = 32) {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number];
  });
}

export const SHAPES: ShapeDef[] = [
  {
    id: `${SHAPE_PREFIX}kotak`,
    name: 'Kotak',
    kind: 'rect',
    ratio: 0.6,
    corner: 0,
    color: '#ffffff',
    opacity: 0.85,
    size: 0.5,
  },
  {
    id: `${SHAPE_PREFIX}kotak-bulat`,
    name: 'Kotak membulat',
    kind: 'rect',
    ratio: 0.6,
    corner: 0.15,
    color: '#ffffff',
    opacity: 0.85,
    size: 0.5,
  },
  {
    id: `${SHAPE_PREFIX}pil`,
    name: 'Pil',
    kind: 'rect',
    ratio: 0.28,
    corner: 0.5,
    color: '#ffffff',
    opacity: 0.9,
    size: 0.45,
  },
  {
    id: `${SHAPE_PREFIX}lingkaran`,
    name: 'Lingkaran',
    kind: 'ellipse',
    ratio: 1,
    color: '#c9a96e',
    opacity: 1,
    size: 0.3,
  },
  {
    id: `${SHAPE_PREFIX}lengkung`,
    name: 'Lengkung',
    kind: 'arch',
    ratio: 1.35,
    color: '#f3ead8',
    opacity: 1,
    size: 0.35,
  },
  {
    id: `${SHAPE_PREFIX}segitiga`,
    name: 'Segitiga',
    kind: 'polygon',
    ratio: 0.87,
    points: [
      [0.5, 0],
      [1, 1],
      [0, 1],
    ],
    color: '#c9a96e',
    opacity: 1,
    size: 0.3,
  },
  {
    id: `${SHAPE_PREFIX}belah-ketupat`,
    name: 'Belah ketupat',
    kind: 'polygon',
    ratio: 1.2,
    points: [
      [0.5, 0],
      [1, 0.5],
      [0.5, 1],
      [0, 0.5],
    ],
    color: '#c9a96e',
    opacity: 1,
    size: 0.26,
  },
  {
    id: `${SHAPE_PREFIX}segi-lima`,
    name: 'Segi lima',
    kind: 'polygon',
    ratio: 0.95,
    points: regular(5),
    color: '#c9a96e',
    opacity: 1,
    size: 0.3,
  },
  {
    id: `${SHAPE_PREFIX}segi-enam`,
    name: 'Segi enam',
    kind: 'polygon',
    ratio: 1.15,
    points: regular(6),
    color: '#c9a96e',
    opacity: 1,
    size: 0.28,
  },
  {
    id: `${SHAPE_PREFIX}bintang`,
    name: 'Bintang',
    kind: 'polygon',
    ratio: 0.95,
    points: regular(5, 0.45),
    color: '#c9a96e',
    opacity: 1,
    size: 0.3,
  },
  {
    id: `${SHAPE_PREFIX}jajar-genjang`,
    name: 'Jajar genjang',
    kind: 'polygon',
    ratio: 0.22,
    points: [
      [0.08, 0],
      [1, 0],
      [0.92, 1],
      [0, 1],
    ],
    color: '#ffffff',
    opacity: 1,
    size: 0.6,
  },
  {
    id: `${SHAPE_PREFIX}setengah-lingkaran`,
    name: 'Setengah lingkaran',
    kind: 'polygon',
    ratio: 0.5,
    points: arcPoints(0.5, 1, 0.5, Math.PI, Math.PI * 2),
    color: '#ffffff',
    opacity: 0.85,
    size: 0.4,
  },
  {
    id: `${SHAPE_PREFIX}seperempat-lingkaran`,
    name: 'Seperempat lingkaran',
    kind: 'polygon',
    ratio: 1,
    points: [[0, 1], ...arcPoints(0, 1, 1, -Math.PI / 2, 0)],
    color: '#ffffff',
    opacity: 0.85,
    size: 0.3,
  },
  {
    id: `${SHAPE_PREFIX}cincin`,
    name: 'Cincin',
    kind: 'ring',
    ratio: 1,
    inner: 0.62,
    color: '#ffffff',
    opacity: 0.85,
    size: 0.3,
  },
  {
    id: `${SHAPE_PREFIX}sinar`,
    name: 'Sinar',
    kind: 'polygon',
    ratio: 1,
    points: regular(28, 0.82),
    color: '#c9a96e',
    opacity: 1,
    size: 0.25,
  },
  {
    id: `${SHAPE_PREFIX}garis`,
    name: 'Garis',
    kind: 'line',
    ratio: 0,
    color: '#c9a96e',
    opacity: 1,
    size: 0.5,
  },
  {
    id: `${SHAPE_PREFIX}garis-putus`,
    name: 'Garis putus-putus',
    kind: 'line',
    ratio: 0,
    dash: 'dash',
    color: '#c9a96e',
    opacity: 1,
    size: 0.5,
  },
  {
    id: `${SHAPE_PREFIX}garis-titik`,
    name: 'Garis titik',
    kind: 'line',
    ratio: 0,
    dash: 'dot',
    color: '#c9a96e',
    opacity: 1,
    size: 0.5,
  },
];

export const shapeById = (id: string) => SHAPES.find((s) => s.id === id);

/** Default thickness of lines and outlines, as a fraction of the slide width. */
export const DEFAULT_LINE_WIDTH = 0.005;

export const lineWidthOf = (layer: StickerLayer) => layer.lineWidth ?? DEFAULT_LINE_WIDTH;

/**
 * Traces a shape centered on the origin, `w` × `h`. Lines are traced along the
 * middle; everything else as a closed outline, inset by half the stroke when
 * only the outline is drawn so it stays inside its box.
 */
export function traceShape(
  ctx: CanvasRenderingContext2D,
  def: ShapeDef,
  layer: StickerLayer,
  w: number,
  h: number,
  lw: number,
) {
  ctx.beginPath();
  if (def.kind === 'line') {
    ctx.moveTo(-w / 2 + lw / 2, 0);
    ctx.lineTo(w / 2 - lw / 2, 0);
    return;
  }
  const inset = layer.outline ? lw / 2 : 0;
  const x = -w / 2 + inset;
  const y = -h / 2 + inset;
  const iw = Math.max(0, w - inset * 2);
  const ih = Math.max(0, h - inset * 2);
  if (def.kind === 'polygon') {
    (def.points ?? []).forEach(([px, py], i) => {
      const at: [number, number] = [x + px * iw, y + py * ih];
      if (i === 0) ctx.moveTo(...at);
      else ctx.lineTo(...at);
    });
    ctx.closePath();
  } else if (def.kind === 'ellipse') {
    ctx.ellipse(0, 0, iw / 2, ih / 2, 0, 0, Math.PI * 2);
  } else if (def.kind === 'ring') {
    // The hole runs the other way round, so a plain fill leaves it empty.
    const k = Math.min(0.95, Math.max(0.05, def.inner ?? 0.6));
    ctx.ellipse(0, 0, iw / 2, ih / 2, 0, 0, Math.PI * 2);
    ctx.moveTo((iw / 2) * k, 0);
    ctx.ellipse(0, 0, (iw / 2) * k, (ih / 2) * k, 0, 0, Math.PI * 2, true);
  } else if (def.kind === 'arch') {
    // A half circle on top of a rectangle — a window, an alcove.
    const r = iw / 2;
    const top = y + Math.min(r, ih);
    ctx.moveTo(x, y + ih);
    ctx.lineTo(x, top);
    ctx.arc(0, top, r, Math.PI, 0);
    ctx.lineTo(x + iw, y + ih);
    ctx.closePath();
  } else {
    const r = Math.min(iw, ih) * Math.min(0.5, layer.corner ?? def.corner ?? 0);
    ctx.roundRect(x, y, iw, ih, r);
  }
}
