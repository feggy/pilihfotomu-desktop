import type { TextLayer } from './document';

/**
 * Ready-made text combinations: fonts, sizes and spacing that already go
 * together, so a photographer who does not pair fonts every day still gets a
 * title that looks designed. Each line is placed relative to the group's
 * center; the words are placeholders to type over.
 */
export interface TextPresetLine {
  text: string;
  font: string;
  /** Font size as a fraction of the slide width, like `TextLayer.size`. */
  size: number;
  weight?: number;
  italic?: boolean;
  /** Letter spacing in em. */
  spacing?: number;
  textCase?: TextLayer['textCase'];
  /** 'teks' follows the background (dark on light, light on dark); 'aksen' is gold. */
  tone?: 'teks' | 'aksen';
  /** Offset from the group's center, as a fraction of the canvas height. */
  dy: number;
  /** Wrap width as a fraction of the slide width; unset for one line. */
  width?: number;
}

export type TextPresetCategory =
  | 'pernikahan'
  | 'wisuda'
  | 'ulang-tahun'
  | 'keluarga'
  | 'studio'
  | 'hari-raya'
  | 'kutipan'
  | 'editorial'
  | 'sosmed';

/** In the order "Lihat semua" lists them. */
export const PRESET_CATEGORIES: { id: TextPresetCategory; label: string }[] = [
  { id: 'pernikahan', label: 'Pernikahan' },
  { id: 'wisuda', label: 'Wisuda' },
  { id: 'ulang-tahun', label: 'Ulang tahun' },
  { id: 'keluarga', label: 'Bayi & keluarga' },
  { id: 'studio', label: 'Studio & promosi' },
  { id: 'hari-raya', label: 'Hari raya' },
  { id: 'kutipan', label: 'Kutipan' },
  { id: 'editorial', label: 'Editorial' },
  { id: 'sosmed', label: 'Media sosial' },
];

export interface TextPreset {
  id: string;
  name: string;
  category: TextPresetCategory;
  /** More words to be found by — a mood, say. */
  tags?: string[];
  lines: TextPresetLine[];
}

/** Replaced with the studio's name when the preset is added. */
export const STUDIO_TOKEN = '{studio}';

export const ACCENT_COLOR = '#c9a96e';

