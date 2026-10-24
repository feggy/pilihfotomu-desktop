import type { CarouselPattern, Cell, CollageTemplate } from './templates';
import {
  POLAROID_ASPECT,
  columnCells,
  gridCells,
  gridWithHero,
  heightFor,
  inSlides,
  rowCells,
  third,
} from './template-helpers';

/**
 * More layouts, from the classic collage families: grids, a hero photo with
 * smaller ones around it, masonry columns, strips, polaroid and framed
 * scrapbook pages, and pages with room for a title. The picker sorts them by
 * photo count with the rest.
 */
export const MORE_TEMPLATES: readonly CollageTemplate[] = [
  // ── 2–3 foto ──
  { id: '2-bawah-lebar', name: 'Bawah lebar', cells: rowCells([[1], [1]], [0.35, 0.65]) },
  {
    id: '3-tengah-besar',
    name: 'Tengah besar',
    cells: columnCells([[1], [1], [1]], [0.25, 0.5, 0.25]),
  },
  {
    id: '3-siku',
    name: 'Siku',
    cells: [
      [0, 0, 0.6, 0.6],
      [0.6, 0, 0.4, 1],
      [0, 0.6, 0.6, 0.4],
    ],
  },

  // ── 4 foto ──
  { id: '4-kolom', name: '4 kolom', cells: columnCells([[1], [1], [1], [1]]) },
  { id: '4-baris', name: '4 baris', cells: rowCells([[1], [1], [1], [1]]) },
  {
    id: '4-kanan-besar',
    name: '3 + 1 besar',
    cells: columnCells([[third, third, third], [1]], [0.38, 0.62]),
  },
  {
    id: '4-siku',
    name: 'Siku 4',
    cells: [
      [0, 0, 0.66, 0.66],
      [0.66, 0, 0.34, 0.33],
      [0.66, 0.33, 0.34, 0.33],
      [0, 0.66, 1, 0.34],
    ],
  },
  {
    id: '4-zigzag-tegak',
    name: 'Zigzag tegak',
    cells: columnCells([
      [0.62, 0.38],
      [0.38, 0.62],
    ]),
  },

  // ── 5 foto ──
  {
    id: '5-kiri-besar',
    name: '1 besar + 4',
    cells: [
      [0, 0, 0.5, 1],
      ...gridCells(2, 2).map(([x, y, w, h]) => [0.5 + x / 2, y, w / 2, h] as const),
    ],
  },
  {
    id: '5-atas-besar',
    name: 'Atas besar + 4',
    cells: rowCells([[1], [0.25, 0.25, 0.25, 0.25]], [0.6, 0.4]),
  },
  {
    id: '5-plus',
    name: 'Plus',
    cells: rowCells([[1], [0.25, 0.5, 0.25], [1]], [0.25, 0.5, 0.25]),
  },
  {
    id: '5-tengah-besar',
    name: 'Tengah besar + 4',
    cells: columnCells([[0.5, 0.5], [1], [0.5, 0.5]], [0.25, 0.5, 0.25]),
  },

  // ── 6 foto ──
  { id: '6-sorotan', name: 'Sorotan 6', cells: gridWithHero(3, 3, 0, 0) },
  { id: '6-grid-lebar', name: '3 × 2', cells: gridCells(3, 2) },
  {
    id: '6-masonry-3',
    name: 'Masonry 3 kolom',
    cells: columnCells([
      [0.6, 0.4],
      [0.35, 0.65],
      [0.55, 0.45],
    ]),
  },

  // ── 7–16 foto ──
  {
    id: '7-kiri-besar',
    name: '1 besar + 6',
    cells: [
      [0, 0, 0.5, 1],
      ...gridCells(2, 3).map(([x, y, w, h]) => [0.5 + x / 2, y, w / 2, h] as const),
    ],
  },
  {
    id: '7-masonry',
    name: 'Masonry 7',
    cells: columnCells([
      [0.4, 0.6],
      [0.3, 0.4, 0.3],
      [0.6, 0.4],
    ]),
  },
  { id: '8-grid', name: '8 grid', cells: gridCells(2, 4) },
  {
    id: '8-bertingkat',
    name: 'Bertingkat 8',
    cells: [[0, 0, 2 * third, third], ...gridCells(3, 3).slice(2)],
  },
  {
    id: '8-masonry-3',
    name: 'Masonry 3 × 8',
    cells: columnCells([
      [0.35, 0.3, 0.35],
      [0.5, 0.5],
      [0.3, 0.4, 0.3],
    ]),
  },
  { id: '9-sorotan', name: 'Sorotan 9', cells: gridWithHero(4, 3, 0, 0) },
  {
    id: '9-masonry',
    name: 'Masonry 9',
    cells: columnCells([
      [0.3, 0.4, 0.3],
      [0.4, 0.3, 0.3],
      [0.3, 0.3, 0.4],
    ]),
  },
  {
    id: '10-masonry',
    name: 'Masonry 10',
    cells: columnCells([
      [0.25, 0.4, 0.35],
      [0.3, 0.2, 0.25, 0.25],
      [0.4, 0.3, 0.3],
    ]),
  },
  { id: '12-grid', name: '3 × 4', cells: gridCells(3, 4) },
  { id: '13-bingkai', name: 'Bingkai 13', cells: gridWithHero(4, 4, 1, 1) },
  { id: '16-grid', name: '4 × 4', cells: gridCells(4, 4) },

  // ── Gaya bebas: room for a title or notes ──
  {
    id: 'judul-bawah-2',
    name: 'Dua + judul',
    area: [0.08, 0.07, 0.84, 0.66],
    cells: columnCells([[1], [1]]),
  },
  {
    id: 'sudut-4',
    name: 'Empat sudut',
    // Photos in the corners, the middle left for a name or a date.
    area: [0.06, 0.05, 0.88, 0.9],
    cells: [
      [0, 0, 0.44, 0.36],
      [0.56, 0, 0.44, 0.36],
      [0, 0.64, 0.44, 0.36],
      [0.56, 0.64, 0.44, 0.36],
    ],
  },
  {
    id: 'teks-kiri-3',
    name: 'Teks kiri',
    area: [0.42, 0.06, 0.52, 0.88],
    cells: rowCells([[1], [1], [1]]),
  },
  {
    id: 'kolom-tengah-3',
    name: 'Kolom tengah',
    area: [0.27, 0.05, 0.46, 0.9],
    cells: rowCells([[1], [1], [1]]),
  },
  {
    id: 'judul-atas-6',
    name: 'Judul atas 6',
    area: [0.07, 0.25, 0.86, 0.69],
    cells: gridCells(3, 2),
  },

  // ── Gaya bebas: polaroids and frames ──
  {
    id: 'polaroid-4-grid',
    name: 'Polaroid 4',
    free: true,
    frame: 'polaroid',
    cells: (() => {
      const w = 0.41;
      const h = heightFor(w, POLAROID_ASPECT);
      return [
        [0.06, 0.08, w, h, -4],
        [0.53, 0.1, w, h, 3],
        [0.07, 0.52, w, h, 2],
        [0.52, 0.53, w, h, -3],
      ] as Cell[];
    })(),
  },
  {
    id: 'polaroid-kipas-3',
    name: 'Kipas',
    free: true,
    frame: 'polaroid',
    // Fanned out like cards in a hand; the middle one on top.
    cells: (() => {
      const w = 0.46;
      const h = heightFor(w, POLAROID_ASPECT);
      return [
        [0.04, 0.32, w, h, -15],
        [0.5, 0.32, w, h, 15],
        [0.27, 0.25, w, h, 0],
      ] as Cell[];
    })(),
  },
  {
    id: 'jemuran-3',
    name: 'Jemuran',
    free: true,
    frame: 'polaroid',
    // Pegged on a line across the middle — room above and below for text.
    cells: (() => {
      const w = 0.29;
      const h = heightFor(w, POLAROID_ASPECT);
      return [
        [0.04, 0.33, w, h, -4],
        [0.355, 0.35, w, h, 3],
        [0.67, 0.33, w, h, -2],
      ] as Cell[];
    })(),
  },
  {
    id: 'jemuran-6',
    name: 'Jemuran 6',
    free: true,
    frame: 'polaroid',
    cells: (() => {
      const w = 0.29;
      const h = heightFor(w, POLAROID_ASPECT);
      return [
        [0.04, 0.1, w, h, -4],
        [0.355, 0.12, w, h, 3],
        [0.67, 0.1, w, h, -2],
        [0.04, 0.55, w, h, 3],
        [0.355, 0.53, w, h, -3],
        [0.67, 0.55, w, h, 4],
      ] as Cell[];
    })(),
  },
  {
    id: 'polaroid-tumpuk-4',
    name: 'Tumpukan',
    free: true,
    frame: 'polaroid',
    // A loose pile: each one a little off from the one below.
    cells: (() => {
      const w = 0.56;
      const h = heightFor(w, POLAROID_ASPECT);
      return [
        [0.14, 0.14, w, h, -11],
        [0.3, 0.2, w, h, 8],
        [0.16, 0.3, w, h, -4],
        [0.26, 0.4, w, h, 3],
      ] as Cell[];
    })(),
  },
  {
    id: 'bingkai-6-miring',
    name: 'Bingkai miring 6',
    free: true,
    frame: 'border',
    cells: (() => {
      const w = 0.42;
      const h = heightFor(w, 0.8);
      return [
        [0.05, 0.05, w, h, -3],
        [0.53, 0.07, w, h, 2],
        [0.06, 0.37, w, h, 2],
        [0.52, 0.38, w, h, -2],
        [0.05, 0.69, w, h, -2],
        [0.53, 0.7, w, h, 3],
      ] as Cell[];
    })(),
  },
];

