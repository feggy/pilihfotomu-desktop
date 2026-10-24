import type { CarouselPattern, Cell, CollageTemplate, Frame, LayoutCategory } from './templates';
import { POLAROID_ASPECT, gridCells, inSlides } from './template-helpers';

/**
 * The layout catalog, generated from design rules rather than drawn one by one.
 *
 * Each family follows a pattern photographers already use — even grids, one
 * big photo among small ones, rows and columns of mixed counts, masonry, room
 * for a title, clusters, scattered polaroids and frames — and walks through its
 * sensible variations. Everything is checked for shape (no slivers, no photo
 * too long or too flat) and duplicates are dropped where the lists are joined.
 *
 * Ids are built from the parameters, so a saved draft finds its layout again
 * as long as the parameters stay the same.
 */

type Box = readonly [x: number, y: number, w: number, h: number];

/** Canvas height ÷ width: 4:5 post, 9:16 story. */
const POST = 1.25;
const STORY = 16 / 9;

const round = (v: number) => Math.round(v * 10000) / 10000;
const cell = (x: number, y: number, w: number, h: number): Cell =>
  [round(x), round(y), round(w), round(h)] as const;

/**
 * Whether tiled cells look good on a canvas this tall: no photo narrower than
 * about 1:2.4 either way, none smaller than a tenth of the width.
 */
export function cellsFit(cells: readonly Cell[], ratio: number, area?: Box): boolean {
  const [, , aw, ah] = area ?? [0, 0, 1, 1];
  return cells.every(([, , w, h]) => {
    const pw = w * aw;
    const ph = h * ah * ratio;
    const aspect = pw / ph;
    return aspect >= 0.42 && aspect <= 2.4 && Math.min(pw, ph) >= 0.1;
  });
}

/**
 * A layout's shape regardless of the order of its cells — two layouts with the
 * same signature look the same.
 */
export function cellsSignature(cells: readonly Cell[]): string {
  return cells
    .map((c) => c.map((v) => Math.round(v * 100)).join(','))
    .sort()
    .join('|');
}

/** Left–right and top–bottom mirror images of tiled cells. */
const flipX = (cells: readonly Cell[]) => cells.map(([x, y, w, h]) => cell(1 - x - w, y, w, h));
const flipY = (cells: readonly Cell[]) => cells.map(([x, y, w, h]) => cell(x, 1 - y - h, w, h));

const position = (from: number, span: number, of: number) =>
  from === 0 ? 'kiri' : from + span === of ? 'kanan' : 'tengah';
const positionV = (from: number, span: number, of: number) =>
  from === 0 ? 'atas' : from + span === of ? 'bawah' : 'tengah';

// ── Families of tiled layouts ──

/** Even grids, 1–4 columns by 1–5 rows. */
function grids(): CollageTemplate[] {
  const out: CollageTemplate[] = [];
  for (let c = 1; c <= 4; c++) {
    for (let r = 1; r <= 5; r++) {
      if (c * r < 2) continue;
      out.push({
        id: `gen-grid-${c}x${r}`,
        name: `Grid ${c} × ${r}`,
        category: 'grid',
        cells: gridCells(c, r),
      });
    }
  }
  return out;
}

/** An even grid with one big photo spanning several cells, at every position. */
function heroGrids(): CollageTemplate[] {
  const shapes: [cols: number, rows: number, spanX: number, spanY: number][] = [
    [3, 3, 2, 2],
    [2, 3, 2, 2],
    [3, 2, 2, 2],
    [4, 3, 2, 2],
    [3, 4, 2, 2],
    [4, 4, 2, 2],
    [4, 4, 3, 3],
    [4, 5, 2, 2],
    [3, 5, 2, 2],
    [4, 4, 3, 2],
    [4, 4, 2, 3],
    [3, 3, 2, 1],
    [3, 3, 1, 2],
    [3, 4, 3, 2],
    [4, 3, 2, 3],
    [3, 4, 2, 3],
  ];
  const out: CollageTemplate[] = [];
  for (const [c, r, sx, sy] of shapes) {
    for (let row = 0; row + sy <= r; row++) {
      for (let col = 0; col + sx <= c; col++) {
        const hero = cell(col / c, row / r, sx / c, sy / r);
        const rest = gridCells(c, r).filter((_, i) => {
          const cc = i % c;
          const rr = Math.floor(i / c);
          return !(cc >= col && cc < col + sx && rr >= row && rr < row + sy);
        });
        out.push({
          id: `gen-utama-${c}x${r}-${sx}x${sy}-${col}-${row}`,
          name: `Utama ${positionV(row, sy, r)} ${position(col, sx, c)}`,
          category: 'sorotan',
          cells: [hero, ...rest],
        });
      }
    }
  }
  return out;
}

