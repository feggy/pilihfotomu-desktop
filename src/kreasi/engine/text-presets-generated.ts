import type { TextPreset, TextPresetCategory, TextPresetLine } from './text-presets';
import { STUDIO_TOKEN } from './text-presets';

/**
 * A thousand-odd text styles, built from parts a designer would pick: moods
 * (how the lines relate — sizes, spacing, case, which one is gold), each with
 * a few font pairings that suit it, applied to the words each occasion needs.
 * Hand-made styles live in ./text-presets.ts; these fill the catalog out.
 */

/** The words of one style: an optional line above, the title, a line below. */
interface Words {
  kicker?: string;
  title: string;
  sub?: string;
  /** Words people search by that the lines do not say — "natal" for Merry Christmas. */
  tags?: string[];
}

const WORDS: Record<TextPresetCategory, Words[]> = {
  pernikahan: [
    {
      kicker: 'THE WEDDING OF',
      title: 'Rani & Dimas',
      sub: '12 · 10 · 2026',
      tags: ['undangan', 'nikah', 'wedding'],
    },
    {
      kicker: 'SAVE THE DATE',
      title: 'Rani & Dimas',
      sub: 'Sabtu, 12 Oktober 2026',
      tags: ['undangan', 'tanggal', 'nikah'],
    },
    {
      kicker: 'OUR PREWEDDING',
      title: 'Forever Us',
      sub: 'RANI & DIMAS',
      tags: ['prewedding', 'pasangan', 'cinta'],
    },
    {
      kicker: 'AKAD NIKAH',
      title: 'Rani & Dimas',
      sub: 'Masjid Agung · 08.00',
      tags: ['akad', 'nikah', 'islami'],
    },
  ],
  wisuda: [
    {
      kicker: 'CLASS OF 2026',
      title: 'Graduated',
      sub: 'Nadia Putri, S.Kom.',
      tags: ['wisuda', 'kelulusan', 'lulus'],
    },
    {
      kicker: 'SELAMAT WISUDA',
      title: 'Nadia Putri',
      sub: 'Universitas Indonesia',
      tags: ['wisuda', 'kelulusan', 'kampus'],
    },
    {
      kicker: 'CUM LAUDE',
      title: 'Finally!',
      sub: 'S1 Manajemen · 2026',
      tags: ['wisuda', 'lulus', 'cumlaude'],
    },
  ],
  'ulang-tahun': [
    {
      kicker: 'HAPPY BIRTHDAY',
      title: 'Nadia',
      sub: '17 tahun · 12.10.2026',
      tags: ['ulang tahun', 'ultah', 'birthday', 'sweet seventeen'],
    },
    {
      kicker: 'SELAMAT ULANG TAHUN',
      title: 'Kenzo ke-5',
      sub: 'Sabtu, 12 Oktober',
      tags: ['ulang tahun', 'ultah', 'anak'],
    },
    {
      kicker: "IT'S MY",
      title: 'Birthday',
      sub: "Let's celebrate",
      tags: ['ulang tahun', 'ultah', 'pesta'],
    },
  ],
  keluarga: [
    {
      kicker: 'WELCOME TO THE WORLD',
      title: 'Aksa Pradipta',
      sub: 'Lahir 12.10.2026 · 3,2 kg',
      tags: ['bayi', 'newborn', 'kelahiran'],
    },
    {
      kicker: 'OUR LITTLE',
      title: 'Family',
      sub: 'Keluarga Pradipta',
      tags: ['keluarga', 'family'],
    },
    {
      kicker: 'MENANTI',
      title: 'Buah Hati',
      sub: 'Desember 2026',
      tags: ['kehamilan', 'maternity', 'bayi', 'hamil'],
    },
  ],
  studio: [
    {
      kicker: 'LIMITED SLOT',
      title: 'Open Booking',
      sub: 'Oktober 2026',
      tags: ['promo', 'jadwal', 'slot'],
    },
    {
      kicker: 'PROMO SPESIAL',
      title: 'Diskon 30%',
      sub: 'Paket prewedding',
      tags: ['promo', 'potongan harga', 'sale'],
    },
    {
      kicker: 'NEW',
      title: 'Portfolio',
      sub: 'Prewedding · Wisuda · Keluarga',
      tags: ['promo', 'karya', 'studio'],
    },
    {
      kicker: 'DARI KAMI',
      title: 'Terima kasih',
      sub: STUDIO_TOKEN,
      tags: ['thank you', 'klien', 'studio'],
    },
  ],
  'hari-raya': [
    {
      kicker: 'SELAMAT HARI RAYA',
      title: 'Idul Fitri',
      sub: 'Mohon maaf lahir & batin',
      tags: ['lebaran', 'hari raya', 'eid'],
    },
    {
      kicker: "SEASON'S GREETINGS",
      title: 'Merry Christmas',
      sub: '& Happy New Year',
      tags: ['natal', 'christmas', 'tahun baru'],
    },
    {
      kicker: 'HAPPY',
      title: 'New Year 2027',
      sub: 'Semoga penuh berkah',
      tags: ['tahun baru', 'new year'],
    },
    {
      kicker: 'DIRGAHAYU',
      title: 'Indonesia',
      sub: '17 Agustus 2026',
      tags: ['kemerdekaan', '17 agustus', 'hut ri'],
    },
  ],
  kutipan: [
    { title: 'Cinta itu sederhana', sub: '— Rani & Dimas', tags: ['kutipan', 'quote', 'cinta'] },
    { title: 'Collect moments', sub: 'not things', tags: ['kutipan', 'quote'] },
    {
      title: 'Hari ini adalah hadiah',
      sub: '— selalu bersyukur',
      tags: ['kutipan', 'quote', 'syukur'],
    },
  ],
  editorial: [
    {
      kicker: 'ISSUE NO. 07',
      title: 'Summer',
      sub: 'a little story of us',
      tags: ['majalah', 'magazine', 'sampul'],
    },
    {
      kicker: 'THE PORTRAIT',
      title: 'Timeless',
      sub: 'Edisi Oktober 2026',
      tags: ['majalah', 'potret', 'portrait'],
    },
    {
      kicker: 'VOL. 01',
      title: 'Golden Hour',
      sub: 'Photo diary',
      tags: ['majalah', 'senja', 'diary'],
    },
  ],
  sosmed: [
    {
      kicker: 'SWIPE',
      title: 'Photo Dump',
      sub: 'Oktober 2026',
      tags: ['instagram', 'carousel', 'dump'],
    },
    {
      kicker: 'NEW POST',
      title: 'Coming Soon',
      sub: 'nantikan, ya!',
      tags: ['instagram', 'segera', 'teaser'],
    },
    {
      kicker: 'GIVEAWAY',
      title: 'Menangkan Sesi Foto',
      sub: 'Ikuti syarat di caption',
      tags: ['giveaway', 'kuis', 'hadiah'],
    },
  ],
};