export const TEXT_PRESETS: TextPreset[] = [
  {
    id: 'nama-tanggal',
    name: 'Nama & tanggal',
    category: 'pernikahan',
    lines: [
      { text: 'Rani & Dimas', font: 'script', size: 0.11, weight: 400, dy: -0.025 },
      {
        text: '12 · 10 · 2026',
        font: 'cinzel',
        size: 0.03,
        spacing: 0.3,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'save-the-date',
    name: 'Save the date',
    category: 'pernikahan',
    lines: [
      { text: 'SAVE THE DATE', font: 'modern', size: 0.028, weight: 500, spacing: 0.4, dy: -0.065 },
      { text: 'Rani & Dimas', font: 'display', size: 0.085, italic: true, dy: 0 },
      { text: '12.10.2026', font: 'modern', size: 0.03, spacing: 0.25, tone: 'aksen', dy: 0.065 },
    ],
  },
  {
    id: 'prewedding',
    name: 'Prewedding',
    category: 'pernikahan',
    lines: [
      { text: 'Our Prewedding', font: 'allura', size: 0.1, dy: -0.02 },
      { text: 'RANI & DIMAS', font: 'josefin', size: 0.03, spacing: 0.35, tone: 'aksen', dy: 0.05 },
    ],
  },
  {
    id: 'wisuda',
    name: 'Wisuda',
    category: 'wisuda',
    lines: [
      { text: 'WISUDA 2026', font: 'cinzel', size: 0.07, weight: 700, spacing: 0.12, dy: -0.02 },
      {
        text: 'Nadia Putri, S.Kom.',
        font: 'serif',
        size: 0.045,
        italic: true,
        tone: 'aksen',
        dy: 0.045,
      },
    ],
  },
  {
    id: 'ulang-tahun',
    name: 'Ulang tahun',
    category: 'ulang-tahun',
    lines: [
      { text: 'Happy Birthday', font: 'dancing', size: 0.1, weight: 700, tone: 'aksen', dy: -0.02 },
      { text: 'Nadia · 17 tahun', font: 'quicksand', size: 0.034, spacing: 0.15, dy: 0.05 },
    ],
  },
  {
    id: 'editorial',
    name: 'Editorial',
    category: 'editorial',
    lines: [
      { text: 'SUMMER', font: 'bebas-neue', size: 0.17, spacing: 0.08, dy: -0.02 },
      {
        text: 'a little story of us',
        font: 'serif',
        size: 0.045,
        italic: true,
        tone: 'aksen',
        dy: 0.065,
      },
    ],
  },
  {
    id: 'kutipan',
    name: 'Kutipan',
    category: 'kutipan',
    lines: [
      {
        text: '“Cinta tidak perlu banyak kata”',
        font: 'lora',
        size: 0.05,
        italic: true,
        width: 0.8,
        dy: -0.02,
      },
      {
        text: '— RANI & DIMAS',
        font: 'modern',
        size: 0.026,
        spacing: 0.25,
        tone: 'aksen',
        dy: 0.07,
      },
    ],
  },
  {
    id: 'terima-kasih',
    name: 'Terima kasih',
    category: 'studio',
    lines: [
      { text: 'Terima kasih', font: 'parisienne', size: 0.1, dy: -0.015 },
      {
        text: STUDIO_TOKEN,
        font: 'modern',
        size: 0.026,
        spacing: 0.3,
        textCase: 'besar',
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'wedding-klasik',
    name: 'Undangan klasik',
    category: 'pernikahan',
    lines: [
      { text: 'THE WEDDING OF', font: 'tenor-sans', size: 0.026, spacing: 0.4, dy: -0.07 },
      { text: 'Rani & Dimas', font: 'mrs-saint-delafield', size: 0.12, dy: -0.005 },
      {
        text: 'SABTU, 12 OKTOBER 2026',
        font: 'tenor-sans',
        size: 0.024,
        spacing: 0.3,
        tone: 'aksen',
        dy: 0.07,
      },
    ],
  },
  {
    id: 'just-married',
    name: 'Just married',
    category: 'pernikahan',
    lines: [
      { text: 'Just Married', font: 'alex-brush', size: 0.12, tone: 'aksen', dy: -0.015 },
      { text: 'RANI · DIMAS', font: 'cinzel', size: 0.03, spacing: 0.35, dy: 0.055 },
    ],
  },
  {
    id: 'akad',
    name: 'Akad nikah',
    category: 'pernikahan',
    lines: [
      { text: 'Akad Nikah', font: 'italianno', size: 0.13, dy: -0.03 },
      { text: 'Rani & Dimas', font: 'prata', size: 0.045, dy: 0.035 },
      {
        text: '12.10.2026',
        font: 'tenor-sans',
        size: 0.024,
        spacing: 0.3,
        tone: 'aksen',
        dy: 0.08,
      },
    ],
  },
  {
    id: 'lamaran',
    name: 'Lamaran',
    category: 'pernikahan',
    lines: [
      { text: 'She said yes!', font: 'la-belle-aurore', size: 0.09, dy: -0.015 },
      {
        text: 'LAMARAN · RANI & DIMAS',
        font: 'josefin',
        size: 0.024,
        spacing: 0.3,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'inisial',
    name: 'Inisial',
    category: 'pernikahan',
    lines: [
      { text: 'R & D', font: 'gilda-display', size: 0.16, spacing: 0.05, dy: -0.02 },
      {
        text: 'EST. 2026',
        font: 'tenor-sans',
        size: 0.024,
        spacing: 0.5,
        tone: 'aksen',
        dy: 0.075,
      },
    ],
  },
  {
    id: 'love-story',
    name: 'Kisah cinta',
    category: 'pernikahan',
    lines: [
      { text: 'our love story', font: 'corinthia', size: 0.13, dy: -0.02 },
      {
        text: 'CHAPTER ONE',
        font: 'syncopate',
        size: 0.022,
        spacing: 0.4,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'resepsi',
    name: 'Resepsi',
    category: 'pernikahan',
    lines: [
      { text: 'Resepsi', font: 'bodoni-moda', size: 0.1, italic: true, dy: -0.03 },
      { text: 'Minggu, 13 Oktober 2026 · 11.00', font: 'cardo', size: 0.032, dy: 0.03 },
      {
        text: 'GEDUNG SERBAGUNA',
        font: 'lato',
        size: 0.022,
        weight: 700,
        spacing: 0.3,
        tone: 'aksen',
        dy: 0.07,
      },
    ],
  },
  {
    id: 'graduated',
    name: 'Graduated',
    category: 'wisuda',
    lines: [
      { text: 'GRADUATED', font: 'oswald', size: 0.11, weight: 600, spacing: 0.06, dy: -0.02 },
      { text: 'Class of 2026', font: 'yellowtail', size: 0.06, tone: 'aksen', dy: 0.055 },
    ],
  },
  {
    id: 'selamat-wisuda',
    name: 'Selamat wisuda',
    category: 'wisuda',
    lines: [
      { text: 'Selamat Wisuda', font: 'kaushan-script', size: 0.09, dy: -0.035 },
      { text: 'Nadia Putri, S.Ked.', font: 'lora', size: 0.04, italic: true, dy: 0.025 },
      {
        text: 'UNIVERSITAS INDONESIA',
        font: 'manrope',
        size: 0.022,
        weight: 600,
        spacing: 0.25,
        tone: 'aksen',
        dy: 0.07,
      },
    ],
  },
  {
    id: 'cum-laude',
    name: 'Cum laude',
    category: 'wisuda',
    lines: [
      {
        text: 'CUM LAUDE',
        font: 'cinzel-decorative',
        size: 0.06,
        weight: 700,
        spacing: 0.1,
        tone: 'aksen',
        dy: -0.02,
      },
      { text: 'Nadia Putri', font: 'pinyon', size: 0.07, dy: 0.04 },
    ],
  },
  {
    id: 'finally',
    name: 'Akhirnya lulus',
    category: 'wisuda',
    lines: [
      { text: 'Finally!', font: 'pacifico', size: 0.1, dy: -0.02 },
      {
        text: 'S1 · MANAJEMEN · 2026',
        font: 'figtree',
        size: 0.024,
        weight: 700,
        spacing: 0.2,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'toga',
    name: 'Toga resmi',
    category: 'wisuda',
    lines: [
      { text: 'Congratulations', font: 'libre-caslon-text', size: 0.06, italic: true, dy: -0.03 },
      { text: 'NADIA PUTRI', font: 'cinzel', size: 0.05, weight: 700, spacing: 0.15, dy: 0.025 },
      {
        text: 'WISUDA PERIODE II · 2026',
        font: 'jost',
        size: 0.02,
        weight: 500,
        spacing: 0.3,
        tone: 'aksen',
        dy: 0.07,
      },
    ],
  },
  {
    id: 'sweet-17',
    name: 'Sweet seventeen',
    category: 'ulang-tahun',
    lines: [
      { text: 'Sweet', font: 'tangerine', size: 0.12, weight: 700, dy: -0.045 },
      { text: 'SEVENTEEN', font: 'bungee', size: 0.06, tone: 'aksen', dy: 0.025 },
    ],
  },
  {
    id: 'happy-bold',
    name: 'Happy birthday tebal',
    category: 'ulang-tahun',
    lines: [
      { text: 'HAPPY', font: 'archivo-black', size: 0.1, dy: -0.05 },
      { text: 'birthday', font: 'lobster', size: 0.1, tone: 'aksen', dy: 0.03 },
    ],
  },
  {
    id: 'ultah-anak',
    name: 'Ulang tahun anak',
    category: 'ulang-tahun',
    lines: [
      { text: 'Selamat Ulang Tahun', font: 'fredoka', size: 0.06, weight: 600, dy: -0.03 },
      { text: 'Kenzo yang ke-5', font: 'chewy', size: 0.07, tone: 'aksen', dy: 0.04 },
    ],
  },
  {
    id: 'birthday-girl',
    name: 'Birthday girl',
    category: 'ulang-tahun',
    lines: [
      { text: 'birthday girl', font: 'birthstone', size: 0.11, dy: -0.02 },
      { text: '— 25 —', font: 'poiret-one', size: 0.04, spacing: 0.3, tone: 'aksen', dy: 0.05 },
    ],
  },
  {
    id: 'party',
    name: "Let's party",
    category: 'ulang-tahun',
    lines: [
      { text: "LET'S PARTY", font: 'monoton', size: 0.07, dy: -0.02 },
      {
        text: 'Sabtu, 12 Oktober · 19.00',
        font: 'outfit',
        size: 0.026,
        weight: 500,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'ultah-elegan',
    name: 'Ulang tahun elegan',
    category: 'ulang-tahun',
    lines: [
      { text: 'Thirty', font: 'gloock', size: 0.13, dy: -0.03 },
      { text: '& fabulous', font: 'style-script', size: 0.07, tone: 'aksen', dy: 0.045 },
    ],
  },
  {
    id: 'hello-world',
    name: 'Hello world',
    category: 'keluarga',
    lines: [
      { text: 'hello world', font: 'amatic-sc', size: 0.12, weight: 700, dy: -0.03 },
      {
        text: 'Aksa Pradipta · 3,2 kg',
        font: 'quicksand',
        size: 0.028,
        weight: 600,
        tone: 'aksen',
        dy: 0.04,
      },
    ],
  },
  {
    id: 'newborn',
    name: 'Bayi baru lahir',
    category: 'keluarga',
    lines: [
      { text: 'Welcome, baby', font: 'style-script', size: 0.1, dy: -0.02 },
      {
        text: 'LAHIR 12 OKTOBER 2026',
        font: 'lexend',
        size: 0.022,
        spacing: 0.25,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'keluarga',
    name: 'Keluarga kecil',
    category: 'keluarga',
    lines: [
      { text: 'Our Little Family', font: 'homemade-apple', size: 0.065, dy: -0.02 },
      {
        text: 'KELUARGA PRADIPTA',
        font: 'jost',
        size: 0.024,
        weight: 500,
        spacing: 0.35,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'maternity',
    name: 'Maternity',
    category: 'keluarga',
    lines: [
      { text: 'Menanti buah hati', font: 'ms-madi', size: 0.1, dy: -0.02 },
      {
        text: 'SEGERA · DESEMBER 2026',
        font: 'karla',
        size: 0.022,
        weight: 600,
        spacing: 0.3,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'bulan-bayi',
    name: 'Usia bayi',
    category: 'keluarga',
    lines: [
      { text: '1 BULAN', font: 'fredoka', size: 0.1, weight: 700, tone: 'aksen', dy: -0.02 },
      { text: 'si kecil Aksa', font: 'patrick-hand', size: 0.05, dy: 0.05 },
    ],
  },
  {
    id: 'lebaran-keluarga',
    name: 'Potret keluarga',
    category: 'keluarga',
    lines: [
      { text: 'Family Portrait', font: 'fraunces', size: 0.07, italic: true, dy: -0.02 },
      {
        text: 'KELUARGA BESAR HARTONO · 2026',
        font: 'figtree',
        size: 0.02,
        weight: 600,
        spacing: 0.25,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'open-booking',
    name: 'Open booking',
    category: 'studio',
    lines: [
      { text: 'OPEN BOOKING', font: 'staatliches', size: 0.1, spacing: 0.04, dy: -0.03 },
      {
        text: 'Slot terbatas · Oktober 2026',
        font: 'plus-jakarta-sans',
        size: 0.028,
        weight: 500,
        tone: 'aksen',
        dy: 0.04,
      },
    ],
  },
  {
    id: 'diskon',
    name: 'Diskon',
    category: 'studio',
    lines: [
      { text: 'DISKON', font: 'anton', size: 0.13, dy: -0.045 },
      {
        text: '30% untuk paket prewedding',
        font: 'plus-jakarta-sans',
        size: 0.03,
        weight: 600,
        tone: 'aksen',
        dy: 0.045,
      },
    ],
  },
  {
    id: 'promo-elegan',
    name: 'Promo elegan',
    category: 'studio',
    lines: [
      { text: 'Promo Akhir Tahun', font: 'gilda-display', size: 0.07, dy: -0.02 },
      {
        text: 'HEMAT HINGGA 25%',
        font: 'tenor-sans',
        size: 0.026,
        spacing: 0.35,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'bts',
    name: 'Di balik layar',
    category: 'studio',
    lines: [
      { text: 'behind the scenes', font: 'kalam', size: 0.07, dy: -0.02 },
      {
        text: STUDIO_TOKEN,
        font: 'manrope',
        size: 0.024,
        weight: 600,
        spacing: 0.3,
        textCase: 'besar',
        tone: 'aksen',
        dy: 0.045,
      },
    ],
  },
  {
    id: 'portfolio',
    name: 'Portofolio',
    category: 'studio',
    lines: [
      { text: 'PORTFOLIO', font: 'syne', size: 0.1, weight: 700, dy: -0.02 },
      {
        text: 'Prewedding · Wisuda · Keluarga',
        font: 'outfit',
        size: 0.026,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'booking-sekarang',
    name: 'Booking sekarang',
    category: 'studio',
    lines: [
      { text: 'Booking sekarang', font: 'righteous', size: 0.075, dy: -0.02 },
      {
        text: 'Klik link di bio',
        font: 'figtree',
        size: 0.03,
        weight: 500,
        tone: 'aksen',
        dy: 0.045,
      },
    ],
  },
  {
    id: 'testimoni',
    name: 'Testimoni',
    category: 'studio',
    lines: [
      {
        text: '“Hasilnya melebihi ekspektasi!”',
        font: 'fraunces',
        size: 0.05,
        italic: true,
        width: 0.8,
        dy: -0.02,
      },
      { text: '— Rani, klien prewedding', font: 'karla', size: 0.024, tone: 'aksen', dy: 0.07 },
    ],
  },
  {
    id: 'paket',
    name: 'Paket foto',
    category: 'studio',
    lines: [
      { text: 'Paket Wisuda', font: 'young-serif', size: 0.075, dy: -0.035 },
      {
        text: 'mulai Rp 750 ribu',
        font: 'dancing',
        size: 0.06,
        weight: 700,
        tone: 'aksen',
        dy: 0.02,
      },
      {
        text: '20 FOTO EDIT · 1 JAM SESI',
        font: 'lato',
        size: 0.02,
        weight: 700,
        spacing: 0.25,
        dy: 0.07,
      },
    ],
  },
  {
    id: 'idul-fitri',
    name: 'Idul Fitri',
    category: 'hari-raya',
    lines: [
      { text: 'SELAMAT HARI RAYA', font: 'cinzel', size: 0.034, spacing: 0.2, dy: -0.06 },
      { text: 'Idul Fitri', font: 'rouge-script', size: 0.13, tone: 'aksen', dy: 0.0 },
      { text: 'Mohon maaf lahir & batin', font: 'lora', size: 0.03, italic: true, dy: 0.065 },
    ],
  },
  {
    id: 'ramadan',
    name: 'Ramadan',
    category: 'hari-raya',
    lines: [
      {
        text: 'Ramadan Kareem',
        font: 'monsieur-la-doulaise',
        size: 0.11,
        tone: 'aksen',
        dy: -0.02,
      },
      { text: 'MARHABAN YA RAMADAN', font: 'tenor-sans', size: 0.024, spacing: 0.3, dy: 0.055 },
    ],
  },
  {
    id: 'natal',
    name: 'Natal',
    category: 'hari-raya',
    lines: [
      { text: 'Merry Christmas', font: 'petit-formal-script', size: 0.08, dy: -0.02 },
      {
        text: '& HAPPY NEW YEAR',
        font: 'cinzel',
        size: 0.026,
        spacing: 0.25,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'tahun-baru',
    name: 'Tahun baru',
    category: 'hari-raya',
    lines: [
      { text: '2027', font: 'dela-gothic-one', size: 0.16, dy: -0.03 },
      { text: 'Happy New Year', font: 'yellowtail', size: 0.06, tone: 'aksen', dy: 0.065 },
    ],
  },
  {
    id: 'imlek',
    name: 'Imlek',
    category: 'hari-raya',
    lines: [
      { text: 'Gong Xi Fa Cai', font: 'yeseva-one', size: 0.07, tone: 'aksen', dy: -0.02 },
      {
        text: 'SELAMAT TAHUN BARU IMLEK',
        font: 'lato',
        size: 0.022,
        weight: 700,
        spacing: 0.25,
        dy: 0.045,
      },
    ],
  },
  {
    id: 'kemerdekaan',
    name: 'Hari kemerdekaan',
    category: 'hari-raya',
    lines: [
      { text: 'DIRGAHAYU', font: 'alfa-slab-one', size: 0.09, dy: -0.03 },
      {
        text: 'Republik Indonesia ke-81',
        font: 'merriweather',
        size: 0.035,
        italic: true,
        tone: 'aksen',
        dy: 0.04,
      },
    ],
  },
  {
    id: 'kutipan-tulisan',
    name: 'Kutipan tulisan tangan',
    category: 'kutipan',
    lines: [
      { text: 'Hari ini adalah hadiah', font: 'mr-dafoe', size: 0.08, width: 0.9, dy: -0.02 },
      {
        text: '— SELALU BERSYUKUR',
        font: 'lato',
        size: 0.022,
        weight: 700,
        spacing: 0.3,
        tone: 'aksen',
        dy: 0.06,
      },
    ],
  },
  {
    id: 'kutipan-modern',
    name: 'Kutipan modern',
    category: 'kutipan',
    lines: [
      {
        text: '“Collect moments, not things.”',
        font: 'instrument-serif',
        size: 0.06,
        italic: true,
        width: 0.85,
        dy: -0.01,
      },
      {
        text: STUDIO_TOKEN,
        font: 'manrope',
        size: 0.022,
        spacing: 0.3,
        textCase: 'besar',
        tone: 'aksen',
        dy: 0.075,
      },
    ],
  },
  {
    id: 'kutipan-tangan',
    name: 'Catatan manis',
    category: 'kutipan',
    lines: [
      {
        text: 'love you to the moon & back',
        font: 'shadows-into-light',
        size: 0.06,
        width: 0.85,
        dy: -0.01,
      },
      { text: 'xoxo', font: 'indie-flower', size: 0.045, tone: 'aksen', dy: 0.07 },
    ],
  },
  {
    id: 'catatan',
    name: 'Catatan kecil',
    category: 'kutipan',
    lines: [
      { text: 'Catatan kecil untukmu', font: 'patrick-hand', size: 0.06, dy: -0.02 },
      { text: 'tetap tersenyum, ya.', font: 'kalam', size: 0.045, tone: 'aksen', dy: 0.04 },
    ],
  },
  {
    id: 'kutipan-klasik',
    name: 'Kutipan klasik',
    category: 'kutipan',
    lines: [
      {
        text: '“Dan di antara tanda-tanda kebesaran-Nya, Dia menciptakan pasangan untukmu.”',
        font: 'spectral',
        size: 0.036,
        italic: true,
        width: 0.85,
        dy: -0.02,
      },
      { text: 'AR-RUM : 21', font: 'cinzel', size: 0.022, spacing: 0.3, tone: 'aksen', dy: 0.08 },
    ],
  },
  {
    id: 'majalah-vogue',
    name: 'Sampul majalah',
    category: 'editorial',
    lines: [
      { text: 'VOGUE', font: 'bodoni-moda', size: 0.18, weight: 700, spacing: 0.02, dy: -0.035 },
      {
        text: 'THE LOVE ISSUE · NO. 12',
        font: 'tenor-sans',
        size: 0.022,
        spacing: 0.3,
        tone: 'aksen',
        dy: 0.06,
      },
    ],
  },
  {
    id: 'minimal',
    name: 'Minimalis',
    category: 'editorial',
    lines: [
      { text: 'moments', font: 'outfit', size: 0.12, weight: 300, spacing: 0.05, dy: -0.01 },
      { text: '— 2026 —', font: 'outfit', size: 0.024, spacing: 0.4, tone: 'aksen', dy: 0.06 },
    ],
  },
  {
    id: 'retro',
    name: 'Retro',
    category: 'editorial',
    lines: [
      { text: 'Good Times', font: 'lobster', size: 0.1, tone: 'aksen', dy: -0.02 },
      {
        text: 'ROLL · 01 · 36 EXP',
        font: 'space-grotesk',
        size: 0.024,
        weight: 500,
        spacing: 0.2,
        dy: 0.05,
      },
    ],
  },
  {
    id: 'stay-wild',
    name: 'Tebal bertumpuk',
    category: 'editorial',
    lines: [
      { text: 'STAY', font: 'archivo-black', size: 0.12, dy: -0.055 },
      { text: 'WILD', font: 'archivo-black', size: 0.12, tone: 'aksen', dy: 0.035 },
    ],
  },
  {
    id: 'timeless',
    name: 'Timeless',
    category: 'editorial',
    lines: [
      { text: 'Timeless', font: 'young-serif', size: 0.11, dy: -0.02 },
      {
        text: 'a portrait session',
        font: 'serif',
        size: 0.045,
        italic: true,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'issue',
    name: 'Edisi',
    category: 'editorial',
    lines: [
      { text: 'Issue 07', font: 'gloock', size: 0.09, dy: -0.02 },
      {
        text: 'CERITA TENTANG KITA',
        font: 'jost',
        size: 0.024,
        weight: 500,
        spacing: 0.35,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'scene',
    name: 'Adegan film',
    category: 'editorial',
    lines: [
      { text: 'SCENE 01', font: 'rubik-mono-one', size: 0.06, dy: -0.02 },
      {
        text: 'take one · Rani & Dimas',
        font: 'space-grotesk',
        size: 0.028,
        tone: 'aksen',
        dy: 0.04,
      },
    ],
  },
  {
    id: 'art-deco',
    name: 'Art deco',
    category: 'editorial',
    lines: [
      { text: 'Gatsby Night', font: 'limelight', size: 0.08, dy: -0.02 },
      {
        text: 'THE ROARING TWENTIES',
        font: 'poiret-one',
        size: 0.026,
        spacing: 0.3,
        tone: 'aksen',
        dy: 0.05,
      },
    ],
  },
  {
    id: 'geser',
    name: 'Geser',
    category: 'sosmed',
    lines: [
      { text: 'Geser →', font: 'plus-jakarta-sans', size: 0.07, weight: 700, dy: -0.015 },
      {
        text: 'untuk melihat lebih banyak',
        font: 'plus-jakarta-sans',
        size: 0.026,
        tone: 'aksen',
        dy: 0.04,
      },
    ],
  },
  {
    id: 'coming-soon',
    name: 'Segera hadir',
    category: 'sosmed',
    lines: [
      { text: 'COMING SOON', font: 'unica-one', size: 0.08, spacing: 0.1, dy: -0.02 },
      { text: 'nantikan, ya!', font: 'kaushan-script', size: 0.05, tone: 'aksen', dy: 0.05 },
    ],
  },
  {
    id: 'new-post',
    name: 'Postingan baru',
    category: 'sosmed',
    lines: [
      { text: 'NEW', font: 'syncopate', size: 0.08, weight: 700, spacing: 0.2, dy: -0.035 },
      { text: 'post alert', font: 'pacifico', size: 0.06, tone: 'aksen', dy: 0.035 },
    ],
  },
  {
    id: 'giveaway',
    name: 'Giveaway',
    category: 'sosmed',
    lines: [
      { text: 'GIVEAWAY', font: 'bungee', size: 0.09, tone: 'aksen', dy: -0.02 },
      { text: 'Ikuti syarat di caption', font: 'lexend', size: 0.026, dy: 0.05 },
    ],
  },
  {
    id: 'polling',
    name: 'Tanya pengikut',
    category: 'sosmed',
    lines: [
      { text: 'Tim mana kamu?', font: 'fredoka', size: 0.07, weight: 600, dy: -0.025 },
      {
        text: 'Prewedding outdoor atau studio',
        font: 'figtree',
        size: 0.026,
        tone: 'aksen',
        width: 0.9,
        dy: 0.04,
      },
    ],
  },
  {
    id: 'photo-dump',
    name: 'Photo dump',
    category: 'sosmed',
    lines: [
      { text: 'photo dump', font: 'amatic-sc', size: 0.12, weight: 700, dy: -0.02 },
      { text: 'Oktober 2026', font: 'la-belle-aurore', size: 0.05, tone: 'aksen', dy: 0.05 },
    ],
  },
];