/** Rows stacked, each with its own number of photos (1–4), in a few rhythms. */
function rowMixes(): CollageTemplate[] {
  const counts = [1, 2, 3, 4];
  const sequences: number[][] = [];
  for (const a of counts) for (const b of counts) sequences.push([a, b]);
  for (const a of counts) for (const b of counts) for (const c of counts) sequences.push([a, b, c]);
  const fours = [
    [1, 2, 2, 1],
    [2, 1, 1, 2],
    [1, 3, 3, 1],
    [2, 3, 2, 3],
    [3, 2, 3, 2],
    [1, 2, 3, 4],
    [4, 3, 2, 1],
    [2, 2, 1, 2],
    [1, 3, 1, 3],
    [3, 1, 3, 1],
  ];
  sequences.push(...fours);

  // Row heights: even, or the rows with fewer photos taller.
  const rhythms = (seq: number[]) => {
    const even = seq.map(() => 1 / seq.length);
    const weighted = seq.map((n) => 1 / Math.sqrt(n));
    const sum = weighted.reduce((a, b) => a + b, 0);
    return [
      { key: 'rata', heights: even },
      { key: 'luwes', heights: weighted.map((w) => w / sum) },
    ];
  };

  const out: CollageTemplate[] = [];
  for (const seq of sequences) {
    if (seq.every((n) => n === seq[0])) continue; // even grids come from grids()
    for (const { key, heights } of rhythms(seq)) {
      let y = 0;
      const cells = seq.flatMap((n, i) => {
        const h = heights[i]!;
        const row = Array.from({ length: n }, (_, k) => cell(k / n, y, 1 / n, h));
        y += h;
        return row;
      });
      out.push({
        id: `gen-baris-${seq.join('')}-${key}`,
        name: `Baris ${seq.join('-')}`,
        category: 'baris',
        cells,
      });
      // The same, turned on its side: columns with mixed counts.
      out.push({
        id: `gen-kolom-${seq.join('')}-${key}`,
        name: `Kolom ${seq.join('-')}`,
        category: 'baris',
        cells: cells.map(([x, yy, w, h]) => cell(yy, x, h, w)),
      });
    }
  }
  return out;
}

/** Rows of two with uneven widths that alternate — a brick wall. */
function bricks(): CollageTemplate[] {
  const out: CollageTemplate[] = [];
  const splits = [0.62, 0.66, 0.7];
  for (let rows = 2; rows <= 5; rows++) {
    for (const s of splits) {
      const h = 1 / rows;
      const cells = Array.from({ length: rows }, (_, i) => {
        const a = i % 2 === 0 ? s : 1 - s;
        return [cell(0, i * h, a, h), cell(a, i * h, 1 - a, h)];
      }).flat();
      out.push({
        id: `gen-bata-${rows}-${Math.round(s * 100)}`,
        name: `Bata ${rows} baris`,
        category: 'baris',
        cells,
      });
    }
  }
  return out;
}

