/**
 * Decorative stickers, drawn as vectors in a box 100 wide (and 100 × ratio tall).
 *
 * Kept as SVG path data rather than images: they stay sharp at any export size,
 * take any color, cost nothing to store or serve, and — unlike SVG files drawn
 * to a canvas — never risk tainting it. The same path data renders the picker
 * thumbnails as <svg>.
 */
export interface StickerPart {
  d: string;
  mode: 'fill' | 'stroke';
  /** Stroke width in the 100-wide box. */
  width?: number;
  dash?: number[];
  opacity?: number;
  /** Fill rule — 'evenodd' punches holes (a film strip's frames). */
  rule?: 'evenodd';
}

export type StickerCategory =
  | 'umum'
  | 'bingkai'
  | 'ikon'
  | 'panah'
  | 'label'
  | 'coretan'
  | 'fotografi'
  | 'alam'
  | 'liburan'
  | 'kuliner'
  | 'pernikahan'
  | 'wisuda'
  | 'ulang-tahun'
  | 'keluarga'
  | 'hari-raya'
  | 'bunga'
  | 'scrapbook';

export const STICKER_CATEGORIES: { id: StickerCategory; label: string }[] = [
  { id: 'umum', label: 'Umum' },
  { id: 'bingkai', label: 'Bingkai & pembatas' },
  { id: 'ikon', label: 'Ikon' },
  { id: 'panah', label: 'Panah' },
  { id: 'label', label: 'Label & gelembung' },
  { id: 'coretan', label: 'Coretan' },
  { id: 'fotografi', label: 'Fotografi' },
  { id: 'alam', label: 'Alam & cuaca' },
  { id: 'liburan', label: 'Liburan' },
  { id: 'kuliner', label: 'Makanan & minuman' },
  { id: 'pernikahan', label: 'Pernikahan' },
  { id: 'wisuda', label: 'Wisuda' },
  { id: 'ulang-tahun', label: 'Ulang tahun' },
  { id: 'keluarga', label: 'Bayi & keluarga' },
  { id: 'hari-raya', label: 'Hari raya' },
  { id: 'bunga', label: 'Bunga & daun' },
  { id: 'scrapbook', label: 'Scrapbook' },
];

export interface StickerDef {
  id: string;
  name: string;
  category: StickerCategory;
  parts: StickerPart[];
  /** Height ÷ width of the drawing, for hit-testing and the selection box. */
  ratio: number;
  /** Starting tint, when gold is not the obvious choice (white paper, say). */
  color?: string;
  /** Kept only so older collages still draw; the Bentuk section replaces it. */
  retired?: boolean;
}

// ── Path helpers ──

const n = (v: number) => Number(v.toFixed(1));

const circle = (cx: number, cy: number, r: number) =>
  `M${n(cx - r)} ${n(cy)} a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0 a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;

/**
 * Moves every point of an absolute path (M L C Q S T H V Z only). Used to
 * mirror one half of a symmetric ornament and to resize a shape in place.
 */
function mapPath(d: string, fx: (x: number) => number, fy: (y: number) => number): string {
  const tokens = d.match(/[MLCQSTHVZ]|-?\d*\.?\d+/g) ?? [];
  let cmd = '';
  let axis = 0;
  return tokens
    .map((t) => {
      if (/[A-Z]/.test(t)) {
        cmd = t;
        axis = 0;
        return t;
      }
      const v = Number(t);
      if (cmd === 'H') return String(n(fx(v)));
      if (cmd === 'V') return String(n(fy(v)));
      const out = axis === 0 ? fx(v) : fy(v);
      axis = 1 - axis;
      return String(n(out));
    })
    .join(' ');
}

const mirrorX = (d: string) =>
  mapPath(
    d,
    (x) => 100 - x,
    (y) => y,
  );

const HEART =
  'M50 88 C20 64 6 46 6 30 C6 16 17 7 30 7 C40 7 47 13 50 21 C53 13 60 7 70 7 C83 7 94 16 94 30 C94 46 80 64 50 88Z';
/** The heart above, scaled by `s` around (cx, cy). */
const heart = (cx: number, cy: number, s: number) =>
  mapPath(
    HEART,
    (x) => cx + (x - 50) * s,
    (y) => cy + (y - 48) * s,
  );

/** A pointed leaf from its base, `len` long, facing `angle` (radians). */
function leaf(bx: number, by: number, angle: number, len: number, wid: number): string {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const tx = bx + dx * len;
  const ty = by + dy * len;
  const mx = bx + (dx * len) / 2;
  const my = by + (dy * len) / 2;
  return (
    `M${n(bx)} ${n(by)} Q${n(mx - dy * wid)} ${n(my + dx * wid)} ${n(tx)} ${n(ty)} ` +
    `Q${n(mx + dy * wid)} ${n(my - dx * wid)} ${n(bx)} ${n(by)}Z`
  );
}

/**
 * A leafy branch along a circular arc from angle `a0` to `a1` (degrees, y down):
 * the stem, pairs of leaves along it and one at the tip.
 */
function arcBranch(o: {
  cx: number;
  cy: number;
  r: number;
  a0: number;
  a1: number;
  leaves: number;
  len: number;
  wid: number;
  spread: number;
}): { stem: string; leaves: string } {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const at = (deg: number) =>
    [o.cx + Math.cos(rad(deg)) * o.r, o.cy + Math.sin(rad(deg)) * o.r] as const;
  const dir = Math.sign(o.a1 - o.a0);
  const stem = Array.from({ length: 25 }, (_, i) => {
    const [x, y] = at(o.a0 + ((o.a1 - o.a0) * i) / 24);
    return `${i === 0 ? 'M' : 'L'}${n(x)} ${n(y)}`;
  }).join(' ');
  const parts: string[] = [];
  for (let i = 0; i < o.leaves; i++) {
    const deg = o.a0 + ((o.a1 - o.a0) * (i + 0.6)) / (o.leaves + 0.4);
    const [x, y] = at(deg);
    // Direction of travel along the arc, then the two leaves either side of it.
    const tangent = rad(deg) + (dir * Math.PI) / 2;
    parts.push(leaf(x, y, tangent - rad(o.spread), o.len, o.wid));
    parts.push(leaf(x, y, tangent + rad(o.spread), o.len, o.wid));
  }
  const [ex, ey] = at(o.a1);
  parts.push(leaf(ex, ey, rad(o.a1) + (dir * Math.PI) / 2, o.len * 1.1, o.wid));
  return { stem, leaves: parts.join(' ') };
}

type Pt = readonly [number, number];

/** A closed outline through the points. */
const poly = (pts: readonly Pt[]) => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L')}Z`;

/** An open line through the points. */
const polyline = (pts: readonly Pt[]) => `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join(' L')}`;

/** A rectangle, with rounded corners when `r` is given. */
const rrect = (x: number, y: number, w: number, h: number, r = 0) =>
  r
    ? `M${n(x + r)} ${n(y)} H${n(x + w - r)} Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)} ` +
      `V${n(y + h - r)} Q${n(x + w)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)} H${n(x + r)} ` +
      `Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - r)} V${n(y + r)} Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}Z`
    : `M${n(x)} ${n(y)} H${n(x + w)} V${n(y + h)} H${n(x)}Z`;