/** More carousel layouts, generated for any number of slides like the others. */
export const MORE_CAROUSEL_PATTERNS: CarouselPattern[] = [
  {
    key: 'tiga-kolom',
    name: 'Tiga kolom',
    build: (n) =>
      Array.from({ length: 3 * n }, (_, i) => [i / (3 * n), 0, 1 / (3 * n), 1] as const),
  },
  {
    key: 'tiga-baris',
    name: 'Tiga baris',
    build: (n) =>
      Array.from({ length: n }, (_, i) =>
        [0, third, 2 * third].map((y) => [i / n, y, 1 / n, third] as const),
      ).flat(),
  },
  {
    key: 'sorotan',
    name: 'Sorotan',
    // A big photo and three stacked small ones, sides swapping every slide.
    build: (n) => {
      const u = 1 / n;
      return Array.from({ length: n }, (_, i): Cell[] => {
        const x = i * u;
        const bigLeft = i % 2 === 0;
        const bx = bigLeft ? x : x + 0.38 * u;
        const sx = bigLeft ? x + 0.62 * u : x;
        return [
          [bx, 0, 0.62 * u, 1],
          [sx, 0, 0.38 * u, third],
          [sx, third, 0.38 * u, third],
          [sx, 2 * third, 0.38 * u, third],
        ];
      }).flat();
    },
  },
  {
    key: 'selang-seling',
    name: 'Selang-seling',
    // One full photo, then a grid of four — and again.
    build: (n) => {
      const u = 1 / n;
      return Array.from({ length: n }, (_, i): Cell[] =>
        i % 2 === 0
          ? [[i * u, 0, u, 1]]
          : gridCells(2, 2).map(([x, y, w, h]) => [i * u + x * u, y, w * u, h] as const),
      ).flat();
    },
  },
  {
    key: 'pita-bawah',
    name: 'Pita bawah',
    // Two photos per slide on top, one long band across every slide below.
    build: (n) => {
      const u = 1 / n;
      return [
        ...Array.from({ length: n }, (_, i): Cell[] => [
          [i * u, 0, u / 2, 0.5],
          [i * u + u / 2, 0, u / 2, 0.5],
        ]).flat(),
        [0, 0.5, 1, 0.5],
      ];
    },
  },
  {
    key: 'jembatan-ganda',
    name: 'Jembatan ganda',
    // Top row straddles the slide edges, bottom row sits within each slide.
    build: (n) => {
      const u = 1 / n;
      return [
        [0, 0, u / 2, 0.5],
        ...Array.from({ length: n - 1 }, (_, i) => [(i + 0.5) * u, 0, u, 0.5] as const),
        [(n - 0.5) * u, 0, u / 2, 0.5],
        ...Array.from({ length: n }, (_, i) => [i * u, 0.5, u, 0.5] as const),
      ];
    },
  },
  {
    key: 'masonry',
    name: 'Masonry',
    // Two columns per slide with offset heights, mirrored slide to slide.
    build: (n) => {
      const u = 1 / n;
      return Array.from({ length: n }, (_, i): Cell[] => {
        const [a, b] = i % 2 === 0 ? [0.6, 0.4] : [0.4, 0.6];
        const x = i * u;
        return [
          [x, 0, u / 2, a],
          [x, a, u / 2, 1 - a],
          [x + u / 2, 0, u / 2, b],
          [x + u / 2, b, u / 2, 1 - b],
        ];
      }).flat();
    },
  },
  {
    key: 'grid-9',
    name: 'Grid 9',
    build: (n) => {
      const u = 1 / n;
      return Array.from({ length: n }, (_, i): Cell[] =>
        gridCells(3, 3).map(([x, y, w, h]) => [i * u + x * u, y, w * u, h] as const),
      ).flat();
    },
  },
  {
    key: 'kartu',
    name: 'Kartu',
    free: true,
    // A photo per slide with a wide margin below for a caption.
    build: (n) => {
      const at = inSlides(n);
      return Array.from({ length: n }, (_, i) => at(i + 0.1, 0.07, 0.8, 0.66));
    },
  },
  {
    key: 'jemuran',
    name: 'Jemuran',
    free: true,
    frame: 'polaroid',
    // Polaroids pegged along one line through every slide.
    build: (n) => {
      const at = inSlides(n);
      const w = 0.4;
      const h = heightFor(w, POLAROID_ASPECT);
      return Array.from({ length: n }, (_, i): Cell[] => [
        at(i + 0.07, 0.3, w, h, -4),
        at(i + 0.53, 0.32, w, h, 3),
      ]).flat();
    },
  },
  {
    key: 'kipas',
    name: 'Kipas',
    free: true,
    frame: 'polaroid',
    // Three polaroids fanned out on every slide.
    build: (n) => {
      const at = inSlides(n);
      const w = 0.46;
      const h = heightFor(w, POLAROID_ASPECT);
      return Array.from({ length: n }, (_, i): Cell[] => [
        at(i + 0.04, 0.32, w, h, -15),
        at(i + 0.5, 0.32, w, h, 15),
        at(i + 0.27, 0.25, w, h, 0),
      ]).flat();
    },
  },
  {
    key: 'bingkai-dua',
    name: 'Bingkai dua',
    free: true,
    frame: 'border',
    // Two framed photos per slide, overlapping a little, slightly turned.
    build: (n) => {
      const at = inSlides(n);
      const w = 0.58;
      const h = heightFor(w, 0.78);
      return Array.from({ length: n }, (_, i): Cell[] => [
        at(i + 0.07, 0.08, w, h, -3),
        at(i + 0.35, 0.5, w, h, 2),
      ]).flat();
    },
  },
];
