/**
 * Collage layouts for an Instagram feed post (4:5).
 *
 * Tiled layouts: each cell is [x, y, w, h] as a fraction of the area inside the
 * outer margin, so one definition renders identically in the small preview and
 * the HD export. Cells normally tile that area exactly — gaps are added at
 * render time. A layout may leave background showing on purpose (Polaroid).
 *
 * Area layouts (`area`): the cells tile a rectangle of their own instead of the
 * padded canvas, leaving deliberate empty background — room for a title. The
 * gap still applies between cells; padding does not.
 *
 * Free layouts (`free: true`): cells are fractions of the whole canvas, may
 * overlap and may be rotated (5th value, degrees). Neither gap nor padding
 * applies — the scattered look is the design.
 */
import { grid10, heightFor, inSlides, squareArea, third } from './template-helpers';
import { MORE_CAROUSEL_PATTERNS, MORE_TEMPLATES } from './templates-more';
import {
  cellsSignature,
  generatedCarouselPatterns,
  editorialCarouselPatterns,
  textCoverCarouselPatterns,
  generatedPostTemplates,
  generatedStoryTemplates,
} from './layout-generator';
import type { FormatId } from './document';

export type Cell =
  | readonly [x: number, y: number, w: number, h: number]
  | readonly [x: number, y: number, w: number, h: number, rotate: number];

/** A white frame around every photo, with a soft shadow. */
export type Frame = 'border' | 'polaroid';

export interface CollageTemplate {
  id: string;
  name: string;
  cells: readonly Cell[];
  /** [x, y, w, h] of the canvas that the cells tile, instead of the padded canvas. */
  area?: readonly [x: number, y: number, w: number, h: number];
  free?: boolean;
  frame?: Frame;
  /**
   * Carousel-only: the number of 4:5 slides the layout spans. Cells are
   * fractions of the whole wide canvas, and some deliberately cross a slide
   * edge so the post reads as one continuous picture when swiped.
   */
  slides?: number;
  /** What kind of layout it is, for the picker's category filter. */
  category?: LayoutCategory;
  /** Only offered for these formats (a story-only layout); unset is every format. */
  formats?: readonly FormatId[];
}

/** Kinds of layout, as the picker groups them. */
export type LayoutCategory =
  | 'grid'
  | 'sorotan'
  | 'baris'
  | 'masonry'
  | 'ruang'
  | 'kluster'
  | 'jurnal'
  | 'bingkai'
  | 'tumpuk'
  | 'tiap-slide'
  | 'lintas'
  | 'editorial';

export const LAYOUT_CATEGORIES: { id: LayoutCategory; label: string }[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'sorotan', label: 'Foto utama' },
  { id: 'baris', label: 'Baris & kolom' },
  { id: 'masonry', label: 'Masonry' },
  { id: 'ruang', label: 'Ruang judul' },
  { id: 'kluster', label: 'Kluster' },
  { id: 'jurnal', label: 'Jurnal' },
  { id: 'bingkai', label: 'Bingkai & polaroid' },
  { id: 'tumpuk', label: 'Tumpuk & miring' },
  { id: 'tiap-slide', label: 'Per slide' },
  { id: 'lintas', label: 'Lintas slide' },
  { id: 'editorial', label: 'Editorial & ruang teks' },
];

/**
 * A layout's category: its own, or worked out from its shape for the
 * hand-made ones.
 */
export function categoryOf(t: CollageTemplate): LayoutCategory {
  if (t.category) return t.category;
  if (t.slides) {
    // Carousel: photos that cross a slide edge make it one continuous post.
    const n = t.slides;
    const crosses = t.cells.some(
      ([x, , w]) => Math.floor(x * n + 1e-6) !== Math.floor((x + w) * n - 1e-6),
    );
    if (t.free) return t.frame ? 'bingkai' : 'tumpuk';
    return crosses ? 'lintas' : 'tiap-slide';
  }
  if (t.id.startsWith('jurnal')) return 'jurnal';
  if (t.id.startsWith('kluster')) return 'kluster';
  if (t.free) return t.cells.some((c) => (c[4] ?? 0) !== 0) && !t.frame ? 'tumpuk' : 'bingkai';
  if (t.area) return t.frame ? 'bingkai' : 'ruang';
  if (t.id.includes('masonry')) return 'masonry';
  const areas = t.cells.map(([, , w, h]) => w * h);
  const largest = Math.max(...areas);
  const smallest = Math.min(...areas);
  if (largest - smallest < 0.01) return 'grid';
  if (t.cells.length >= 3 && largest >= 2.2 * smallest) return 'sorotan';
  return 'baris';
}