/** A line's look: font and how it is set. `em` is how wide a letter runs, for fitting. */
interface Face {
  font: string;
  size: number;
  weight?: number;
  italic?: boolean;
  spacing?: number;
  caps?: boolean;
  aksen?: boolean;
  /** Average letter width in em — scripts run narrow, caps and display wide. */
  em?: number;
}

/** A mood: which lines it keeps, and the font pairings that carry it. */
interface Mood {
  id: string;
  label: string;
  /** Leaves out the line above the title — a quieter look. */
  noKicker?: boolean;
  pairs: { kicker: Face; title: Face; sub: Face }[];
}

const capsLine = (font: string, extra: Partial<Face> = {}): Face => ({
  font,
  size: 0.024,
  spacing: 0.3,
  caps: true,
  em: 0.7,
  ...extra,
});

const MOODS: Mood[] = [
  {
    id: 'elegan',
    label: 'Elegan',
    pairs: [
      {
        kicker: capsLine('tenor-sans', { spacing: 0.35 }),
        title: { font: 'mrs-saint-delafield', size: 0.12, em: 0.42 },
        sub: capsLine('tenor-sans', { aksen: true }),
      },
      {
        kicker: capsLine('cinzel', { spacing: 0.3 }),
        title: { font: 'script', size: 0.11, em: 0.45 },
        sub: capsLine('cinzel', { aksen: true }),
      },
      {
        kicker: capsLine('josefin', { spacing: 0.4 }),
        title: { font: 'alex-brush', size: 0.11, em: 0.45 },
        sub: capsLine('josefin', { aksen: true }),
      },
    ],
  },
  {
    id: 'klasik',
    label: 'Klasik',
    pairs: [
      {
        kicker: { font: 'serif', size: 0.032, italic: true, em: 0.5 },
        title: { font: 'display', size: 0.085, em: 0.55 },
        sub: capsLine('lato', { weight: 700, size: 0.02, aksen: true }),
      },
      {
        kicker: { font: 'cardo', size: 0.032, italic: true, em: 0.5 },
        title: { font: 'prata', size: 0.08, em: 0.58 },
        sub: capsLine('manrope', { weight: 600, size: 0.02, aksen: true }),
      },
      {
        kicker: { font: 'libre-caslon-text', size: 0.03, italic: true, em: 0.52 },
        title: { font: 'gilda-display', size: 0.085, em: 0.55 },
        sub: capsLine('tenor-sans', { aksen: true }),
      },
    ],
  },
  {
    id: 'modern',
    label: 'Modern',
    pairs: [
      {
        kicker: capsLine('modern', { weight: 600, size: 0.022, spacing: 0.4, aksen: true }),
        title: { font: 'modern', size: 0.08, weight: 700, em: 0.62 },
        sub: { font: 'modern', size: 0.03, weight: 400, em: 0.55 },
      },
      {
        kicker: capsLine('plus-jakarta-sans', {
          weight: 700,
          size: 0.022,
          spacing: 0.35,
          aksen: true,
        }),
        title: { font: 'plus-jakarta-sans', size: 0.08, weight: 800, em: 0.6 },
        sub: { font: 'plus-jakarta-sans', size: 0.03, em: 0.55 },
      },
      {
        kicker: capsLine('outfit', { weight: 600, size: 0.022, spacing: 0.4, aksen: true }),
        title: { font: 'outfit', size: 0.085, weight: 700, em: 0.56 },
        sub: { font: 'outfit', size: 0.03, weight: 300, em: 0.52 },
      },
    ],
  },
  {
    id: 'minimalis',
    label: 'Minimalis',
    noKicker: true,
    pairs: [
      {
        kicker: capsLine('outfit'),
        title: { font: 'outfit', size: 0.1, weight: 200, spacing: 0.05, em: 0.56 },
        sub: capsLine('outfit', { size: 0.02, spacing: 0.45, aksen: true }),
      },
      {
        kicker: capsLine('jost'),
        title: { font: 'jost', size: 0.1, weight: 300, spacing: 0.04, em: 0.54 },
        sub: capsLine('jost', { size: 0.02, spacing: 0.45, aksen: true }),
      },
      {
        kicker: capsLine('manrope'),
        title: { font: 'manrope', size: 0.09, weight: 300, spacing: 0.03, em: 0.58 },
        sub: capsLine('manrope', { size: 0.02, spacing: 0.4, aksen: true }),
      },
    ],
  },
  {
    id: 'ceria',
    label: 'Ceria',
    pairs: [
      {
        kicker: { font: 'patrick-hand', size: 0.035, em: 0.45 },
        title: { font: 'fredoka', size: 0.085, weight: 600, aksen: true, em: 0.58 },
        sub: { font: 'kalam', size: 0.04, em: 0.5 },
      },
      {
        kicker: { font: 'indie-flower', size: 0.035, em: 0.48 },
        title: { font: 'chewy', size: 0.09, aksen: true, em: 0.55 },
        sub: { font: 'quicksand', size: 0.03, weight: 600, em: 0.55 },
      },
      {
        kicker: { font: 'kalam', size: 0.035, em: 0.5 },
        title: { font: 'righteous', size: 0.08, aksen: true, em: 0.6 },
        sub: { font: 'rounded', size: 0.03, weight: 600, em: 0.55 },
      },
    ],
  },
  {
    id: 'tegas',
    label: 'Tegas',
    pairs: [
      {
        kicker: capsLine('modern', { weight: 700, size: 0.022, spacing: 0.35 }),
        title: { font: 'anton', size: 0.13, caps: true, em: 0.48 },
        sub: { font: 'yellowtail', size: 0.055, aksen: true, em: 0.45 },
      },
      {
        kicker: capsLine('figtree', { weight: 700, size: 0.022, spacing: 0.35 }),
        title: { font: 'bebas-neue', size: 0.15, caps: true, spacing: 0.04, em: 0.45 },
        sub: { font: 'kaushan-script', size: 0.05, aksen: true, em: 0.48 },
      },
      {
        kicker: capsLine('lato', { weight: 700, size: 0.022, spacing: 0.35 }),
        title: { font: 'archivo-black', size: 0.1, caps: true, em: 0.72 },
        sub: { font: 'pacifico', size: 0.045, aksen: true, em: 0.55 },
      },
    ],
  },
  {
    id: 'retro',
    label: 'Retro',
    pairs: [
      {
        kicker: capsLine('space-grotesk', { weight: 500, size: 0.022, spacing: 0.25 }),
        title: { font: 'lobster', size: 0.1, aksen: true, em: 0.5 },
        sub: capsLine('space-grotesk', { weight: 500, size: 0.022, spacing: 0.25 }),
      },
      {
        kicker: capsLine('syncopate', { size: 0.02, spacing: 0.3 }),
        title: { font: 'pacifico', size: 0.085, aksen: true, em: 0.55 },
        sub: capsLine('syncopate', { size: 0.02, spacing: 0.3 }),
      },
      {
        kicker: capsLine('staatliches', { size: 0.028, spacing: 0.2 }),
        title: { font: 'yellowtail', size: 0.1, aksen: true, em: 0.45 },
        sub: capsLine('staatliches', { size: 0.028, spacing: 0.2 }),
      },
    ],
  },
  {
    id: 'editorial',
    label: 'Editorial',
    pairs: [
      {
        kicker: { font: 'serif', size: 0.034, italic: true, aksen: true, em: 0.5 },
        title: { font: 'bodoni-moda', size: 0.12, weight: 700, em: 0.58 },
        sub: capsLine('tenor-sans', { size: 0.02, spacing: 0.35 }),
      },
      {
        kicker: { font: 'instrument-serif', size: 0.036, italic: true, aksen: true, em: 0.46 },
        title: { font: 'gloock', size: 0.11, em: 0.6 },
        sub: capsLine('jost', { weight: 500, size: 0.02, spacing: 0.35 }),
      },
      {
        kicker: { font: 'fraunces', size: 0.032, italic: true, aksen: true, em: 0.5 },
        title: { font: 'young-serif', size: 0.1, em: 0.6 },
        sub: capsLine('work-sans', { weight: 500, size: 0.02, spacing: 0.35 }),
      },
    ],
  },
  {
    id: 'tulisan-tangan',
    label: 'Tulisan tangan',
    pairs: [
      {
        kicker: { font: 'shadows-into-light', size: 0.035, em: 0.45 },
        title: { font: 'homemade-apple', size: 0.065, em: 0.6 },
        sub: { font: 'amatic-sc', size: 0.05, weight: 700, aksen: true, em: 0.35 },
      },
      {
        kicker: { font: 'caveat', size: 0.04, em: 0.4 },
        title: { font: 'la-belle-aurore', size: 0.085, em: 0.5 },
        sub: { font: 'caveat', size: 0.045, weight: 700, aksen: true, em: 0.4 },
      },
      {
        kicker: { font: 'indie-flower', size: 0.035, em: 0.48 },
        title: { font: 'mr-dafoe', size: 0.1, em: 0.42 },
        sub: { font: 'patrick-hand', size: 0.04, aksen: true, em: 0.45 },
      },
    ],
  },
  {
    id: 'mewah',
    label: 'Mewah',
    pairs: [
      {
        kicker: capsLine('marcellus', { size: 0.022, spacing: 0.35 }),
        title: {
          font: 'cinzel-decorative',
          size: 0.065,
          weight: 700,
          caps: true,
          spacing: 0.08,
          aksen: true,
          em: 0.8,
        },
        sub: { font: 'pinyon', size: 0.06, em: 0.45 },
      },
      {
        kicker: capsLine('cinzel', { size: 0.022, spacing: 0.35 }),
        title: {
          font: 'cinzel',
          size: 0.07,
          weight: 700,
          caps: true,
          spacing: 0.1,
          aksen: true,
          em: 0.8,
        },
        sub: { font: 'script', size: 0.065, em: 0.45 },
      },
      {
        kicker: capsLine('bellefair', { size: 0.024, spacing: 0.35 }),
        title: { font: 'forum', size: 0.075, caps: true, spacing: 0.12, aksen: true, em: 0.75 },
        sub: { font: 'petit-formal-script', size: 0.045, em: 0.55 },
      },
    ],
  },
  {
    id: 'art-deco',
    label: 'Art deco',
    pairs: [
      {
        kicker: capsLine('poiret-one', { size: 0.026, spacing: 0.35 }),
        title: { font: 'limelight', size: 0.08, em: 0.62 },
        sub: capsLine('poiret-one', { size: 0.026, spacing: 0.35, aksen: true }),
      },
      {
        kicker: capsLine('josefin', { weight: 300, size: 0.022, spacing: 0.45 }),
        title: { font: 'poiret-one', size: 0.1, caps: true, spacing: 0.1, em: 0.62 },
        sub: capsLine('josefin', { weight: 300, size: 0.022, spacing: 0.45, aksen: true }),
      },
      {
        kicker: capsLine('italiana', { size: 0.028, spacing: 0.3 }),
        title: { font: 'monoton', size: 0.065, caps: true, em: 0.85 },
        sub: capsLine('italiana', { size: 0.028, spacing: 0.3, aksen: true }),
      },
    ],
  },
  {
    id: 'lembut',
    label: 'Lembut',
    noKicker: true,
    pairs: [
      {
        kicker: capsLine('quicksand'),
        title: { font: 'italianno', size: 0.13, em: 0.38 },
        sub: { font: 'quicksand', size: 0.028, weight: 500, aksen: true, em: 0.52 },
      },
      {
        kicker: capsLine('rounded'),
        title: { font: 'allura', size: 0.11, em: 0.42 },
        sub: { font: 'rounded', size: 0.028, weight: 500, aksen: true, em: 0.52 },
      },
      {
        kicker: capsLine('mulish'),
        title: { font: 'parisienne', size: 0.1, em: 0.46 },
        sub: { font: 'mulish', size: 0.028, weight: 500, aksen: true, em: 0.52 },
      },
    ],
  },
];