/** Masonry: columns side by side, each split at its own heights. */
function masonry(): CollageTemplate[] {
  const splits: number[][] = [
    [0.6, 0.4],
    [0.4, 0.6],
    [0.35, 0.65],
    [0.65, 0.35],
    [0.3, 0.4, 0.3],
    [0.4, 0.3, 0.3],
    [0.3, 0.3, 0.4],
    [0.25, 0.45, 0.3],
    [0.45, 0.25, 0.3],
    [1],
  ];
  const columns = (spec: number[][]) => {
    const w = 1 / spec.length;
    return spec.flatMap((hs, i) => {
      let y = 0;
      return hs.map((h) => {
        const c = cell(i * w, y, w, h);
        y += h;
        return c;
      });
    });
  };
  const out: CollageTemplate[] = [];
  const add = (spec: number[][]) => {
    // Two neighbouring columns cut the same way read as a grid, not masonry.
    for (let i = 1; i < spec.length; i++) {
      if (spec[i]!.join() === spec[i - 1]!.join()) return;
    }
    const key = spec.map((hs) => splits.findIndex((s) => s.join() === hs.join())).join('');
    out.push({
      id: `gen-masonry-${spec.length}-${key}`,
      name: `Masonry ${spec.length} kolom`,
      category: 'masonry',
      cells: columns(spec),
    });
  };
  for (const a of splits) for (const b of splits) add([a, b]);
  // Three columns: a walk through the combinations, not all 1000 of them.
  for (let i = 0; i < splits.length; i++) {
    for (let j = 0; j < splits.length; j += 2) {
      add([splits[i]!, splits[(i + j + 1) % splits.length]!, splits[(i + 3) % splits.length]!]);
    }
  }
  for (let i = 0; i < splits.length - 1; i++) {
    add([splits[i]!, splits[(i + 4) % 9]!, splits[(i + 2) % 9]!, splits[(i + 6) % 9]!]);
  }
  return out;
}

/** Every tiled layout above, with its mirror images. */
function tiledFamilies(): CollageTemplate[] {
  const base = [...grids(), ...heroGrids(), ...rowMixes(), ...bricks(), ...masonry()];
  const mirrored = base.flatMap((t) => [
    { ...t, id: `${t.id}-cx`, name: `${t.name} · cermin`, cells: flipX(t.cells) },
    { ...t, id: `${t.id}-cy`, name: `${t.name} · terbalik`, cells: flipY(t.cells) },
  ]);
  return [...base, ...mirrored];
}

// ── Room for a title: small tiled layouts set in part of the canvas ──

const TITLE_AREAS: { key: string; name: string; area: Box; frame?: Frame }[] = [
  { key: 'judul-bawah', name: '+ judul bawah', area: [0.07, 0.06, 0.86, 0.7] },
  { key: 'judul-atas', name: '+ judul atas', area: [0.07, 0.24, 0.86, 0.7] },
  { key: 'bingkai', name: 'berbingkai', area: [0.08, 0.06, 0.84, 0.88], frame: 'border' },
];

function titleRooms(tiled: CollageTemplate[]): CollageTemplate[] {
  // The plain versions only: a mirrored grid with a title reads as the same idea twice.
  const small = tiled.filter(
    (t) => t.cells.length <= 5 && !t.id.endsWith('-cx') && !t.id.endsWith('-cy'),
  );
  const out: CollageTemplate[] = [];
  for (const t of small) {
    for (const a of TITLE_AREAS) {
      if (!cellsFit(t.cells, POST, a.area)) continue;
      out.push({
        id: `${t.id}-${a.key}`,
        name: `${t.name} ${a.name}`,
        category: a.frame ? 'bingkai' : 'ruang',
        area: a.area,
        ...(a.frame ? { frame: a.frame } : {}),
        cells: t.cells,
      });
    }
  }
  return out;
}

// ── Scattered: polaroids, white frames, overlapping photos with a tilt ──

/** A fixed "random" sequence, so the same layout comes out every time. */
const TILTS = [-6, 4, -3, 7, -5, 2, 5, -4, 3, -7, 6, -2];
const NUDGE = [0.02, -0.015, 0.01, -0.025, 0.015, -0.01, 0.025, -0.02, 0.005];