/** Drops layouts that look exactly like an earlier one; the first one stays. */
function unique(list: CollageTemplate[]): CollageTemplate[] {
  const seen = new Set<string>();
  const ids = new Set<string>();
  return list.filter((t) => {
    const key = [
      cellsSignature(t.cells),
      t.area?.join(',') ?? '',
      t.frame ?? '',
      t.free ? 'bebas' : '',
      t.formats?.join(',') ?? '',
    ].join('#');
    if (seen.has(key) || ids.has(t.id)) return false;
    seen.add(key);
    ids.add(t.id);
    return true;
  });
}

const HAND_MADE: readonly CollageTemplate[] = [
  // ── 1 foto ──
  { id: '1-bingkai', name: '1 foto', cells: [[0, 0, 1, 1]] },
  // Sisa latar di bawah seperti polaroid — tempat napas, atau tulisan tangan di Instagram.
  { id: '1-polaroid', name: 'Polaroid', cells: [[0, 0, 1, 0.8]] },

  // ── 2 foto ──
  {
    id: '2-kolom',
    name: '2 kolom',
    cells: [
      [0, 0, 0.5, 1],
      [0.5, 0, 0.5, 1],
    ],
  },
  {
    id: '2-baris',
    name: '2 baris',
    cells: [
      [0, 0, 1, 0.5],
      [0, 0.5, 1, 0.5],
    ],
  },
  {
    id: '2-asimetris',
    name: '2 asimetris',
    cells: [
      [0, 0, 0.62, 1],
      [0.62, 0, 0.38, 1],
    ],
  },
  {
    id: '2-atas-lebar',
    name: 'Atas lebar',
    cells: [
      [0, 0, 1, 0.65],
      [0, 0.65, 1, 0.35],
    ],
  },

  // ── 3 foto ──
  {
    id: '3-kiri-besar',
    name: '1 besar + 2',
    cells: [
      [0, 0, 0.6, 1],
      [0.6, 0, 0.4, 0.5],
      [0.6, 0.5, 0.4, 0.5],
    ],
  },
  {
    id: '3-kanan-besar',
    name: '2 + 1 besar',
    cells: [
      [0, 0, 0.4, 0.5],
      [0, 0.5, 0.4, 0.5],
      [0.4, 0, 0.6, 1],
    ],
  },
  {
    id: '3-atas-besar',
    name: 'Atas besar + 2',
    cells: [
      [0, 0, 1, 0.6],
      [0, 0.6, 0.5, 0.4],
      [0.5, 0.6, 0.5, 0.4],
    ],
  },
  {
    id: '3-bawah-besar',
    name: '2 + bawah besar',
    cells: [
      [0, 0, 0.5, 0.4],
      [0.5, 0, 0.5, 0.4],
      [0, 0.4, 1, 0.6],
    ],
  },
  {
    id: '3-tengah-lebar',
    name: 'Tengah lebar',
    cells: [
      [0, 0, 1, 0.25],
      [0, 0.25, 1, 0.5],
      [0, 0.75, 1, 0.25],
    ],
  },
  {
    id: '3-kolom',
    name: '3 kolom',
    cells: [
      [0, 0, third, 1],
      [third, 0, third, 1],
      [2 * third, 0, third, 1],
    ],
  },
  {
    id: '3-baris',
    name: '3 baris',
    cells: [
      [0, 0, 1, third],
      [0, third, 1, third],
      [0, 2 * third, 1, third],
    ],
  },

  // ── 4 foto ──
  {
    id: '4-grid',
    name: '4 grid',
    cells: [
      [0, 0, 0.5, 0.5],
      [0.5, 0, 0.5, 0.5],
      [0, 0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5, 0.5],
    ],
  },
  {
    id: '4-atas-besar',
    name: 'Atas besar + 3',
    cells: [
      [0, 0, 1, 0.6],
      [0, 0.6, third, 0.4],
      [third, 0.6, third, 0.4],
      [2 * third, 0.6, third, 0.4],
    ],
  },
  {
    id: '4-bawah-besar',
    name: '3 + bawah besar',
    cells: [
      [0, 0, third, 0.4],
      [third, 0, third, 0.4],
      [2 * third, 0, third, 0.4],
      [0, 0.4, 1, 0.6],
    ],
  },
  {
    id: '4-kiri-besar',
    name: '1 besar + 3',
    cells: [
      [0, 0, 0.62, 1],
      [0.62, 0, 0.38, third],
      [0.62, third, 0.38, third],
      [0.62, 2 * third, 0.38, third],
    ],
  },
  {
    id: '4-zigzag',
    name: 'Zigzag',
    cells: [
      [0, 0, 0.6, 0.5],
      [0.6, 0, 0.4, 0.5],
      [0, 0.5, 0.4, 0.5],
      [0.4, 0.5, 0.6, 0.5],
    ],
  },
  {
    id: '4-blok',
    name: 'Blok',
    cells: [
      [0, 0, 0.65, 0.62],
      [0.65, 0, 0.35, 0.62],
      [0, 0.62, 0.35, 0.38],
      [0.35, 0.62, 0.65, 0.38],
    ],
  },

  // ── 5 foto ──
  {
    id: '5-mosaik',
    name: '5 mosaik',
    cells: [
      [0, 0, 0.5, 0.55],
      [0.5, 0, 0.5, 0.55],
      [0, 0.55, third, 0.45],
      [third, 0.55, third, 0.45],
      [2 * third, 0.55, third, 0.45],
    ],
  },
  {
    id: '5-majalah',
    name: 'Majalah',
    cells: [
      [0, 0, 0.55, 0.45],
      [0.55, 0, 0.45, 0.3],
      [0.55, 0.3, 0.45, 0.3],
      [0, 0.45, 0.55, 0.55],
      [0.55, 0.6, 0.45, 0.4],
    ],
  },
  {
    id: '5-kincir',
    name: 'Kincir',
    cells: [
      [0, 0, 0.65, 0.35],
      [0.65, 0, 0.35, 0.65],
      [0.35, 0.65, 0.65, 0.35],
      [0, 0.35, 0.35, 0.65],
      [0.35, 0.35, 0.3, 0.3],
    ],
  },
  {
    id: '5-sorotan',
    name: 'Sorotan',
    cells: [
      [0, 0, 0.6, 0.6],
      [0.6, 0, 0.4, 0.3],
      [0.6, 0.3, 0.4, 0.3],
      [0, 0.6, 0.5, 0.4],
      [0.5, 0.6, 0.5, 0.4],
    ],
  },

  // ── 6 foto ──
  {
    id: '6-grid',
    name: '6 grid',
    cells: [
      [0, 0, 0.5, third],
      [0.5, 0, 0.5, third],
      [0, third, 0.5, third],
      [0.5, third, 0.5, third],
      [0, 2 * third, 0.5, third],
      [0.5, 2 * third, 0.5, third],
    ],
  },
  {
    id: '6-masonry',
    name: 'Masonry',
    cells: [
      [0, 0, 0.5, 0.4],
      [0, 0.4, 0.5, 0.3],
      [0, 0.7, 0.5, 0.3],
      [0.5, 0, 0.5, 0.25],
      [0.5, 0.25, 0.5, 0.4],
      [0.5, 0.65, 0.5, 0.35],
    ],
  },
  {
    id: '6-atas-besar',
    name: 'Atas besar + 5',
    cells: [
      [0, 0, 1, 0.5],
      [0, 0.5, 0.5, 0.25],
      [0.5, 0.5, 0.5, 0.25],
      [0, 0.75, third, 0.25],
      [third, 0.75, third, 0.25],
      [2 * third, 0.75, third, 0.25],
    ],
  },

  // ── 7+ foto ──
  {
    id: '7-bertingkat',
    name: 'Bertingkat',
    cells: [
      [0, 0, 1, 0.4],
      [0, 0.4, third, 0.3],
      [third, 0.4, third, 0.3],
      [2 * third, 0.4, third, 0.3],
      [0, 0.7, third, 0.3],
      [third, 0.7, third, 0.3],
      [2 * third, 0.7, third, 0.3],
    ],
  },
  {
    id: '8-masonry',
    name: 'Masonry 8',
    cells: [
      [0, 0, 0.5, 0.2],
      [0, 0.2, 0.5, 0.3],
      [0, 0.5, 0.5, 0.25],
      [0, 0.75, 0.5, 0.25],
      [0.5, 0, 0.5, 0.3],
      [0.5, 0.3, 0.5, 0.2],
      [0.5, 0.5, 0.5, 0.3],
      [0.5, 0.8, 0.5, 0.2],
    ],
  },
  {
    id: '9-grid',
    name: '3 × 3',
    cells: [0, 1, 2].flatMap((r) =>
      [0, 1, 2].map((c) => [c * third, r * third, third, third] as const),
    ),
  },
  // ── Gaya bebas: bingkai, miring, dan ruang kosong untuk judul ──
  {
    id: 'polaroid-2-horizontal',
    name: 'Polaroid 2',
    free: true,
    frame: 'polaroid',
    cells: [
      [0.09, 0.05, 0.82, 0.43, -3],
      [0.09, 0.52, 0.82, 0.43, 2.5],
    ],
  },
  {
    id: 'polaroid-1-miring',
    name: 'Polaroid miring',
    free: true,
    frame: 'polaroid',
    cells: [[0.1, 0.09, 0.8, 0.8, -3]],
  },
  {
    id: 'polaroid-3-tumpuk',
    name: 'Polaroid 3',
    free: true,
    frame: 'polaroid',
    cells: [
      [0.05, 0.04, 0.5, 0.46, -6],
      [0.46, 0.18, 0.48, 0.45, 5],
      [0.14, 0.51, 0.5, 0.45, -2],
    ],
  },
  {
    id: 'scrapbook-polaroid-4',
    name: 'Scrapbook',
    free: true,
    frame: 'polaroid',
    cells: [
      [0.04, 0.04, 0.45, 0.33, -3],
      [0.52, 0.03, 0.44, 0.39, 3],
      [0.06, 0.5, 0.42, 0.34, -2],
      [0.54, 0.45, 0.38, 0.31, 2],
    ],
  },
  {
    id: 'scrapbook-5-miring',
    name: 'Tempel miring',
    free: true,
    frame: 'border',
    cells: [
      [0.05, 0.07, 0.6, 0.34, -7],
      [0.46, 0.29, 0.5, 0.23, -2],
      [0.06, 0.46, 0.5, 0.23, 2],
      [0.5, 0.54, 0.46, 0.24, -5],
      [0.1, 0.72, 0.5, 0.23, -4],
    ],
  },
  {
    id: 'meja-4-miring',
    name: 'Di atas meja',
    free: true,
    frame: 'border',
    cells: [
      [0.05, 0.06, 0.5, 0.4, -4],
      [0.47, 0.1, 0.48, 0.38, 5],
      [0.06, 0.5, 0.46, 0.4, 3],
      [0.47, 0.53, 0.48, 0.4, -3],
    ],
  },
  {
    id: 'galeri-bingkai-5',
    name: 'Galeri bingkai',
    frame: 'border',
    area: [0.1, 0.05, 0.81, 0.9],
    cells: [
      [0, 0, 0.38, third],
      [0, third, 0.38, third],
      [0, 2 * third, 0.38, third],
      [0.38, 0, 0.62, 0.5],
      [0.38, 0.5, 0.62, 0.5],
    ],
  },
  {
    id: 'judul-bawah-4',
    name: 'Judul bawah',
    area: [0.06, 0.05, 0.88, 0.74],
    cells: [
      [0, 0, 0.5, 0.5],
      [0.5, 0, 0.5, 0.5],
      [0, 0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5, 0.5],
    ],
  },
  {
    id: 'judul-atas-bawah-4',
    name: 'Tanggal & nama',
    area: [0.1, 0.09, 0.8, 0.77],
    cells: [
      [0, 0, 0.65, 0.7],
      [0.65, 0, 0.35, 0.36],
      [0.65, 0.36, 0.35, 0.64],
      [0, 0.7, 0.65, 0.3],
    ],
  },
  {
    id: 'judul-atas-3',
    name: 'Judul atas',
    area: [0.08, 0.2, 0.84, 0.74],
    cells: [
      [0, 0, 1, 0.58],
      [0, 0.58, 0.5, 0.42],
      [0.5, 0.58, 0.5, 0.42],
    ],
  },
  {
    id: 'tangga-5',
    name: 'Tangga',
    // Area 0.8 × 0.64 of a 4:5 canvas → each third is square.
    area: [0.1, 0.18, 0.8, 0.64],
    cells: [
      [0, 0, third, third],
      [0, third, third, third],
      [third, third, third, third],
      [third, 2 * third, third, third],
      [2 * third, 2 * third, third, third],
    ],
  },
  {
    id: 'tangga-5-portrait',
    name: 'Tangga 4:5',
    // Equal area fractions on a 4:5 canvas → each third is 4:5 as well.
    area: [0.12, 0.12, 0.76, 0.76],
    cells: [
      [0, 0, third, third],
      [0, third, third, third],
      [third, third, third, third],
      [third, 2 * third, third, third],
      [2 * third, 2 * third, third, third],
    ],
  },
  {
    id: 'film-3',
    name: 'Film',
    area: [0.1, 0.1, 0.8, 0.76],
    cells: [
      [0, 0, 1, third],
      [0, third, 1, third],
      [0, 2 * third, 1, third],
    ],
  },
  {
    id: 'bingkai-judul-1',
    name: '1 + judul',
    area: [0.1, 0.08, 0.8, 0.7],
    cells: [[0, 0, 1, 1]],
  },

  // ── Clusters: photos grouped in the middle, background all around ──
  // Drawn on a 10 × 10 grid inside a square area (see `squareArea`), so the
  // shapes read the same as they were sketched. Cells that touch share a gap.
  {
    id: 'kluster-baris-3',
    name: 'Baris tengah',
    area: squareArea(),
    cells: grid10([
      [0, 3.33, 3.33, 3.34],
      [3.33, 3.33, 3.34, 3.34],
      [6.67, 3.33, 3.33, 3.34],
    ]),
  },
  {
    id: 'kluster-tengah-tinggi-3',
    name: 'Tengah tinggi',
    area: squareArea(),
    cells: grid10([
      [0.4, 3.6, 2.9, 2.8],
      [3.3, 2.6, 3.4, 4.8],
      [6.7, 3.6, 2.9, 2.8],
    ]),
  },
  {
    id: 'kluster-pita-5',
    name: 'Pita sorotan',
    area: [0.05, 0.28, 0.9, 0.44],
    cells: [
      [0, 0, 0.24, 0.5],
      [0, 0.5, 0.24, 0.5],
      [0.24, 0, 0.52, 1],
      [0.76, 0, 0.24, 0.5],
      [0.76, 0.5, 0.24, 0.5],
    ],
  },
  {
    id: 'kluster-silang-6',
    name: 'Silang',
    area: squareArea(),
    cells: grid10([
      [3.6, 0.6, 2.6, 2.6],
      [3.6, 3.2, 2.6, 3],
      [3.6, 6.2, 2.6, 2.6],
      [1, 3.6, 2.6, 2.2],
      [6.2, 3.4, 2.4, 2.4],
      [8.6, 3.9, 1.3, 1.4],
    ]),
  },
  {
    id: 'kluster-tangga-6',
    name: 'Tangga kluster',
    area: squareArea(),
    cells: grid10([
      [3.2, 2.6, 4, 3.2],
      [7.2, 1.4, 2.2, 2.2],
      [3.2, 5.8, 1.34, 1.9],
      [4.54, 5.8, 1.33, 1.9],
      [5.87, 5.8, 1.33, 1.9],
      [0.8, 4.6, 2.4, 2.4],
    ]),
  },
  {
    id: 'kluster-7',
    name: 'Kluster',
    area: squareArea(),
    cells: grid10([
      [2.8, 1.2, 2.4, 2.2],
      [5.2, 1.2, 2.6, 2.2],
      [1.2, 3.4, 2.6, 2.4],
      [3.8, 3.4, 2.4, 2.4],
      [6.2, 3.4, 2.6, 2.4],
      [3, 5.8, 2.6, 2.4],
      [5.6, 5.8, 2.2, 2.4],
    ]),
  },
  {
    id: 'kluster-pita-7',
    name: 'Pita sorotan 7',
    area: [0.05, 0.3, 0.9, 0.4],
    cells: [
      [0, 0, 0.2, third],
      [0, third, 0.2, third],
      [0, 2 * third, 0.2, third],
      [0.2, 0, 0.6, 1],
      [0.8, 0, 0.2, third],
      [0.8, third, 0.2, third],
      [0.8, 2 * third, 0.2, third],
    ],
  },

  // ── Journal pages: a cluster of photos with room for a title and notes ──
  {
    id: 'jurnal-kanan-6',
    name: 'Jurnal samping',
    area: [0.06, 0.05, 0.88, 0.9],
    cells: [
      [0, 0, 0.3, 0.26],
      [0.3, 0, 0.36, 0.36],
      [0, 0.26, 0.3, 0.3],
      [0.3, 0.36, 0.36, 0.28],
      [0, 0.56, 0.3, 0.3],
      [0.66, 0, 0.34, 0.26],
    ],
  },
  {
    id: 'jurnal-l-6',
    name: 'Jurnal sudut',
    area: [0.06, 0.05, 0.88, 0.9],
    cells: [
      [0, 0, 0.34, 0.28],
      [0.34, 0, 0.3, 0.22],
      [0.64, 0, 0.36, 0.34],
      [0.34, 0.22, 0.3, 0.24],
      [0.64, 0.34, 0.36, 0.3],
      [0.64, 0.64, 0.36, 0.3],
    ],
  },
  {
    id: 'jurnal-bawah-6',
    name: 'Jurnal bawah',
    area: [0.06, 0.05, 0.88, 0.9],
    cells: [
      [0.08, 0.04, 0.3, 0.26],
      [0.38, 0, 0.3, 0.24],
      [0.68, 0.06, 0.3, 0.28],
      [0.38, 0.24, 0.3, 0.3],
      [0, 0.3, 0.38, 0.28],
      [0.68, 0.34, 0.3, 0.24],
    ],
  },
  ...MORE_TEMPLATES,
];