const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${n(cx - rx)} ${n(cy)} a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0 ` +
  `a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0Z`;

/** Points along a circle from `a0` to `a1` degrees (0 is to the right, y down). */
const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number, steps = 24): Pt[] =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
  });

/** A star — or, with many points close together, a rosette badge. */
const star = (cx: number, cy: number, points: number, outer: number, inner: number) =>
  poly(
    Array.from({ length: points * 2 }, (_, i) => {
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? inner : outer;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as const;
    }),
  );

/** Short strokes pointing out from a center, `from` to `to` away from it. */
const rays = (cx: number, cy: number, count: number, from: number, to: number, turn = 0) =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + turn;
    const [c, si] = [Math.cos(a), Math.sin(a)];
    return `M${n(cx + c * from)} ${n(cy + si * from)} L${n(cx + c * to)} ${n(cy + si * to)}`;
  }).join(' ');

/** A crescent moon: a circle less the same circle moved `shift` to the right. */
function crescent(cx: number, cy: number, r: number, shift: number): string {
  const ix = cx + shift / 2;
  const iy = Math.sqrt(r * r - (shift / 2) ** 2);
  const deg = (x: number, y: number, ox: number) => (Math.atan2(y - cy, x - ox) * 180) / Math.PI;
  const outerTop = deg(ix, cy - iy, cx);
  const outerBottom = deg(ix, cy + iy, cx);
  const innerTop = deg(ix, cy - iy, cx + shift);
  const innerBottom = deg(ix, cy + iy, cx + shift);
  return poly([
    // Round the left from the top tip to the bottom one, then back along the bite.
    ...arcPts(cx, cy, r, outerTop, outerBottom - 360, 36),
    ...arcPts(cx + shift, cy, r, innerBottom, innerTop + 360, 36),
  ]);
}

// ── Drawings built from the helpers ──

const flowerPetals = Array.from({ length: 5 }, (_, i) => {
  const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
  return circle(50 + Math.cos(a) * 22, 50 + Math.sin(a) * 22, 19);
}).join(' ');

const starPoints = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
  const r = i % 2 === 0 ? 46 : 19;
  return `${n(50 + Math.cos(a) * r)} ${n(52 + Math.sin(a) * r)}`;
});

const laurelLeft = arcBranch({
  cx: 50,
  cy: 50,
  r: 38,
  a0: 100,
  a1: 228,
  leaves: 6,
  len: 15,
  wid: 9,
  spread: 42,
});
const laurelRight = arcBranch({
  cx: 50,
  cy: 50,
  r: 38,
  a0: 80,
  a1: -48,
  leaves: 6,
  len: 15,
  wid: 9,
  spread: 42,
});

const wreathLeft = arcBranch({
  cx: 50,
  cy: 50,
  r: 36,
  a0: 96,
  a1: 262,
  leaves: 8,
  len: 12,
  wid: 7,
  spread: 45,
});
const wreathRight = arcBranch({
  cx: 50,
  cy: 50,
  r: 36,
  a0: 84,
  a1: -82,
  leaves: 8,
  len: 12,
  wid: 7,
  spread: 45,
});

/** Eucalyptus: round leaves in pairs up a gently curving stem. */
const eucalyptus = (() => {
  const stem = 'M50 118 C46 90 56 60 50 8';
  const pts = [
    [49, 100, 10],
    [51, 80, 9],
    [52, 60, 8.5],
    [51, 42, 7.5],
    [50, 27, 6.5],
  ] as const;
  const leaves = pts
    .map(([x, y, r], i) => {
      const off = r + 3;
      const lift = i % 2 ? -3 : 3;
      return `${circle(x - off, y + lift, r)} ${circle(x + off, y - lift, r)}`;
    })
    .join(' ');
  return { stem, leaves: `${leaves} ${circle(50, 12, 5.5)}` };
})();

/** A strip of paper with a ragged edge top and bottom. */
const tornPaper = (() => {
  const edge = (y: number, flip: number) =>
    Array.from({ length: 21 }, (_, i) => {
      const x = i * 5;
      const wobble = Math.sin(i * 2.7) * 1.6 + Math.sin(i * 5.3) * 1.1;
      return [x, y + flip * (2 + wobble)] as const;
    });
  const top = edge(4, 1);
  const bottom = edge(46, -1).reverse();
  return `M${[...top, ...bottom].map(([x, y]) => `${n(x)} ${n(y)}`).join(' L')}Z`;
})();

/** Film strip: sprocket holes along both edges, three frames — holes, by even-odd. */
const filmStrip = (() => {
  const rect = (x: number, y: number, w: number, h: number) =>
    `M${x} ${y} H${x + w} V${y + h} H${x}Z`;
  const holes = Array.from(
    { length: 12 },
    (_, i) => `${rect(2.5 + i * 8.3, 3, 4, 4)} ${rect(2.5 + i * 8.3, 31, 4, 4)}`,
  );
  const frames = [0, 1, 2].map((i) => rect(3 + i * 32.3, 10, 29.4, 18));
  return [rect(0, 0, 100, 38), ...holes, ...frames].join(' ');
})();

/** A scatter of confetti: dots, little bars and squiggles. */
const confetti = (() => {
  const dots = [
    [14, 20, 3.5],
    [70, 12, 3],
    [88, 44, 4],
    [30, 62, 3],
    [60, 84, 3.5],
    [12, 86, 2.5],
    [48, 36, 2.5],
  ]
    .map(([x, y, r]) => circle(x!, y!, r!))
    .join(' ');
  const bars = [
    [36, 14, 0.6],
    [84, 72, 2.2],
    [22, 44, 2.6],
    [58, 58, 0.3],
    [40, 90, 1.2],
  ]
    .map(([x, y, a]) => {
      const dx = Math.cos(a!) * 6;
      const dy = Math.sin(a!) * 6;
      return `M${n(x! - dx)} ${n(y! - dy)} L${n(x! + dx)} ${n(y! + dy)}`;
    })
    .join(' ');
  const squiggles = 'M70 28 C74 24 78 32 82 28 M8 62 C12 58 16 66 20 62 M76 90 C80 86 84 94 88 90';
  return { dots, bars, squiggles };
})();

const flourishLeft =
  'M44 15 C36 15 33 6 25 7 C17 8 17 19 24 19 C29 19 30 13 26 12 M44 15 C32 18 18 24 4 15';

export const STICKERS: StickerDef[] = [
  // ── Umum ──
  {
    id: 'hati',
    name: 'Hati',
    category: 'umum',
    ratio: 1,
    parts: [{ d: HEART, mode: 'fill' }],
  },
  {
    id: 'bintang',
    name: 'Bintang',
    category: 'umum',
    ratio: 1,
    parts: [{ d: `M${starPoints.join(' L')}Z`, mode: 'fill' }],
  },
  {
    id: 'kilau',
    name: 'Kilau',
    category: 'umum',
    ratio: 1,
    parts: [
      {
        d: 'M50 4 C54 38 62 46 96 50 C62 54 54 62 50 96 C46 62 38 54 4 50 C38 46 46 38 50 4Z',
        mode: 'fill',
      },
    ],
  },
  {
    id: 'pita',
    name: 'Pita label',
    category: 'umum',
    ratio: 0.32,
    parts: [
      { d: 'M20 9 H1 L8 19.5 L1 30 H20Z', mode: 'fill', opacity: 0.65 },
      { d: mirrorX('M20 9 H1 L8 19.5 L1 30 H20Z'), mode: 'fill', opacity: 0.65 },
      { d: 'M13 2 H87 V24 H13Z', mode: 'fill' },
    ],
  },
  {
    id: 'panah',
    name: 'Panah',
    category: 'umum',
    ratio: 0.6,
    parts: [
      { d: 'M8 50 C26 16 58 8 88 22', mode: 'stroke', width: 3 },
      { d: 'M74 12 L89 22 L76 34', mode: 'stroke', width: 3 },
    ],
  },
  {
    id: 'lengkung',
    name: 'Lengkung',
    category: 'umum',
    ratio: 1,
    parts: [
      { d: 'M14 96 V52 A36 36 0 0 1 86 52 V96', mode: 'stroke', width: 3 },
      { d: 'M26 96 V54 A24 24 0 0 1 74 54 V96', mode: 'stroke', width: 3 },
      { d: 'M38 96 V56 A12 12 0 0 1 62 56 V96', mode: 'stroke', width: 3 },
    ],
  },
  {
    id: 'garis-putus',
    name: 'Jejak putus',
    category: 'umum',
    ratio: 1,
    parts: [
      {
        d: 'M8 80 C20 40 44 34 50 52 C56 70 34 76 32 60 C30 40 70 18 92 24',
        mode: 'stroke',
        width: 3,
        dash: [7, 6],
      },
    ],
  },
  {
    id: 'sudut',
    name: 'Sudut',
    category: 'umum',
    ratio: 1,
    parts: [
      { d: 'M8 40 V8 H40', mode: 'stroke', width: 3.5 },
      { d: 'M60 92 H92 V60', mode: 'stroke', width: 3.5 },
    ],
  },

  // ── Pernikahan ──
  {
    id: 'cincin',
    name: 'Cincin',
    category: 'pernikahan',
    ratio: 0.72,
    parts: [
      { d: circle(38, 44, 22), mode: 'stroke', width: 3.5 },
      { d: circle(62, 44, 22), mode: 'stroke', width: 3.5 },
      { d: 'M31 15 L38 6 L45 15 L38 23Z', mode: 'fill' },
    ],
  },
  {
    id: 'lingkar-daun',
    name: 'Lingkar daun',
    category: 'pernikahan',
    ratio: 1,
    parts: [
      { d: `${wreathLeft.stem} ${wreathRight.stem}`, mode: 'stroke', width: 1.6 },
      { d: `${wreathLeft.leaves} ${wreathRight.leaves}`, mode: 'fill' },
    ],
  },
  {
    id: 'hiasan-garis',
    name: 'Hiasan garis',
    category: 'pernikahan',
    ratio: 0.3,
    parts: [
      { d: `${flourishLeft} ${mirrorX(flourishLeft)}`, mode: 'stroke', width: 2.2 },
      { d: 'M50 9 L55 15 L50 21 L45 15Z', mode: 'fill' },
    ],
  },
  {
    id: 'sudut-hias',
    name: 'Sudut hias',
    category: 'pernikahan',
    ratio: 1,
    parts: [
      { d: 'M8 70 V22 C8 14 14 8 22 8 H70', mode: 'stroke', width: 2.2 },
      {
        d: 'M8 44 C22 42 30 32 27 23 C25 17 17 17 16 23 M44 8 C42 22 32 30 23 27',
        mode: 'stroke',
        width: 1.8,
      },
      { d: circle(21, 21, 3.2), mode: 'fill' },
      { d: `${circle(8, 76, 2.2)} ${circle(76, 8, 2.2)}`, mode: 'fill' },
    ],
  },
  {
    id: 'hati-ganda',
    name: 'Hati berdua',
    category: 'pernikahan',
    ratio: 0.8,
    parts: [
      { d: heart(38, 42, 0.62), mode: 'stroke', width: 3 },
      { d: heart(62, 42, 0.62), mode: 'stroke', width: 3 },
    ],
  },

  // ── Wisuda ──
  {
    id: 'toga',
    name: 'Topi toga',
    category: 'wisuda',
    ratio: 0.8,
    parts: [
      { d: 'M25 38 V56 C25 66 75 66 75 56 V38 L50 48Z', mode: 'fill', opacity: 0.8 },
      { d: 'M50 8 L96 27 L50 46 L4 27Z', mode: 'fill' },
      { d: 'M50 27 L84 34 V60', mode: 'stroke', width: 2.2 },
      { d: 'M81 58 H87 L90 72 H78Z', mode: 'fill' },
    ],
  },
  {
    id: 'laurel',
    name: 'Laurel',
    category: 'wisuda',
    ratio: 1,
    parts: [
      { d: `${laurelLeft.stem} ${laurelRight.stem}`, mode: 'stroke', width: 2 },
      { d: `${laurelLeft.leaves} ${laurelRight.leaves}`, mode: 'fill' },
    ],
  },
  {
    id: 'ijazah',
    name: 'Ijazah',
    category: 'wisuda',
    ratio: 0.5,
    parts: [
      { d: 'M16 14 H84 V38 H16Z', mode: 'fill', opacity: 0.45 },
      { d: `${circle(16, 26, 12)} ${circle(84, 26, 12)}`, mode: 'stroke', width: 2.5 },
      { d: 'M46 13 V39 M54 13 V39', mode: 'stroke', width: 3 },
      { d: 'M50 39 L41 49 M50 39 L59 49', mode: 'stroke', width: 3 },
    ],
  },

  // ── Ulang tahun ──
  {
    id: 'balon',
    name: 'Balon',
    category: 'ulang-tahun',
    ratio: 1.4,
    parts: [
      {
        d: 'M50 6 C74 6 86 26 86 46 C86 72 64 92 50 94 C36 92 14 72 14 46 C14 26 26 6 50 6Z',
        mode: 'fill',
      },
      { d: 'M45 100 L50 93 L55 100Z', mode: 'fill' },
      { d: 'M50 100 C43 112 57 122 50 136', mode: 'stroke', width: 1.6 },
    ],
  },
  {
    id: 'kue',
    name: 'Kue',
    category: 'ulang-tahun',
    ratio: 0.95,
    parts: [
      { d: 'M12 60 H88 V92 H12Z', mode: 'fill' },
      { d: 'M22 36 H78 V60 H22Z', mode: 'fill', opacity: 0.7 },
      { d: 'M47 16 H53 V36 H47Z', mode: 'fill' },
      { d: 'M50 2 C56 8 56 13 50 14 C44 13 44 8 50 2Z', mode: 'fill', opacity: 0.8 },
    ],
  },
  {
    id: 'topi-pesta',
    name: 'Topi pesta',
    category: 'ulang-tahun',
    ratio: 1,
    parts: [
      { d: 'M50 12 L80 86 H20Z', mode: 'fill' },
      { d: circle(50, 10, 7), mode: 'fill', opacity: 0.75 },
      { d: 'M14 90 H86', mode: 'stroke', width: 4 },
    ],
  },
  {
    id: 'konfeti',
    name: 'Konfeti',
    category: 'ulang-tahun',
    ratio: 1,
    parts: [
      { d: confetti.dots, mode: 'fill' },
      { d: confetti.bars, mode: 'stroke', width: 3.5 },
      { d: confetti.squiggles, mode: 'stroke', width: 2.5, opacity: 0.8 },
    ],
  },

  // ── Bunga ──
  {
    id: 'daun',
    name: 'Daun',
    category: 'bunga',
    ratio: 1,
    parts: [
      { d: 'M50 6 C82 26 86 64 50 94 C14 64 18 26 50 6Z', mode: 'fill' },
      { d: 'M50 16 V88', mode: 'stroke', width: 2.5, opacity: 0.35 },
    ],
  },
  {
    id: 'ranting',
    name: 'Ranting',
    category: 'bunga',
    ratio: 1,
    parts: [
      { d: 'M50 96 C48 64 52 36 50 4', mode: 'stroke', width: 3 },
      { d: 'M50 70 C30 66 22 54 24 44 C36 46 46 56 50 70Z', mode: 'fill' },
      { d: 'M50 54 C70 50 78 38 76 28 C64 30 54 40 50 54Z', mode: 'fill' },
      { d: 'M50 36 C34 32 28 22 30 12 C40 14 48 24 50 36Z', mode: 'fill' },
    ],
  },
  {
    id: 'bunga',
    name: 'Bunga',
    category: 'bunga',
    ratio: 1,
    parts: [
      { d: flowerPetals, mode: 'fill', opacity: 0.85 },
      { d: circle(50, 50, 11), mode: 'fill' },
    ],
  },
  {
    id: 'eukaliptus',
    name: 'Eukaliptus',
    category: 'bunga',
    ratio: 1.2,
    parts: [
      { d: eucalyptus.stem, mode: 'stroke', width: 2 },
      { d: eucalyptus.leaves, mode: 'fill', opacity: 0.85 },
    ],
  },
  {
    id: 'tulip',
    name: 'Tulip',
    category: 'bunga',
    ratio: 1.3,
    parts: [
      { d: 'M50 58 C48 80 52 104 50 126', mode: 'stroke', width: 3 },
      { d: 'M50 110 C34 106 26 92 28 78 C40 82 48 94 50 110Z', mode: 'fill', opacity: 0.75 },
      {
        d: 'M30 20 L40 32 L50 14 L60 32 L70 20 C74 44 66 60 50 60 C34 60 26 44 30 20Z',
        mode: 'fill',
      },
    ],
  },

  // ── Scrapbook ──
  {
    id: 'selotip',
    name: 'Selotip',
    category: 'scrapbook',
    ratio: 0.36,
    parts: [
      {
        d: 'M4 4 L10 9 L4 14 L10 19 L4 24 L10 29 L4 33 H96 L90 29 L96 24 L90 19 L96 14 L90 9 L96 4Z',
        mode: 'fill',
        opacity: 0.55,
      },
    ],
  },
  {
    id: 'selotip-polos',
    name: 'Selotip polos',
    category: 'scrapbook',
    ratio: 0.3,
    parts: [{ d: 'M3 3 L97 1 L96 29 L4 30Z', mode: 'fill', opacity: 0.5 }],
  },
  {
    id: 'klip',
    name: 'Klip kertas',
    category: 'scrapbook',
    ratio: 2,
    parts: [
      {
        d: 'M58 50 V150 C58 166 38 166 38 150 V30 C38 8 74 8 74 30 V160 C74 192 22 192 22 160 V60',
        mode: 'stroke',
        width: 5,
      },
    ],
  },
  {
    id: 'film',
    name: 'Potongan film',
    category: 'scrapbook',
    ratio: 0.38,
    color: '#1f2a24',
    parts: [{ d: filmStrip, mode: 'fill', rule: 'evenodd' }],
  },
  {
    id: 'sobekan',
    name: 'Sobekan kertas',
    category: 'scrapbook',
    ratio: 0.5,
    color: '#ffffff',
    parts: [{ d: tornPaper, mode: 'fill' }],
  },
  {
    id: 'paku',
    name: 'Paku payung',
    category: 'scrapbook',
    ratio: 1.2,
    parts: [
      { d: 'M50 50 L50 116', mode: 'stroke', width: 2.5, opacity: 0.6 },
      { d: circle(50, 30, 22), mode: 'fill' },
    ],
  },

  // ── Umum, more ──
  {
    id: 'centang',
    name: 'Centang',
    category: 'umum',
    ratio: 0.8,
    parts: [
      {
        d: polyline([
          [10, 42],
          [36, 68],
          [90, 12],
        ]),
        mode: 'stroke',
        width: 7,
      },
    ],
  },
  {
    id: 'kilau-tiga',
    name: 'Kilau bertiga',
    category: 'umum',
    ratio: 1,
    parts: [
      { d: star(38, 58, 4, 34, 7), mode: 'fill' },
      { d: star(78, 22, 4, 18, 4), mode: 'fill' },
      { d: star(80, 78, 4, 11, 2.5), mode: 'fill' },
    ],
  },
  {
    id: 'hati-kecil',
    name: 'Hati bertiga',
    category: 'umum',
    ratio: 0.6,
    parts: [
      { d: heart(22, 36, 0.3), mode: 'fill' },
      { d: heart(52, 28, 0.42), mode: 'fill' },
      { d: heart(82, 38, 0.26), mode: 'fill' },
    ],
  },

  // ── Panah ──
  {
    id: 'panah-lurus',
    name: 'Panah lurus',
    category: 'panah',
    ratio: 0.4,
    parts: [
      { d: 'M6 20 H90', mode: 'stroke', width: 3.5 },
      {
        d: polyline([
          [78, 8],
          [92, 20],
          [78, 32],
        ]),
        mode: 'stroke',
        width: 3.5,
      },
    ],
  },
  {
    id: 'panah-dua',
    name: 'Panah dua arah',
    category: 'panah',
    ratio: 0.4,
    parts: [
      { d: 'M10 20 H90', mode: 'stroke', width: 3.5 },
      {
        d: polyline([
          [22, 8],
          [8, 20],
          [22, 32],
        ]),
        mode: 'stroke',
        width: 3.5,
      },
      {
        d: polyline([
          [78, 8],
          [92, 20],
          [78, 32],
        ]),
        mode: 'stroke',
        width: 3.5,
      },
    ],
  },
  {
    id: 'panah-blok',
    name: 'Panah tebal',
    category: 'panah',
    ratio: 0.7,
    parts: [
      {
        d: poly([
          [4, 24],
          [58, 24],
          [58, 5],
          [96, 35],
          [58, 65],
          [58, 46],
          [4, 46],
        ]),
        mode: 'fill',
      },
    ],
  },
  {
    id: 'panah-zigzag',
    name: 'Panah zig-zag',
    category: 'panah',
    ratio: 0.7,
    parts: [
      {
        d: polyline([
          [6, 62],
          [28, 34],
          [46, 52],
          [72, 18],
        ]),
        mode: 'stroke',
        width: 3.5,
      },
      {
        d: polyline([
          [57, 16],
          [73, 17],
          [72, 33],
        ]),
        mode: 'stroke',
        width: 3.5,
      },
    ],
  },
  {
    id: 'panah-putar',
    name: 'Panah melingkar',
    category: 'panah',
    ratio: 0.75,
    parts: [
      {
        d: 'M8 64 C4 30 38 8 60 24 C78 38 64 60 48 50 C32 40 52 14 86 20',
        mode: 'stroke',
        width: 3,
      },
      {
        d: polyline([
          [74, 9],
          [88, 20],
          [76, 32],
        ]),
        mode: 'stroke',
        width: 3,
      },
    ],
  },
  {
    id: 'panah-turun',
    name: 'Panah menunjuk',
    category: 'panah',
    ratio: 0.9,
    parts: [
      { d: 'M14 8 C64 6 90 30 80 76', mode: 'stroke', width: 3.5 },
      {
        d: polyline([
          [68, 64],
          [80, 80],
          [93, 66],
        ]),
        mode: 'stroke',
        width: 3.5,
      },
    ],
  },

  // ── Label & gelembung ──
  {
    id: 'lencana',
    name: 'Lencana',
    category: 'label',
    ratio: 1,
    parts: [{ d: star(50, 50, 16, 48, 41), mode: 'fill' }],
  },
  {
    id: 'gelembung',
    name: 'Gelembung bicara',
    category: 'label',
    ratio: 0.8,
    color: '#ffffff',
    parts: [
      { d: rrect(4, 4, 92, 54, 14), mode: 'fill' },
      {
        d: poly([
          [20, 52],
          [14, 76],
          [42, 52],
        ]),
        mode: 'fill',
      },
    ],
  },
  {
    id: 'gelembung-pikir',
    name: 'Gelembung pikiran',
    category: 'label',
    ratio: 0.85,
    color: '#ffffff',
    parts: [
      {
        d: [
          circle(30, 36, 18),
          circle(50, 26, 22),
          circle(72, 36, 18),
          circle(40, 48, 16),
          circle(62, 48, 16),
        ].join(' '),
        mode: 'fill',
      },
      { d: `${circle(22, 70, 6)} ${circle(11, 80, 4)}`, mode: 'fill' },
    ],
  },
  {
    id: 'tag',
    name: 'Label gantung',
    category: 'label',
    ratio: 0.6,
    parts: [
      {
        d: `${poly([
          [4, 30],
          [24, 8],
          [96, 8],
          [96, 52],
          [24, 52],
        ])} ${circle(22, 30, 5)}`,
        mode: 'fill',
        rule: 'evenodd',
      },
    ],
  },
  {
    id: 'bingkai-oval',
    name: 'Bingkai oval',
    category: 'label',
    ratio: 1.25,
    parts: [
      {
        d: `${ellipse(50, 62.5, 47, 59)} ${ellipse(50, 62.5, 41, 53)}`,
        mode: 'fill',
        rule: 'evenodd',
      },
    ],
  },
  {
    id: 'kurung-hias',
    name: 'Kurung hias',
    category: 'label',
    ratio: 0.9,
    parts: [
      {
        d: 'M26 4 C12 4 14 18 14 28 C14 38 8 44 3 45 C8 46 14 52 14 62 C14 72 12 86 26 86',
        mode: 'stroke',
        width: 3,
      },
      {
        d: mirrorX('M26 4 C12 4 14 18 14 28 C14 38 8 44 3 45 C8 46 14 52 14 62 C14 72 12 86 26 86'),
        mode: 'stroke',
        width: 3,
      },
    ],
  },
  {
    id: 'sapuan',
    name: 'Sapuan kuas',
    category: 'label',
    ratio: 0.28,
    parts: [
      {
        d: 'M4 16 C24 6 64 4 96 8 C99 12 96 15 92 14 C64 12 30 16 8 24 C3 24 2 19 4 16Z',
        mode: 'fill',
      },
    ],
  },

  // ── Coretan ──
  {
    id: 'coretan',
    name: 'Garis berkelok',
    category: 'coretan',
    ratio: 0.5,
    parts: [
      {
        d: 'M4 25 C12 5 22 45 32 25 C42 5 52 45 62 25 C72 5 82 45 96 25',
        mode: 'stroke',
        width: 3,
      },
    ],
  },
  {
    id: 'lingkar-coret',
    name: 'Lingkaran coret',
    category: 'coretan',
    ratio: 0.9,
    parts: [
      {
        d: 'M58 10 C26 4 4 26 8 50 C12 78 50 90 76 76 C96 62 94 28 68 14 C56 8 40 10 30 16',
        mode: 'stroke',
        width: 2.5,
      },
    ],
  },
  {
    id: 'hati-garis',
    name: 'Hati garis',
    category: 'coretan',
    ratio: 1,
    parts: [{ d: HEART, mode: 'stroke', width: 3.5 }],
  },
  {
    id: 'bintang-garis',
    name: 'Bintang garis',
    category: 'coretan',
    ratio: 1,
    parts: [{ d: `M${starPoints.join(' L')}Z`, mode: 'stroke', width: 3.5 }],
  },
  {
    id: 'spiral',
    name: 'Spiral',
    category: 'coretan',
    ratio: 1,
    parts: [
      {
        d: polyline(
          Array.from({ length: 121 }, (_, i) => {
            const a = (i / 120) * Math.PI * 6;
            const r = 3 + (i / 120) * 42;
            return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r] as const;
          }),
        ),
        mode: 'stroke',
        width: 3,
      },
    ],
  },
  {
    id: 'gelombang',
    name: 'Gelombang',
    category: 'coretan',
    ratio: 0.4,
    parts: [
      {
        d: 'M4 20 C14 6 24 6 34 20 C44 34 54 34 64 20 C74 6 84 6 96 20',
        mode: 'stroke',
        width: 3,
      },
    ],
  },
  {
    id: 'sinar',
    name: 'Sinar',
    category: 'coretan',
    ratio: 1,
    parts: [{ d: rays(50, 50, 12, 24, 46), mode: 'stroke', width: 3.5 }],
  },
  {
    id: 'pola-titik',
    name: 'Pola titik',
    category: 'coretan',
    ratio: 1,
    parts: [
      {
        d: Array.from({ length: 16 }, (_, i) =>
          circle(14 + (i % 4) * 24, 14 + Math.floor(i / 4) * 24, 4),
        ).join(' '),
        mode: 'fill',
      },
    ],
  },

  // ── Fotografi ──
  {
    id: 'kamera',
    name: 'Kamera',
    category: 'fotografi',
    ratio: 0.8,
    parts: [
      {
        d: [
          rrect(6, 22, 88, 54, 9),
          circle(50, 49, 19),
          circle(50, 49, 12),
          circle(80, 33, 4),
        ].join(' '),
        mode: 'fill',
        rule: 'evenodd',
      },
      { d: rrect(30, 11, 26, 11, 3), mode: 'fill' },
    ],
  },
  {
    id: 'polaroid',
    name: 'Bingkai polaroid',
    category: 'fotografi',
    ratio: 1.2,
    color: '#ffffff',
    parts: [
      { d: `${rrect(0, 0, 100, 120, 3)} ${rrect(8, 8, 84, 84)}`, mode: 'fill', rule: 'evenodd' },
    ],
  },
  {
    id: 'bidik',
    name: 'Bidikan kamera',
    category: 'fotografi',
    ratio: 0.75,
    color: '#ffffff',
    parts: [
      {
        d: 'M4 18 V4 H20 M80 4 H96 V18 M96 57 V71 H80 M20 71 H4 V57',
        mode: 'stroke',
        width: 3,
      },
      { d: 'M50 29 V46 M41.5 37.5 H58.5', mode: 'stroke', width: 2 },
    ],
  },
  {
    id: 'kilat',
    name: 'Kilat',
    category: 'fotografi',
    ratio: 1.3,
    parts: [
      {
        d: poly([
          [58, 4],
          [18, 72],
          [46, 72],
          [36, 126],
          [82, 52],
          [54, 52],
          [66, 4],
        ]),
        mode: 'fill',
      },
    ],
  },

  // ── Alam & cuaca ──
  {
    id: 'matahari',
    name: 'Matahari',
    category: 'alam',
    ratio: 1,
    parts: [
      { d: circle(50, 50, 20), mode: 'fill' },
      { d: rays(50, 50, 8, 28, 44, Math.PI / 8), mode: 'stroke', width: 5 },
    ],
  },
  {
    id: 'awan',
    name: 'Awan',
    category: 'alam',
    ratio: 0.7,
    color: '#ffffff',
    parts: [
      {
        d: [
          circle(28, 46, 16),
          circle(48, 34, 20),
          circle(70, 44, 17),
          circle(38, 52, 13),
          circle(60, 54, 13),
        ].join(' '),
        mode: 'fill',
      },
    ],
  },
  {
    id: 'pelangi',
    name: 'Pelangi',
    category: 'alam',
    ratio: 0.55,
    parts: [
      { d: polyline(arcPts(50, 52, 44, 180, 360)), mode: 'stroke', width: 8 },
      { d: polyline(arcPts(50, 52, 33, 180, 360)), mode: 'stroke', width: 8, opacity: 0.7 },
      { d: polyline(arcPts(50, 52, 22, 180, 360)), mode: 'stroke', width: 8, opacity: 0.45 },
    ],
  },
  {
    id: 'gunung',
    name: 'Gunung',
    category: 'alam',
    ratio: 0.6,
    parts: [
      {
        d: poly([
          [40, 58],
          [70, 20],
          [98, 58],
        ]),
        mode: 'fill',
        opacity: 0.55,
      },
      {
        d: poly([
          [2, 58],
          [34, 8],
          [66, 58],
        ]),
        mode: 'fill',
      },
    ],
  },
  {
    id: 'ombak',
    name: 'Ombak',
    category: 'alam',
    ratio: 0.5,
    parts: [12, 25, 38].map((y, i) => ({
      d: `M4 ${y} C14 ${y - 9} 24 ${y - 9} 34 ${y} C44 ${y + 9} 54 ${y + 9} 64 ${y} C74 ${y - 9} 84 ${y - 9} 96 ${y}`,
      mode: 'stroke' as const,
      width: 3,
      opacity: 1 - i * 0.25,
    })),
  },
  {
    id: 'bulan-sabit',
    name: 'Bulan sabit',
    category: 'alam',
    ratio: 1,
    parts: [{ d: crescent(52, 50, 44, 34), mode: 'fill' }],
  },
  {
    id: 'bintang-bintang',
    name: 'Bintang-bintang',
    category: 'alam',
    ratio: 0.8,
    parts: [
      { d: star(30, 48, 5, 24, 10), mode: 'fill' },
      { d: star(72, 22, 5, 14, 6), mode: 'fill' },
      { d: star(80, 62, 5, 10, 4), mode: 'fill' },
    ],
  },

  // ── Pernikahan, more ──
  {
    id: 'hati-panah',
    name: 'Hati berpanah',
    category: 'pernikahan',
    ratio: 0.8,
    parts: [
      { d: heart(50, 42, 0.62), mode: 'fill' },
      { d: 'M6 72 L92 16', mode: 'stroke', width: 3 },
      {
        d: polyline([
          [78, 14],
          [93, 15],
          [88, 30],
        ]),
        mode: 'stroke',
        width: 3,
      },
    ],
  },
  {
    id: 'surat-cinta',
    name: 'Surat cinta',
    category: 'pernikahan',
    ratio: 0.68,
    parts: [
      { d: rrect(4, 4, 92, 60, 4), mode: 'stroke', width: 3 },
      {
        d: polyline([
          [4, 8],
          [50, 40],
          [96, 8],
        ]),
        mode: 'stroke',
        width: 3,
      },
      { d: heart(50, 46, 0.2), mode: 'fill' },
    ],
  },

  // ── Wisuda, more ──
  {
    id: 'medali',
    name: 'Medali',
    category: 'wisuda',
    ratio: 1.3,
    parts: [
      {
        d: poly([
          [30, 4],
          [46, 4],
          [58, 56],
          [44, 60],
        ]),
        mode: 'fill',
        opacity: 0.7,
      },
      {
        d: poly([
          [70, 4],
          [54, 4],
          [42, 56],
          [56, 60],
        ]),
        mode: 'fill',
        opacity: 0.7,
      },
      { d: `${circle(50, 88, 36)} ${star(50, 88, 5, 20, 8)}`, mode: 'fill', rule: 'evenodd' },
    ],
  },
  {
    id: 'buku',
    name: 'Buku terbuka',
    category: 'wisuda',
    ratio: 0.72,
    parts: [
      {
        d: poly([
          [4, 10],
          [47, 18],
          [47, 70],
          [4, 62],
        ]),
        mode: 'fill',
      },
      {
        d: poly([
          [96, 10],
          [53, 18],
          [53, 70],
          [96, 62],
        ]),
        mode: 'fill',
      },
    ],
  },

  // ── Ulang tahun, more ──
  {
    id: 'lilin',
    name: 'Lilin',
    category: 'ulang-tahun',
    ratio: 1.12,
    parts: [
      { d: 'M50 4 C61 17 60 30 50 34 C40 30 39 17 50 4Z', mode: 'fill' },
      { d: rrect(40, 42, 20, 68, 3), mode: 'fill' },
    ],
  },
  {
    id: 'hadiah',
    name: 'Kado',
    category: 'ulang-tahun',
    ratio: 1,
    parts: [
      {
        d: [rrect(12, 46, 34, 48, 3), rrect(54, 46, 34, 48, 3)].join(' '),
        mode: 'fill',
      },
      { d: [rrect(6, 30, 40, 13, 3), rrect(54, 30, 40, 13, 3)].join(' '), mode: 'fill' },
      {
        d: 'M50 29 C38 8 20 14 32 27 M50 29 C62 8 80 14 68 27',
        mode: 'stroke',
        width: 3,
      },
    ],
  },
  {
    id: 'bendera',
    name: 'Bendera segitiga',
    category: 'ulang-tahun',
    ratio: 0.45,
    parts: [
      { d: 'M2 6 C30 16 70 16 98 6', mode: 'stroke', width: 2 },
      {
        d: [
          poly([
            [6, 9],
            [22, 12.5],
            [14, 36],
          ]),
          poly([
            [30, 13.5],
            [46, 14.5],
            [38, 40],
          ]),
          poly([
            [54, 14.5],
            [70, 13.5],
            [62, 40],
          ]),
          poly([
            [78, 12.5],
            [94, 9],
            [86, 36],
          ]),
        ].join(' '),
        mode: 'fill',
      },
    ],
  },

  // ── Bayi & keluarga ──
  {
    id: 'jejak-kaki',
    name: 'Jejak kaki bayi',
    category: 'keluarga',
    ratio: 1,
    parts: [
      {
        d: [
          ellipse(32, 70, 12, 20),
          circle(21, 44, 4.2),
          circle(28.5, 40, 3.8),
          circle(35.5, 39.5, 3.4),
          circle(41.5, 41.5, 3),
          circle(45.5, 46, 2.6),
          ellipse(68, 42, 12, 20),
          circle(79, 16, 4.2),
          circle(71.5, 12, 3.8),
          circle(64.5, 11.5, 3.4),
          circle(58.5, 13.5, 3),
          circle(54.5, 18, 2.6),
        ].join(' '),
        mode: 'fill',
      },
    ],
  },
  {
    id: 'rumah',
    name: 'Rumah',
    category: 'keluarga',
    ratio: 0.9,
    parts: [
      {
        d: poly([
          [50, 6],
          [94, 44],
          [6, 44],
        ]),
        mode: 'fill',
      },
      { d: `${rrect(16, 46, 68, 40)} ${rrect(42, 62, 16, 24, 2)}`, mode: 'fill', rule: 'evenodd' },
    ],
  },
  {
    id: 'mahkota',
    name: 'Mahkota',
    category: 'keluarga',
    ratio: 0.72,
    parts: [
      {
        d: poly([
          [8, 58],
          [6, 20],
          [28, 38],
          [50, 10],
          [72, 38],
          [94, 20],
          [92, 58],
        ]),
        mode: 'fill',
      },
      { d: rrect(8, 62, 84, 8, 2), mode: 'fill' },
      { d: `${circle(6, 16, 4)} ${circle(50, 7, 4.5)} ${circle(94, 16, 4)}`, mode: 'fill' },
    ],
  },
  {
    id: 'bulan-tidur',
    name: 'Bulan & bintang tidur',
    category: 'keluarga',
    ratio: 1,
    parts: [
      { d: crescent(44, 54, 40, 30), mode: 'fill' },
      { d: star(80, 22, 4, 12, 3), mode: 'fill' },
      { d: star(88, 48, 4, 7, 2), mode: 'fill' },
    ],
  },

  // ── Hari raya ──
  {
    id: 'ketupat',
    name: 'Ketupat',
    category: 'hari-raya',
    ratio: 1.2,
    parts: [
      {
        d: poly([
          [50, 6],
          [90, 48],
          [50, 90],
          [10, 48],
        ]),
        mode: 'stroke',
        width: 3,
      },
      {
        d: 'M30 27 L70 69 M70 27 L30 69 M40 16.5 L80 58.5 M60 16.5 L20 58.5',
        mode: 'stroke',
        width: 2,
      },
      { d: 'M50 90 V114 M50 90 L41 112 M50 90 L59 112', mode: 'stroke', width: 2.5 },
    ],
  },
  {
    id: 'bulan-bintang',
    name: 'Bulan bintang',
    category: 'hari-raya',
    ratio: 1,
    parts: [
      { d: crescent(44, 50, 42, 30), mode: 'fill' },
      { d: star(78, 42, 5, 13, 5.5), mode: 'fill' },
    ],
  },
  {
    id: 'lentera',
    name: 'Lentera',
    category: 'hari-raya',
    ratio: 1.45,
    parts: [
      { d: 'M50 2 V14', mode: 'stroke', width: 2.5 },
      {
        d: poly([
          [34, 14],
          [66, 14],
          [74, 28],
          [26, 28],
        ]),
        mode: 'fill',
      },
      {
        d: [rrect(28, 30, 44, 70, 8), rrect(36, 40, 8, 50, 3), rrect(56, 40, 8, 50, 3)].join(' '),
        mode: 'fill',
        rule: 'evenodd',
      },
      {
        d: poly([
          [26, 102],
          [74, 102],
          [66, 116],
          [34, 116],
        ]),
        mode: 'fill',
      },
      { d: 'M50 116 V142', mode: 'stroke', width: 2.5 },
    ],
  },
  {
    id: 'pohon-natal',
    name: 'Pohon natal',
    category: 'hari-raya',
    ratio: 1.22,
    parts: [
      {
        d: poly([
          [50, 18],
          [74, 50],
          [26, 50],
        ]),
        mode: 'fill',
      },
      {
        d: poly([
          [50, 34],
          [82, 76],
          [18, 76],
        ]),
        mode: 'fill',
      },
      {
        d: poly([
          [50, 56],
          [92, 104],
          [8, 104],
        ]),
        mode: 'fill',
      },
      { d: rrect(42, 104, 16, 16, 2), mode: 'fill' },
      { d: star(50, 13, 5, 10, 4), mode: 'fill' },
    ],
  },
  {
    id: 'kembang-api',
    name: 'Kembang api',
    category: 'hari-raya',
    ratio: 1,
    parts: [
      { d: rays(50, 50, 12, 12, 38), mode: 'stroke', width: 3 },
      {
        d: Array.from({ length: 12 }, (_, i) => {
          const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
          return circle(50 + Math.cos(a) * 44, 50 + Math.sin(a) * 44, 2.6);
        }).join(' '),
        mode: 'fill',
      },
    ],
  },
  {
    id: 'amplop',
    name: 'Amplop',
    category: 'hari-raya',
    ratio: 0.68,
    parts: [
      { d: rrect(4, 4, 92, 60, 4), mode: 'stroke', width: 3 },
      {
        d: polyline([
          [4, 8],
          [50, 40],
          [96, 8],
        ]),
        mode: 'stroke',
        width: 3,
      },
    ],
  },

  // ── Bunga & daun, more ──
  {
    id: 'daisy',
    name: 'Bunga daisy',
    category: 'bunga',
    ratio: 1,
    parts: [
      {
        // Petals from just outside the middle, so they never overlap there.
        d: Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return leaf(50 + Math.cos(a) * 12, 50 + Math.sin(a) * 12, a, 36, 12);
        }).join(' '),
        mode: 'fill',
      },
      { d: circle(50, 50, 9), mode: 'fill' },
    ],
  },

  // ── Scrapbook, more ──
  {
    id: 'stempel',
    name: 'Stempel',
    category: 'scrapbook',
    ratio: 1,
    parts: [
      { d: `${circle(50, 50, 46)} ${circle(50, 50, 40)}`, mode: 'fill', rule: 'evenodd' },
      { d: circle(50, 50, 32), mode: 'stroke', width: 2, dash: [4, 4] },
      { d: star(50, 50, 5, 14, 6), mode: 'fill' },
    ],
  },
  {
    id: 'catatan',
    name: 'Catatan tempel',
    category: 'scrapbook',
    ratio: 1,
    color: '#fff3b0',
    parts: [
      {
        d: poly([
          [4, 4],
          [96, 4],
          [96, 74],
          [74, 96],
          [4, 96],
        ]),
        mode: 'fill',
      },
      {
        d: poly([
          [96, 74],
          [74, 74],
          [74, 96],
        ]),
        mode: 'fill',
        opacity: 0.55,
      },
    ],
  },
  {
    id: 'selotip-sudut',
    name: 'Selotip sudut',
    category: 'scrapbook',
    ratio: 1,
    parts: [
      {
        d: poly([
          [4, 30],
          [30, 4],
          [96, 70],
          [70, 96],
        ]),
        mode: 'fill',
        opacity: 0.7,
      },
    ],
  },

  // ── Bingkai & pembatas ──
  {
    id: 'bingkai-garis',
    name: 'Bingkai garis',
    category: 'bingkai',
    ratio: 1.25,
    parts: [{ d: rrect(3, 3, 94, 119), mode: 'stroke', width: 2 }],
  },
  {
    id: 'bingkai-ganda',
    name: 'Bingkai ganda',
    category: 'bingkai',
    ratio: 1.25,
    parts: [
      { d: rrect(3, 3, 94, 119), mode: 'stroke', width: 2 },
      { d: rrect(9, 9, 82, 107), mode: 'stroke', width: 1 },
    ],
  },
  {
    id: 'bingkai-sudut',
    name: 'Empat sudut',
    category: 'bingkai',
    ratio: 1.25,
    parts: [
      {
        d: 'M4 24 V4 H24 M76 4 H96 V24 M96 101 V121 H76 M24 121 H4 V101',
        mode: 'stroke',
        width: 2.5,
      },
    ],
  },
  {
    id: 'bingkai-lengkung',
    name: 'Bingkai lengkung',
    category: 'bingkai',
    ratio: 1.25,
    parts: [{ d: 'M4 122 V50 A46 46 0 0 1 96 50 V122Z', mode: 'stroke', width: 2 }],
  },
  {
    id: 'bingkai-bergerigi',
    name: 'Bingkai bergerigi',
    category: 'bingkai',
    ratio: 1,
    parts: [
      {
        d: poly(
          Array.from({ length: 240 }, (_, i) => {
            const a = (i / 240) * Math.PI * 2;
            const r = 44 + Math.cos(a * 24) * 2.6;
            return [50 + Math.cos(a) * r, 50 + Math.sin(a) * r] as const;
          }),
        ),
        mode: 'stroke',
        width: 2,
      },
    ],
  },
  {
    id: 'pembatas-hati',
    name: 'Pembatas hati',
    category: 'bingkai',
    ratio: 0.3,
    parts: [
      { d: 'M4 15 H40 M60 15 H96', mode: 'stroke', width: 1.5 },
      { d: heart(50, 15, 0.14), mode: 'fill' },
    ],
  },
  {
    id: 'pembatas-bintang',
    name: 'Pembatas bintang',
    category: 'bingkai',
    ratio: 0.3,
    parts: [
      { d: 'M4 15 H40 M60 15 H96', mode: 'stroke', width: 1.5 },
      { d: star(50, 15, 4, 8, 2), mode: 'fill' },
    ],
  },
  {
    id: 'pembatas-titik',
    name: 'Pembatas titik',
    category: 'bingkai',
    ratio: 0.2,
    parts: [
      { d: 'M4 10 H38 M62 10 H96', mode: 'stroke', width: 1.5 },
      { d: `${circle(44, 10, 1.8)} ${circle(50, 10, 2.4)} ${circle(56, 10, 1.8)}`, mode: 'fill' },
    ],
  },
  {
    id: 'pembatas-ganda',
    name: 'Garis ganda',
    category: 'bingkai',
    ratio: 0.12,
    parts: [{ d: 'M2 3 H98 M2 9 H98', mode: 'stroke', width: 1.2 }],
  },

  // ── Ikon ──
  {
    id: 'lokasi',
    name: 'Lokasi',
    category: 'ikon',
    ratio: 1.25,
    parts: [
      {
        d: `M50 120 C50 120 12 74 12 44 C12 22 29 6 50 6 C71 6 88 22 88 44 C88 74 50 120 50 120Z ${circle(50, 44, 14)}`,
        mode: 'fill',
        rule: 'evenodd',
      },
    ],
  },
  {
    id: 'jam',
    name: 'Jam',
    category: 'ikon',
    ratio: 1,
    parts: [
      { d: `${circle(50, 50, 46)} ${circle(50, 50, 39)}`, mode: 'fill', rule: 'evenodd' },
      { d: 'M50 50 V24 M50 50 L66 60', mode: 'stroke', width: 5 },
    ],
  },
  {
    id: 'kalender',
    name: 'Kalender',
    category: 'ikon',
    ratio: 1,
    parts: [
      {
        d: `${rrect(8, 14, 84, 80, 8)} ${rrect(16, 34, 68, 52, 3)}`,
        mode: 'fill',
        rule: 'evenodd',
      },
      { d: 'M30 6 V22 M70 6 V22', mode: 'stroke', width: 6 },
      {
        d: [0, 1, 2, 3, 4, 5]
          .map((i) => rrect(24 + (i % 3) * 19, 42 + Math.floor(i / 3) * 20, 13, 12, 2))
          .join(' '),
        mode: 'fill',
      },
    ],
  },
  {
    id: 'komentar',
    name: 'Komentar',
    category: 'ikon',
    ratio: 1,
    parts: [
      {
        d: 'M50 8 C74 8 92 24 92 44 C92 64 74 80 50 80 C44 80 38 79 33 77 L12 90 L18 70 C11 63 8 54 8 44 C8 24 26 8 50 8Z',
        mode: 'stroke',
        width: 4,
      },
    ],
  },
  {
    id: 'penanda',
    name: 'Penanda',
    category: 'ikon',
    ratio: 1.2,
    parts: [
      {
        d: poly([
          [20, 4],
          [80, 4],
          [80, 116],
          [50, 90],
          [20, 116],
        ]),
        mode: 'fill',
      },
    ],
  },
  {
    id: 'kirim',
    name: 'Kirim',
    category: 'ikon',
    ratio: 1,
    parts: [
      {
        d: poly([
          [6, 46],
          [94, 8],
          [62, 92],
          [46, 56],
        ]),
        mode: 'stroke',
        width: 3.5,
      },
      { d: 'M46 56 L94 8', mode: 'stroke', width: 3.5 },
    ],
  },
  {
    id: 'musik',
    name: 'Not musik',
    category: 'ikon',
    ratio: 1,
    parts: [
      { d: `${ellipse(28, 80, 13, 10)} ${ellipse(76, 72, 13, 10)}`, mode: 'fill' },
      { d: 'M40 80 V20 L88 10 V72', mode: 'stroke', width: 5 },
      { d: 'M40 34 L88 24', mode: 'stroke', width: 7 },
    ],
  },
  {
    id: 'senyum',
    name: 'Senyum',
    category: 'ikon',
    ratio: 1,
    parts: [
      { d: `${circle(50, 50, 46)} ${circle(50, 50, 40)}`, mode: 'fill', rule: 'evenodd' },
      { d: `${circle(36, 40, 5)} ${circle(64, 40, 5)}`, mode: 'fill' },
      { d: 'M30 58 Q50 80 70 58', mode: 'stroke', width: 5 },
    ],
  },
  {
    id: 'ide',
    name: 'Ide',
    category: 'ikon',
    ratio: 1.25,
    parts: [
      {
        d: 'M50 6 C72 6 86 22 86 42 C86 58 74 66 70 82 H30 C26 66 14 58 14 42 C14 22 28 6 50 6Z',
        mode: 'fill',
      },
      { d: `${rrect(32, 88, 36, 9, 3)} ${rrect(36, 102, 28, 9, 3)}`, mode: 'fill' },
    ],
  },
  {
    id: 'gembok',
    name: 'Gembok',
    category: 'ikon',
    ratio: 1.1,
    parts: [
      { d: 'M30 50 V36 C30 22 39 12 50 12 C61 12 70 22 70 36 V50', mode: 'stroke', width: 8 },
      { d: `${rrect(16, 48, 68, 56, 8)} ${circle(50, 72, 7)}`, mode: 'fill', rule: 'evenodd' },
    ],
  },

  // ── Liburan ──
  {
    id: 'pesawat',
    name: 'Pesawat',
    category: 'liburan',
    ratio: 1,
    parts: [
      {
        d: poly([
          [50, 4],
          [56, 12],
          [56, 38],
          [94, 60],
          [94, 68],
          [56, 58],
          [56, 80],
          [68, 90],
          [68, 96],
          [50, 90],
          [32, 96],
          [32, 90],
          [44, 80],
          [44, 58],
          [6, 68],
          [6, 60],
          [44, 38],
          [44, 12],
        ]),
        mode: 'fill',
      },
    ],
  },
  {
    id: 'koper',
    name: 'Koper',
    category: 'liburan',
    ratio: 1,
    parts: [
      { d: 'M38 30 V16 H62 V30', mode: 'stroke', width: 5 },
      {
        d: [rrect(14, 28, 72, 64, 8), rrect(31, 36, 6, 48, 3), rrect(63, 36, 6, 48, 3)].join(' '),
        mode: 'fill',
        rule: 'evenodd',
      },
    ],
  },
  {
    id: 'kompas',
    name: 'Kompas',
    category: 'liburan',
    ratio: 1,
    parts: [
      { d: `${circle(50, 50, 46)} ${circle(50, 50, 40)}`, mode: 'fill', rule: 'evenodd' },
      {
        d: poly([
          [50, 16],
          [59, 50],
          [41, 50],
        ]),
        mode: 'fill',
      },
      {
        d: poly([
          [59, 50],
          [50, 84],
          [41, 50],
        ]),
        mode: 'fill',
        opacity: 0.45,
      },
    ],
  },
  {
    id: 'payung-pantai',
    name: 'Payung pantai',
    category: 'liburan',
    ratio: 1,
    parts: [
      {
        d: 'M6 48 C14 20 34 8 50 8 C66 8 86 20 94 48 C84 42 74 42 66 48 C58 42 42 42 34 48 C26 42 16 42 6 48Z',
        mode: 'fill',
      },
      { d: 'M50 46 L58 94', mode: 'stroke', width: 3.5 },
      { d: 'M6 96 H94', mode: 'stroke', width: 3 },
    ],
  },
  {
    id: 'senja',
    name: 'Matahari terbenam',
    category: 'liburan',
    ratio: 0.8,
    parts: [
      { d: poly(arcPts(50, 50, 30, 180, 360, 36)), mode: 'fill' },
      { d: 'M4 56 H96 M18 66 H82 M32 76 H68', mode: 'stroke', width: 3.5 },
    ],
  },
  {
    id: 'tiket',
    name: 'Tiket',
    category: 'liburan',
    ratio: 0.6,
    parts: [
      {
        d: poly([
          [4, 6],
          [96, 6],
          ...arcPts(96, 30, 8, 270, 90, 12),
          [96, 54],
          [4, 54],
          ...arcPts(4, 30, 8, 90, -90, 12),
        ]),
        mode: 'fill',
      },
    ],
  },

  // ── Makanan & minuman ──
  {
    id: 'kopi',
    name: 'Kopi',
    category: 'kuliner',
    ratio: 1,
    parts: [
      {
        d: poly([
          [16, 34],
          [76, 34],
          [70, 94],
          [22, 94],
        ]),
        mode: 'fill',
      },
      { d: 'M75 44 C94 44 94 72 72 72', mode: 'stroke', width: 5 },
      { d: 'M36 26 C32 18 40 14 36 4 M56 26 C52 18 60 14 56 4', mode: 'stroke', width: 3 },
    ],
  },
  {
    id: 'es-krim',
    name: 'Es krim',
    category: 'kuliner',
    ratio: 1.2,
    parts: [
      {
        d: poly([
          [28, 58],
          [72, 58],
          [50, 118],
        ]),
        mode: 'fill',
        opacity: 0.7,
      },
      { d: `${circle(36, 48, 16)} ${circle(64, 48, 16)} ${circle(50, 30, 18)}`, mode: 'fill' },
    ],
  },
  {
    id: 'semangka',
    name: 'Semangka',
    category: 'kuliner',
    ratio: 0.55,
    parts: [
      {
        d: [
          poly(arcPts(50, 6, 46, 0, 180, 36)),
          ellipse(34, 20, 2.5, 4),
          ellipse(50, 26, 2.5, 4),
          ellipse(66, 20, 2.5, 4),
          ellipse(42, 36, 2.5, 4),
          ellipse(58, 36, 2.5, 4),
        ].join(' '),
        mode: 'fill',
        rule: 'evenodd',
      },
    ],
  },

  // ── Alam & cuaca, more ──
  {
    id: 'kupu-kupu',
    name: 'Kupu-kupu',
    category: 'alam',
    ratio: 0.9,
    parts: [
      {
        d: [
          leaf(49, 42, -2.5, 44, 22),
          leaf(51, 42, -0.64, 44, 22),
          leaf(49, 50, 2.3, 32, 15),
          leaf(51, 50, 0.84, 32, 15),
        ].join(' '),
        mode: 'fill',
      },
      { d: rrect(47, 28, 6, 46, 3), mode: 'fill' },
      { d: 'M48 30 C44 18 40 12 34 10 M52 30 C56 18 60 12 66 10', mode: 'stroke', width: 2 },
    ],
  },
  {
    id: 'hujan',
    name: 'Hujan',
    category: 'alam',
    ratio: 1,
    parts: [
      {
        d: [
          circle(30, 44, 16),
          circle(50, 32, 20),
          circle(72, 42, 17),
          circle(42, 50, 13),
          circle(62, 52, 13),
        ].join(' '),
        mode: 'fill',
      },
      { d: 'M30 72 L25 90 M50 72 L45 90 M70 72 L65 90', mode: 'stroke', width: 4 },
    ],
  },
  {
    id: 'salju',
    name: 'Kepingan salju',
    category: 'alam',
    ratio: 1,
    parts: [
      {
        d: [
          rays(50, 50, 6, 0, 46, Math.PI / 2),
          ...Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2 + Math.PI / 2;
            const [cx, cy] = [50 + Math.cos(a) * 28, 50 + Math.sin(a) * 28];
            const b = (d: number) => [cx + Math.cos(a + d) * 12, cy + Math.sin(a + d) * 12];
            const [l1, l2] = [b(2.4), b(-2.4)];
            return `M${n(l1[0]!)} ${n(l1[1]!)} L${n(cx)} ${n(cy)} L${n(l2[0]!)} ${n(l2[1]!)}`;
          }),
        ].join(' '),
        mode: 'stroke',
        width: 3.5,
      },
    ],
  },
  {
    id: 'daun-ganda',
    name: 'Sepasang daun',
    category: 'bunga',
    ratio: 1,
    parts: [
      { d: `${leaf(50, 94, -2.2, 76, 22)} ${leaf(50, 94, -0.94, 76, 22)}`, mode: 'fill' },
      { d: 'M50 94 V74', mode: 'stroke', width: 3 },
    ],
  },

  // ── Retired: now shapes in the Bentuk section ──
  {
    id: 'lingkaran',
    name: 'Lingkaran',
    category: 'umum',
    ratio: 1,
    retired: true,
    parts: [{ d: circle(50, 50, 42), mode: 'stroke', width: 3 }],
  },
  {
    id: 'garis',
    name: 'Garis',
    category: 'umum',
    ratio: 0.2,
    retired: true,
    parts: [{ d: 'M4 10 H96', mode: 'stroke', width: 3 }],
  },
];

export const stickerById = (id: string) => STICKERS.find((s) => s.id === id);