function scatters(ratio: number, formatKey: string): CollageTemplate[] {
  const out: CollageTemplate[] = [];
  const styles: { key: string; name: string; frame?: Frame; aspect: number; grow: number }[] = [
    {
      key: 'polaroid',
      name: 'Polaroid tersebar',
      frame: 'polaroid',
      aspect: POLAROID_ASPECT,
      grow: 1.05,
    },
    { key: 'bingkai', name: 'Bingkai tersebar', frame: 'border', aspect: 1.2, grow: 1.02 },
    { key: 'tumpuk', name: 'Tumpuk miring', aspect: 1, grow: 1.18 },
  ];
  // Kept this far from every edge, so a tilted corner is never cut off.
  const MARGIN = 0.05;
  for (let n = 2; n <= 9; n++) {
    for (const s of styles) {
      for (let variant = 0; variant < 3; variant++) {
        // Photos on a loose grid — centered, tilted, nudged, a little overlapping.
        // Variant 2 is a two-across column for a few photos, a wider grid for many.
        const cols =
          variant === 2 && n <= 4
            ? Math.min(n, 2)
            : Math.max(1, Math.round(Math.sqrt(n / ratio)) + (variant === 2 ? 1 : 0));
        const rows = Math.ceil(n / cols);
        const usableW = 1 - 2 * MARGIN;
        const usableH = 1 - 2 * MARGIN;
        // As big as fits the grid (heights in width units: × ratio), then grown to overlap.
        const w = Math.min(usableW / cols, (usableH * ratio) / rows / s.aspect) * s.grow * 0.92;
        const h = (w * s.aspect) / ratio;
        // Centers a photo-width apart at most, the group centered — spread to the
        // edges they would leave a hole in the middle.
        const centered = (count: number, size: number, room: number) => {
          if (count === 1) return [0.5];
          const pitch = Math.min((room - size) / (count - 1), size * 1.06);
          const start = 0.5 - (pitch * (count - 1)) / 2;
          return Array.from({ length: count }, (_, i) => start + i * pitch);
        };
        const spreadX = (count: number) => centered(count, w, usableW);
        const ys = centered(rows, h, usableH);
        const cells: Cell[] = [];
        for (let i = 0; i < n; i++) {
          const r = Math.floor(i / cols);
          const inRow = r === rows - 1 ? n - r * cols : cols;
          const xs = spreadX(inRow);
          const k = (i + variant * 3) % TILTS.length;
          const nudge = NUDGE[k % NUDGE.length]! * 0.6;
          const cx = Math.min(
            1 - MARGIN - w / 2,
            Math.max(MARGIN + w / 2, xs[i - r * cols]! + nudge),
          );
          const cy = Math.min(
            1 - MARGIN - h / 2,
            Math.max(MARGIN + h / 2, ys[r]! + NUDGE[(k + 4) % NUDGE.length]! * 0.6),
          );
          const tilt = TILTS[k]! * (variant === 1 ? 0.5 : 1);
          cells.push([round(cx - w / 2), round(cy - h / 2), round(w), round(h), tilt] as const);
        }
        out.push({
          id: `gen-${s.key}-${formatKey}-${n}-${variant}`,
          name: `${s.name} ${n}`,
          category: s.frame ? 'bingkai' : 'tumpuk',
          free: true,
          ...(s.frame ? { frame: s.frame } : {}),
          cells,
        });
      }
    }
  }
  return out;
}

// ── Public lists ──

/** Generated post layouts (4:5 and square), shape-checked for a 4:5 canvas. */
export function generatedPostTemplates(): CollageTemplate[] {
  const tiled = tiledFamilies().filter((t) => cellsFit(t.cells, POST));
  // Scattered photos are placed for one canvas shape; on another they would
  // stretch, so each format gets its own.
  return [
    ...tiled,
    ...titleRooms(tiled),
    ...scatters(POST, 'post').map((t) => ({ ...t, formats: ['feed'] as const })),
    ...scatters(1, 'kotak').map((t) => ({ ...t, formats: ['square'] as const })),
  ];
}

/**
 * Layouts made for the tall story canvas: tiled families that only look right
 * when tall, and scatters spaced for it. Shown for stories only.
 */
export function generatedStoryTemplates(): CollageTemplate[] {
  const tiled = tiledFamilies().filter((t) => cellsFit(t.cells, STORY) && !cellsFit(t.cells, POST));
  return [...tiled, ...scatters(STORY, 'story')].map((t) => ({
    ...t,
    id: t.id.startsWith('gen-') && !t.id.includes('-story-') ? `${t.id}-story` : t.id,
    formats: ['story'],
  }));
}

/**
 * Carousel patterns built from post layouts: the same layout on every slide,
 * or mirrored on every other slide so the swipe has a rhythm.
 */