/** Every non-carousel layout: the hand-made ones first, then the generated catalog. */
export const TEMPLATES: readonly CollageTemplate[] = unique([
  ...HAND_MADE,
  ...generatedPostTemplates(),
  ...generatedStoryTemplates(),
]);

type CellList = Cell[];

/**
 * Carousel layouts, generated for any number of slides. Cells are fractions of
 * the whole wide canvas; `u` is one slide. Several patterns deliberately put a
 * photo across a slide edge, so swiping the post reads as one picture.
 */
export interface CarouselPattern {
  key: string;
  name: string;
  build: (n: number) => CellList;
  /** Cells placed on the whole canvas (may overlap, tilt) — no gap or padding. */
  free?: boolean;
  frame?: Frame;
  area?: readonly [x: number, y: number, w: number, h: number];
  category?: LayoutCategory;
}

const CAROUSEL_PATTERNS: CarouselPattern[] = [
  { key: 'panorama', name: 'Panorama', build: () => [[0, 0, 1, 1]] },
  {
    key: 'jembatan',
    name: 'Jembatan',
    // Every photo straddles a slide edge; half-photos close both ends.
    build: (n) => {
      const u = 1 / n;
      return [
        [0, 0, u / 2, 1],
        ...Array.from({ length: n - 1 }, (_, i) => [(i + 0.5) * u, 0, u, 1] as const),
        [(n - 0.5) * u, 0, u / 2, 1],
      ];
    },
  },
  {
    key: 'sambung',
    name: 'Sambung besar',
    // A big photo on every slide edge, two small ones stacked in between.
    build: (n) => {
      const u = 1 / n;
      const cells: CellList = [];
      for (let i = 0; i < n; i++) {
        const left = i === 0 ? 0 : (i + 0.3) * u;
        const right = i === n - 1 ? 1 : (i + 0.7) * u;
        cells.push([left, 0, right - left, 0.5], [left, 0.5, right - left, 0.5]);
        if (i < n - 1) cells.push([(i + 0.7) * u, 0, 0.6 * u, 1]);
      }
      return cells;
    },
  },
  {
    key: 'pita',
    name: 'Pita',
    // One long band across all slides on top, a photo per slide below.
    build: (n) => {
      const u = 1 / n;
      return [
        [0, 0, 1, 0.45],
        ...Array.from({ length: n }, (_, i) => [i * u, 0.45, u, 0.55] as const),
      ];
    },
  },
  {
    key: 'per-slide',
    name: 'Satu per slide',
    build: (n) => Array.from({ length: n }, (_, i) => [i / n, 0, 1 / n, 1] as const),
  },
  {
    key: 'dua',
    name: 'Dua per slide',
    build: (n) =>
      Array.from({ length: n }, (_, i) => [
        [i / n, 0, 1 / n, 0.5] as const,
        [i / n, 0.5, 1 / n, 0.5] as const,
      ]).flat(),
  },
  {
    key: 'mosaik',
    name: 'Mosaik',
    // Big photo left, two stacked right — mirrored on every other slide.
    build: (n) => {
      const u = 1 / n;
      return Array.from({ length: n }, (_, i): CellList => {
        const x = i * u;
        return i % 2 === 0
          ? [
              [x, 0, 0.6 * u, 1],
              [x + 0.6 * u, 0, 0.4 * u, 0.5],
              [x + 0.6 * u, 0.5, 0.4 * u, 0.5],
            ]
          : [
              [x, 0, 0.4 * u, 0.5],
              [x, 0.5, 0.4 * u, 0.5],
              [x + 0.4 * u, 0, 0.6 * u, 1],
            ];
      }).flat();
    },
  },
  {
    key: 'zigzag',
    name: 'Zigzag',
    // Wide photo on top then two below, flipped upside down on every other slide.
    build: (n) => {
      const u = 1 / n;
      return Array.from({ length: n }, (_, i): CellList => {
        const x = i * u;
        return i % 2 === 0
          ? [
              [x, 0, u, 0.62],
              [x, 0.62, u / 2, 0.38],
              [x + u / 2, 0.62, u / 2, 0.38],
            ]
          : [
              [x, 0, u / 2, 0.38],
              [x + u / 2, 0, u / 2, 0.38],
              [x, 0.38, u, 0.62],
            ];
      }).flat();
    },
  },
  {
    key: 'grid',
    name: 'Grid 4',
    build: (n) =>
      Array.from({ length: n }, (_, i) => {
        const x = i / n;
        const h = 1 / (2 * n);
        return [
          [x, 0, h, 0.5] as const,
          [x + h, 0, h, 0.5] as const,
          [x, 0.5, h, 0.5] as const,
          [x + h, 0.5, h, 0.5] as const,
        ];
      }).flat(),
  },

  // ── Styled layouts: room around the photos, frames, a little tilt ──
  {
    key: 'pameran',
    name: 'Pameran',
    free: true,
    frame: 'border',
    // One framed photo per slide, centered with a wide margin — a gallery wall.
    build: (n) => {
      const at = inSlides(n);
      const h = heightFor(0.64, 1.2);
      return Array.from({ length: n }, (_, i) => at(i + 0.18, (1 - h) / 2 - 0.02, 0.64, h));
    },
  },
  {
    key: 'editorial',
    name: 'Editorial',
    free: true,
    // Magazine pages: a cover with space for a title, then tall + small, then
    // two offset photos. Plenty of background left for text.
    build: (n) => {
      const at = inSlides(n);
      return Array.from({ length: n }, (_, i): CellList => {
        const kind = i === 0 ? 0 : ((i - 1) % 2) + 1;
        if (kind === 0) return [at(i + 0.1, 0.08, 0.8, 0.62)];
        if (kind === 1)
          return [at(i + 0.08, 0.1, 0.5, 0.78), at(i + 0.63, 0.5, 0.29, heightFor(0.29, 1.3))];
        return [at(i + 0.08, 0.08, 0.56, 0.4), at(i + 0.36, 0.53, 0.56, 0.38)];
      }).flat();
    },
  },
  {
    key: 'polaroid',
    name: 'Polaroid tersebar',
    free: true,
    frame: 'polaroid',
    // Two tilted polaroids per slide; the lower one reaches into the next slide.
    build: (n) => {
      const at = inSlides(n);
      const h = heightFor(0.48, 1.18);
      return Array.from({ length: n }, (_, i): CellList => [
        at(i + 0.08, 0.07, 0.48, h, i % 2 ? 4 : -5),
        at(i === n - 1 ? i + 0.44 : i + 0.6, 0.47, 0.48, h, i % 2 ? -4 : 5),
      ]).flat();
    },
  },
  {
    key: 'tumpuk',
    name: 'Tumpuk',
    free: true,
    // A big photo with two small ones overlapping its corners.
    build: (n) => {
      const at = inSlides(n);
      return Array.from({ length: n }, (_, i): CellList => [
        at(i + 0.16, 0.14, 0.68, 0.64),
        at(i + 0.06, 0.06, 0.34, heightFor(0.34, 1), -6),
        at(i + 0.6, 0.67, 0.34, heightFor(0.34, 1), 5),
      ]).flat();
    },
  },
  {
    key: 'galeri',
    name: 'Dinding galeri',
    free: true,
    frame: 'border',
    // Framed photos along one line, a big and a small one per slide — the
    // order flips every slide, so the wall does not repeat itself.
    build: (n) => {
      const at = inSlides(n);
      const big = { w: 0.42, h: heightFor(0.42, 1.25) };
      const small = { w: 0.3, h: heightFor(0.3, 1) };
      return Array.from({ length: n }, (_, i): CellList => {
        const [first, second] = i % 2 ? [small, big] : [big, small];
        const x = i + (1 - first.w - second.w - 0.1) / 2;
        return [
          at(x, 0.5 - first.h / 2, first.w, first.h),
          at(x + first.w + 0.1, 0.5 - second.h / 2, second.w, second.h),
        ];
      }).flat();
    },
  },
  {
    key: 'pita-film',
    name: 'Pita film',
    // A band of photos across every slide, background above and below for text.
    area: [0, 0.3, 1, 0.4],
    build: (n) =>
      Array.from({ length: 2 * n }, (_, i) => [i / (2 * n), 0, 1 / (2 * n), 1] as const),
  },
  {
    key: 'asimetris',
    name: 'Asimetris',
    // Columns of uneven width, some split — they run over slide edges on purpose.
    build: (n) => {
      const columns = [
        { w: 0.62, rows: [1] },
        { w: 0.44, rows: [0.44, 0.56] },
        { w: 0.72, rows: [1] },
        { w: 0.4, rows: [0.6, 0.4] },
      ];
      const cols: { x: number; w: number; rows: number[] }[] = [];
      let x = 0;
      for (let k = 0; x < n - 1e-9; k++) {
        const c = columns[k % columns.length]!;
        const w = Math.min(c.w, n - x);
        cols.push({ x, w, rows: c.rows });
        x += w;
      }
      // A sliver at the end reads as a mistake: fold it into the column before.
      const last = cols[cols.length - 1]!;
      if (cols.length > 1 && last.w < 0.3) {
        cols.pop();
        cols[cols.length - 1]!.w += last.w;
      }
      return cols.flatMap((c) => {
        let y = 0;
        return c.rows.map((h) => {
          const cell = [c.x / n, y, c.w / n, h] as const;
          y += h;
          return cell;
        });
      });
    },
  },
  ...MORE_CAROUSEL_PATTERNS,
  ...generatedCarouselPatterns(),
  ...textCoverCarouselPatterns(),
  ...editorialCarouselPatterns(),
];