/** Widest a line may run, as a share of the slide. */
const MAX_LINE = 0.74;

/** A face set on some words, sized down when they would run too wide. */
function line(face: Face, text: string): Omit<TextPresetLine, 'dy'> {
  const shown = text === STUDIO_TOKEN ? 'NAMA STUDIO' : text;
  const perEm = (face.em ?? 0.55) + (face.spacing ?? 0);
  const fits = MAX_LINE / Math.max(1, shown.length * perEm);
  return {
    text,
    font: face.font,
    size: Number(Math.min(face.size, fits).toFixed(4)),
    ...(face.weight && { weight: face.weight }),
    ...(face.italic && { italic: true }),
    ...(face.spacing && { spacing: face.spacing }),
    ...(face.caps && { textCase: 'besar' as const }),
    ...(face.aksen && { tone: 'aksen' as const }),
  };
}

/** Lines stacked round the middle: each as tall as its size, a small gap between. */
function stack(lines: Omit<TextPresetLine, 'dy'>[]): TextPresetLine[] {
  const gap = 0.014;
  const heights = lines.map((l) => l.size * 1.1);
  const total = heights.reduce((a, b) => a + b, 0) + gap * (lines.length - 1);
  let y = -total / 2;
  return lines.map((l, i) => {
    const dy = y + heights[i]! / 2;
    y += heights[i]! + gap;
    return { ...l, dy: Number(dy.toFixed(4)) };
  });
}

function build(): TextPreset[] {
  const out: TextPreset[] = [];
  for (const [category, sets] of Object.entries(WORDS) as [TextPresetCategory, Words[]][]) {
    sets.forEach((w, wi) => {
      for (const mood of MOODS) {
        mood.pairs.forEach((pair, pi) => {
          const lines = [
            ...(w.kicker && !mood.noKicker ? [line(pair.kicker, w.kicker)] : []),
            line(pair.title, w.title),
            ...(w.sub ? [line(pair.sub, w.sub)] : []),
          ];
          out.push({
            id: `g-${category}-${wi}-${mood.id}-${pi}`,
            name: `${mood.label} · ${w.title}`,
            category,
            tags: [mood.label, ...(w.tags ?? [])],
            lines: stack(lines),
          });
        });
      }
    });
  }
  return out;
}

/** Built once, the first time the text panel asks. */
export const GENERATED_PRESETS: TextPreset[] = build();

/** The moods, for quick filters beside the search. */
export const PRESET_MOODS = MOODS.map((m) => m.label);