export function generatedCarouselPatterns(): CarouselPattern[] {
  const pick = [
    'gen-grid-1x2',
    'gen-grid-2x2',
    'gen-grid-2x3',
    'gen-grid-3x3',
    'gen-grid-3x2',
    'gen-grid-2x1',
    'gen-grid-3x1',
    'gen-utama-3x3-2x2-0-0',
    'gen-utama-3x3-2x2-1-1',
    'gen-utama-3x3-2x2-0-1',
    'gen-utama-2x3-2x2-0-0',
    'gen-utama-2x3-2x2-0-1',
    'gen-utama-4x4-3x3-0-0',
    'gen-utama-3x4-3x2-0-0',
    'gen-baris-12-luwes',
    'gen-baris-21-luwes',
    'gen-baris-13-luwes',
    'gen-baris-121-luwes',
    'gen-baris-212-luwes',
    'gen-baris-123-luwes',
    'gen-kolom-12-luwes',
    'gen-kolom-21-luwes',
    'gen-kolom-13-luwes',
    'gen-kolom-121-luwes',
    'gen-bata-3-66',
    'gen-bata-4-62',
    'gen-masonry-2-01',
    'gen-masonry-2-45',
    'gen-masonry-2-26',
    'gen-masonry-3-048',
    'gen-masonry-3-137',
  ];
  const byId = new Map(tiledFamilies().map((t) => [t.id, t]));
  const out: CarouselPattern[] = [];
  const perSlide = (cells: readonly Cell[], mirror: boolean) => (n: number) => {
    const u = 1 / n;
    return Array.from({ length: n }, (_, i) =>
      (mirror && i % 2 === 1 ? flipX(cells) : cells).map(
        ([x, y, w, h]) => [i * u + x * u, y, w * u, h] as const,
      ),
    ).flat();
  };
  for (const id of pick) {
    const t = byId.get(id);
    if (!t) continue;
    out.push({
      key: `ps-${id.slice(4)}`,
      name: `${t.name} tiap slide`,
      category: 'tiap-slide',
      build: perSlide(t.cells, false),
    });
    // Mirroring a symmetric layout changes nothing — only the lopsided ones.
    if (cellsSignature(flipX(t.cells)) !== cellsSignature(t.cells)) {
      out.push({
        key: `pm-${id.slice(4)}`,
        name: `${t.name} bergantian`,
        category: 'tiap-slide',
        build: perSlide(t.cells, true),
      });
    }
  }

  // Scattered polaroids and frames running through every slide.
  for (const [key, name, frame, aspect] of [
    ['sebar-polaroid', 'Polaroid melintas', 'polaroid', POLAROID_ASPECT],
    ['sebar-bingkai', 'Bingkai melintas', 'border', 1.2],
  ] as const) {
    for (const perSlideCount of [2, 3]) {
      out.push({
        key: `${key}-${perSlideCount}`,
        name: `${name} ${perSlideCount}`,
        category: 'lintas',
        free: true,
        frame,
        build: (n) => {
          const at = inSlides(n);
          const total = n * perSlideCount;
          const step = n / total;
          const w = Math.min(0.46, step * 1.25);
          const h = (w * aspect) / POST;
          return Array.from({ length: total }, (_, i) => {
            const k = i % TILTS.length;
            const x = (i + 0.5) * step - w / 2;
            // Up and down like a wave, so every slide edge has a photo on it.
            const y = 0.5 - h / 2 + (i % 2 === 0 ? -0.12 : 0.12) + NUDGE[k % NUDGE.length]!;
            return at(x, y, w, h, TILTS[k]!);
          });
        },
      });
    }
  }
  return out;
}

// ── Editorial carousels: a cover, pages with room for words, a closing page ──

/**
 * One slide's composition, in slide units (x and w as fractions of the slide
 * width, y and h of its height). Plenty of background is left on purpose:
 * that is where the title, a date or a few lines of story go.
 */
type Page = { key: string; cells: Box[] };

/** Height fraction on a 4:5 slide for a photo `w` wide with height ÷ width `aspect`. */
const tall = (w: number, aspect: number) => round((w * aspect) / POST);

const COVERS: Page[] = [
  // A photo in the middle, the couple's names above or below.
  { key: 'tengah', cells: [[0.2, 0.27, 0.6, tall(0.6, 0.82)]] },
  { key: 'besar', cells: [[0.08, 0.07, 0.84, 0.62]] },
  { key: 'bawah', cells: [[0.1, 0.4, 0.8, 0.52]] },
  { key: 'kiri', cells: [[0.07, 0.1, 0.5, 0.8]] },
  { key: 'potret', cells: [[0.26, 0.1, 0.48, tall(0.48, 1.3)]] },
];