export const carouselTemplateId = (pattern: string, slides: number) =>
  `carousel:${pattern}:${slides}`;

/** All carousel layouts for a given number of slides. */
/** Carousel layouts per slide count, worked out once. */
const carouselCache = new Map<number, CollageTemplate[]>();

/**
 * All carousel layouts for a given number of slides. With few slides some
 * patterns come out the same (an editorial set is only its cover and closing
 * at two slides) — those are shown once.
 */
export function carouselTemplates(slides: number): CollageTemplate[] {
  const cached = carouselCache.get(slides);
  if (cached) return cached;
  const list = unique(
    CAROUSEL_PATTERNS.map((p): CollageTemplate => ({
      id: carouselTemplateId(p.key, slides),
      name: p.name,
      slides,
      cells: p.build(slides),
      ...(p.free ? { free: true } : {}),
      ...(p.frame ? { frame: p.frame } : {}),
      ...(p.area ? { area: p.area } : {}),
      ...(p.category ? { category: p.category } : {}),
    })),
  );
  carouselCache.set(slides, list);
  return list;
}

/** The pattern of a generated carousel layout id, e.g. `jembatan`. */
export function carouselPattern(id: string): string | null {
  const m = /^carousel:([^:]+):\d+$/.exec(id);
  return m ? m[1]! : null;
}