const MIDDLES: Page[] = [
  {
    key: 'dua',
    cells: [
      [0.07, 0.1, 0.41, 0.55],
      [0.52, 0.1, 0.41, 0.55],
    ],
  },
  {
    key: 'kluster',
    cells: [
      [0.07, 0.12, 0.5, 0.56],
      [0.6, 0.12, 0.33, 0.26],
      [0.6, 0.42, 0.33, 0.26],
    ],
  },
  {
    key: 'empat',
    cells: [
      [0.07, 0.07, 0.4, 0.3],
      [0.55, 0.19, 0.38, 0.28],
      [0.07, 0.44, 0.36, 0.3],
      [0.5, 0.55, 0.43, 0.33],
    ],
  },
  { key: 'teks-kiri', cells: [[0.45, 0.08, 0.48, 0.84]] },
  {
    key: 'teks-atas',
    cells: [
      [0.07, 0.38, 0.42, 0.52],
      [0.51, 0.38, 0.42, 0.52],
    ],
  },
  { key: 'kutipan', cells: [[0.25, 0.3, 0.5, tall(0.5, 0.8)]] },
  {
    key: 'tangga',
    cells: [
      [0.07, 0.08, 0.5, 0.44],
      [0.43, 0.48, 0.5, 0.44],
    ],
  },
  {
    key: 'strip',
    cells: [
      [0.07, 0.52, 0.27, 0.36],
      [0.365, 0.52, 0.27, 0.36],
      [0.66, 0.52, 0.27, 0.36],
    ],
  },
  {
    key: 'kanan-dua',
    cells: [
      [0.5, 0.08, 0.43, 0.4],
      [0.5, 0.52, 0.43, 0.4],
    ],
  },
  { key: 'bingkai', cells: [[0.22, 0.1, 0.56, 0.72]] },
  {
    key: 'besar-kecil',
    cells: [
      [0.07, 0.08, 0.62, 0.56],
      [0.55, 0.6, 0.38, 0.32],
    ],
  },
];

const CLOSINGS: Page[] = [
  { key: 'sudut', cells: [[0.52, 0.1, 0.41, 0.4]] },
  {
    key: 'dua-bawah',
    cells: [
      [0.1, 0.55, 0.38, 0.35],
      [0.52, 0.55, 0.38, 0.35],
    ],
  },
];

/** Orders the middle pages take — each a different rhythm through the story. */
const MIDDLE_ORDERS: string[][] = [
  ['dua', 'kluster', 'teks-kiri', 'empat', 'kutipan', 'tangga'],
  ['empat', 'teks-atas', 'besar-kecil', 'kutipan', 'kluster', 'strip'],
  ['kluster', 'kutipan', 'dua', 'kanan-dua', 'empat', 'bingkai'],
  ['tangga', 'strip', 'teks-kiri', 'kluster', 'teks-atas', 'empat'],
  ['bingkai', 'dua', 'empat', 'kutipan', 'besar-kecil', 'kanan-dua'],
  ['teks-atas', 'besar-kecil', 'kanan-dua', 'strip', 'dua', 'tangga'],
];

/**
 * Carousels like a wedding album or a magazine: the first slide is a cover,
 * the last a closing page, and every slide in between a different page — all
 * with room to type the story. Plain, and with white frames.
 */
export function editorialCarouselPatterns(): CarouselPattern[] {
  const middles = new Map(MIDDLES.map((p) => [p.key, p]));
  const out: CarouselPattern[] = [];
  for (const cover of COVERS) {
    MIDDLE_ORDERS.forEach((order, o) => {
      for (const closing of CLOSINGS) {
        const build = (n: number) => {
          const at = inSlides(n);
          const pages: Page[] = Array.from({ length: n }, (_, i) =>
            i === 0 ? cover : i === n - 1 ? closing : middles.get(order[(i - 1) % order.length]!)!,
          );
          return pages.flatMap((p, i) => p.cells.map(([x, y, w, h]) => at(i + x, y, w, h)));
        };
        for (const frame of [undefined, 'border'] as const) {
          out.push({
            key: `editorial-${cover.key}-${o + 1}-${closing.key}${frame ? '-bingkai' : ''}`,
            name: `Editorial ${o + 1} · sampul ${cover.key}${frame ? ' · bingkai' : ''}`,
            category: 'editorial',
            free: true,
            ...(frame ? { frame } : {}),
            build,
          });
        }
      }
    });
  }
  return out;
}

// ── Text cover: an empty first slide for the title, simple pages after ──

/** Simple pages with room left over, and what the picker calls them. */
const SIMPLE_PAGES: { key: string; label: string; cells: Box[] }[] = [
  { key: 'tengah', label: 'foto di tengah', cells: [[0.22, 0.1, 0.56, 0.72]] },
  { key: 'kecil', label: 'foto kecil', cells: [[0.25, 0.3, 0.5, tall(0.5, 0.8)]] },
  { key: 'teks-kiri', label: 'teks di kiri', cells: [[0.45, 0.08, 0.48, 0.84]] },
  { key: 'teks-kanan', label: 'teks di kanan', cells: [[0.07, 0.08, 0.48, 0.84]] },
  { key: 'satu-atas', label: 'teks di bawah', cells: [[0.08, 0.08, 0.84, 0.52]] },
  { key: 'satu-bawah', label: 'teks di atas', cells: [[0.08, 0.4, 0.84, 0.52]] },
  {
    key: 'dua-atas',
    label: 'dua foto, teks di bawah',
    cells: [
      [0.07, 0.08, 0.42, 0.52],
      [0.51, 0.08, 0.42, 0.52],
    ],
  },
  {
    key: 'dua-bawah',
    label: 'dua foto, teks di atas',
    cells: [
      [0.07, 0.4, 0.42, 0.52],
      [0.51, 0.4, 0.42, 0.52],
    ],
  },
  {
    key: 'strip',
    label: 'tiga foto berjajar',
    cells: [
      [0.07, 0.52, 0.27, 0.36],
      [0.365, 0.52, 0.27, 0.36],
      [0.66, 0.52, 0.27, 0.36],
    ],
  },
  {
    key: 'besar-kecil',
    label: 'besar & kecil',
    cells: [
      [0.07, 0.08, 0.62, 0.56],
      [0.55, 0.6, 0.38, 0.32],
    ],
  },
];

/** Two simple pages taking turns, for a little rhythm through the swipe. */
const SIMPLE_PAIRS: [string, string][] = [
  ['teks-kiri', 'teks-kanan'],
  ['satu-atas', 'satu-bawah'],
  ['dua-atas', 'dua-bawah'],
  ['kecil', 'dua-atas'],
  ['tengah', 'strip'],
  ['besar-kecil', 'kecil'],
];

/**
 * A carousel that opens on an empty slide — the photographer types the title,
 * the names, the date there — then keeps every other slide simple, each with
 * room for a line or two. The same page throughout, or two taking turns;
 * plain, and with white frames.
 */
export function textCoverCarouselPatterns(): CarouselPattern[] {
  const pages = new Map(SIMPLE_PAGES.map((p) => [p.key, p]));
  const sequences: { key: string; name: string; order: string[] }[] = [
    ...SIMPLE_PAGES.map((p) => ({ key: p.key, name: p.label, order: [p.key] })),
    ...SIMPLE_PAIRS.map(([a, b]) => ({
      key: `${a}-${b}`,
      name: `${pages.get(a)!.label} / ${pages.get(b)!.label}`,
      order: [a, b],
    })),
  ];
  const out: CarouselPattern[] = [];
  for (const seq of sequences) {
    for (const frame of [undefined, 'border'] as const) {
      out.push({
        key: `sampul-teks-${seq.key}${frame ? '-bingkai' : ''}`,
        name: `Sampul teks · ${seq.name}${frame ? ' · bingkai' : ''}`,
        category: 'editorial',
        free: true,
        ...(frame ? { frame } : {}),
        build: (n) => {
          const at = inSlides(n);
          // Slide 1 has no photos at all: it is the cover, for words only.
          return Array.from({ length: n - 1 }, (_, i) => {
            const page = pages.get(seq.order[i % seq.order.length]!)!;
            return page.cells.map(([x, y, w, h]) => at(i + 1 + x, y, w, h));
          }).flat();
        },
      });
    }
  }
  return out;
}

export type { LayoutCategory };
