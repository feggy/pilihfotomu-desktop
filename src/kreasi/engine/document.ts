import type { DriveFile } from './types';
import {
  TEMPLATES,
  carouselPattern,
  carouselTemplateId,
  carouselTemplates,
  type CollageTemplate,
  type Frame,
} from './templates';
import { cellsFit } from './layout-generator';

/**
 * Everything the photographer builds in the collage editor, in one plain
 * object: undo/redo keeps copies of it, the draft stores it, and the renderer
 * draws it. Images are not in here — only which file goes where.
 *
 * Sizes are fractions of one slide's width ("unit"), so a value means the same
 * on a 4:5 post, a 9:16 story, or one slide of a carousel.
 */

export type FormatId =
  | 'feed'
  | 'story'
  | 'square'
  | 'carousel'
  | 'cetak-4r'
  | 'cetak-5r'
  | 'cetak-10r'
  | 'a4'
  /** The photo's own shape (`CollageDoc.photoRatio`): a design started from a photo. */
  | 'foto';

export const FORMATS: Record<
  FormatId,
  {
    label: string;
    hint: string;
    ratio: number;
    /** A print size: its width in inches (portrait), for 300 dpi files and PDF pages. */
    printInches?: number;
  }
> = {
  feed: { label: 'Feed 4:5', hint: 'Postingan Instagram', ratio: 5 / 4 },
  story: { label: 'Story 9:16', hint: 'Story & Reels', ratio: 16 / 9 },
  square: { label: 'Kotak 1:1', hint: 'Postingan persegi', ratio: 1 },
  carousel: { label: 'Carousel', hint: 'Beberapa slide 4:5 yang tersambung', ratio: 5 / 4 },
  'cetak-4r': { label: 'Cetak 4R', hint: '4 × 6 inci (10 × 15 cm)', ratio: 6 / 4, printInches: 4 },
  'cetak-5r': { label: 'Cetak 5R', hint: '5 × 7 inci (13 × 18 cm)', ratio: 7 / 5, printInches: 5 },
  'cetak-10r': {
    label: 'Cetak 10R',
    hint: '8 × 10 inci (20 × 25 cm)',
    ratio: 10 / 8,
    printInches: 8,
  },
  a4: {
    label: 'A4',
    hint: '21 × 29,7 cm — album & dokumen',
    ratio: 297 / 210,
    printInches: 210 / 25.4,
  },
  // Its shape is the photo's, kept on the design (see `formatRatio`).
  foto: { label: 'Sesuai foto', hint: 'Bingkai mengikuti ukuran foto', ratio: 1 },
};

/** A slide's width in the exported file: 1080 px for Instagram, 300 dpi for a print size. */
export const slidePixels = (doc: Pick<CollageDoc, 'format'>) => {
  const inches = FORMATS[doc.format].printInches;
  return inches ? Math.round(inches * 300) : 1080;
};

/** Height ÷ width of one slide: the format's, or the photo's own for a design started from one. */
export const formatRatio = (d: Pick<CollageDoc, 'format'> & { photoRatio?: number }) =>
  d.format === 'foto' ? (d.photoRatio ?? 1) : FORMATS[d.format].ratio;

/** A shape as people say it: "3:2", "4:5" — or, when it is no plain one, "1,34:1". */
export function ratioName(ratio: number): string {
  for (const [w, h] of [
    [1, 1],
    [4, 5],
    [5, 4],
    [2, 3],
    [3, 2],
    [3, 4],
    [4, 3],
    [9, 16],
    [16, 9],
    [5, 7],
    [7, 5],
  ] as const) {
    if (Math.abs(h / w - ratio) < 0.01) return `${w}:${h}`;
  }
  return ratio >= 1
    ? `1:${(Math.round(ratio * 100) / 100).toLocaleString('id-ID')}`
    : `${(Math.round((1 / ratio) * 100) / 100).toLocaleString('id-ID')}:1`;
}

/** What a design's size is called: its format — or "Sesuai foto 3:2". */
export const formatName = (d: Pick<CollageDoc, 'format' | 'slides'> & { photoRatio?: number }) =>
  d.format === 'carousel'
    ? `Carousel ${d.slides} slide`
    : d.format === 'foto'
      ? `Sesuai foto ${ratioName(formatRatio(d))}`
      : FORMATS[d.format].label;

/** A format made for printing rather than Instagram. */
export const isPrintFormat = (format: FormatId) => Boolean(FORMATS[format].printInches);

/** Carousel length the editor offers; Instagram itself allows up to 20. */
export const MIN_SLIDES = 2;
export const MAX_SLIDES = 10;

/** The "arrange it yourself" layout: photos placed freely, like stickers. */
export const FREE_LAYOUT_ID = 'bebas';

/** A shape a photo can be cut to, instead of its rounded rectangle. */
export type PhotoMask =
  'lingkaran' | 'lengkung' | 'hati' | 'bintang' | 'segi-enam' | 'belah-ketupat';

/**
 * One photo placed in a cell. `ox`/`oy` pan within the overflow, -1…1;
 * `rotate` is any angle in degrees — the photo is scaled so it still covers
 * the whole cell when turned.
 */
export interface Slot {
  file: DriveFile;
  /** Cut to a shape; unset keeps the (rounded) rectangle. */
  mask?: PhotoMask;
  /** 0–1, the photo with its line and frame; unset is fully opaque. */
  opacity?: number;
  zoom: number;
  ox: number;
  oy: number;
  rotate: number;
  flip: boolean;
  /**
   * This photo's own corners, as a share of its short side (0.5 = fully round).
   * Unset: it follows the collage's "Sudut foto".
   */
  radius?: number | null;
  /** Color adjustments; unset is the photo as it is. */
  adjust?: PhotoAdjust;
  /** A line around this photo; width as a fraction of the slide width. */
  stroke?: PhotoStroke | null;
  /**
   * Framed layouts: this photo's own frame thickness (0 = none, the photo fills
   * its frame), instead of the collage's "Tebal bingkai". Unset follows the collage.
   */
  frame?: number | null;
  /**
   * How much of its cell the photo takes (0.3–1), shrunk around the middle so
   * the background shows around it. Unset fills the cell.
   */
  scale?: number;
  /** The photo melting away towards one side (or its edges), into what is under it. */
  fade?: PhotoFade;
  /** A soft shadow under the photo's shape — a print lying on the page. */
  shadow?: DropShadow;
}

/**
 * A photo's fade: solid until `start` along the way (0–1), gone by `end`.
 * `linear` runs at `angle` (0° fades out downwards, 90° to the right);
 * `radial` keeps the middle and fades out to the edges.
 */
export interface PhotoFade {
  type: 'linear' | 'radial';
  angle: number;
  start: number;
  end: number;
}

/**
 * A photo place kept for its look — shape, line, fade, shadow — with no photo
 * in it yet: what a shared template has where the author's photos were. It
 * counts as empty; a photo put there takes its look (see `refill`).
 */
export const EMPTY_PHOTO_PREFIX = 'kosong-';
export const isEmptyPhoto = (slot: Slot | null | undefined) =>
  !slot || slot.file.fileId.startsWith(EMPTY_PHOTO_PREFIX);
export function emptyPhotoFile(n: number): DriveFile {
  return {
    id: `${EMPTY_PHOTO_PREFIX}${n}`,
    fileId: `${EMPTY_PHOTO_PREFIX}${n}`,
    fileName: `Foto ${n}`,
    fileNumber: null,
    thumbnailUrl: null,
    previewUrl: null,
    webViewUrl: null,
    downloadUrl: null,
    order: 0,
  };
}

/** A point on a tone curve: input and output, 0–1. */
export type CurvePoint = [number, number];

/**
 * Kurva titik: the RGB curve, then each channel's own. Each runs from x 0 to
 * x 1 in order; unset (or the straight line) leaves the photo as it is.
 */
export interface ToneCurve {
  rgb?: CurvePoint[];
  r?: CurvePoint[];
  g?: CurvePoint[];
  b?: CurvePoint[];
}

/** Pencampuran warna: the eight ranges of hue, as in a photo editor. */
export const COLOR_BANDS = [
  { id: 'merah', label: 'Red', hue: 0, swatch: '#e5484d' },
  { id: 'oranye', label: 'Orange', hue: 30, swatch: '#f08c2e' },
  { id: 'kuning', label: 'Yellow', hue: 60, swatch: '#f5d90a' },
  { id: 'hijau', label: 'Green', hue: 120, swatch: '#46a758' },
  { id: 'aqua', label: 'Aqua', hue: 180, swatch: '#2ebfbf' },
  { id: 'biru', label: 'Blue', hue: 225, swatch: '#3e63dd' },
  { id: 'ungu', label: 'Purple', hue: 275, swatch: '#8e4ec6' },
  { id: 'magenta', label: 'Magenta', hue: 320, swatch: '#d6409f' },
] as const;
export type ColorBand = (typeof COLOR_BANDS)[number]['id'];

/** One range's shift: hue, saturation and luminance, each −100…100. */
export interface HslShift {
  h: number;
  s: number;
  l: number;
}

/** A color grading wheel: the tint's hue (0–360°) and strength (0–100), and a brightness −100…100. */
export interface GradeWheel {
  hue: number;
  sat: number;
  lum: number;
}

/** Color grading: a tint for the shadows, midtones and highlights, and one over all. */
export interface ColorGrade {
  shadows?: GradeWheel;
  midtones?: GradeWheel;
  highlights?: GradeWheel;
  global?: GradeWheel;
  /** How far the three ranges reach into each other, 0–100; unset 50. */
  blending?: number;
  /** Where shadows end and highlights begin, −100…100; unset 0. */
  balance?: number;
}

/** One sweep of a mask's brush: along its points (fractions of the picture), wide, soft. */
export interface BrushStroke {
  /** Takes the mask away instead of adding to it. */
  erase?: boolean;
  /** Width, a share of the picture's width. */
  size: number;
  /** Softness of its edge, 0–100. */
  feather: number;
  points: [number, number][];
}

/** What a mask changes where it covers, each −100…100 around 0. */
export interface LocalAdjust {
  exposure?: number;
  contrast?: number;
  highlights?: number;
  shadows?: number;
  temp?: number;
  tint?: number;
  saturation?: number;
  clarity?: number;
  dehaze?: number;
  texture?: number;
  whites?: number;
  blacks?: number;
  /** −100 softer … 100 sharper. */
  sharpness?: number;
  /** 0–100: less noise. */
  noise?: number;
}

export type MaskKind =
  'subject' | 'background' | 'brush' | 'linear' | 'radial' | 'color' | 'luminance';

/**
 * One part of a mask: a shape, what was found in the photo, or a range of its
 * colors or brightness — added to the parts before it, or taken away from them.
 * Positions are shares (0–1) of the whole picture, so they hold at any size.
 */
export interface MaskPart {
  id: string;
  kind: MaskKind;
  /** Taken away from the parts before it (Kurangi) instead of added. */
  subtract?: boolean;
  /** The other part instead. */
  invert?: boolean;
  /** Linear: all of it at (x0, y0), none of it at (x1, y1). */
  x0?: number;
  y0?: number;
  x1?: number;
  y1?: number;
  /** Radial: the middle, and the half-width and half-height; feather 0–100. */
  cx?: number;
  cy?: number;
  rx?: number;
  ry?: number;
  /** Linear or radial not drawn yet (waiting for its drag on the photo): it covers nothing. */
  unplaced?: boolean;
  /** Radial: turned this many degrees (clockwise, in the picture); unset 0. */
  angle?: number;
  feather?: number;
  /** Brush: its sweeps, in order. */
  strokes?: BrushStroke[];
  /** Subject or background: the subject worked out once, kept in this browser by id. */
  subject?: string;
  /** Color range: the colors picked from the photo (sRGB 0–255), at most MAX_RANGE_COLORS. */
  colors?: [number, number, number][];
  /** Color range: how far round them it reaches, 0–100; unset 50. */
  range?: number;
  /** Luminance range: from and to, 0 (black) … 100 (white). */
  lumLo?: number;
  lumHi?: number;
  /** Luminance range: how softly it fades out past them, 0–100; unset 30. */
  smooth?: number;
}

/**
 * Masking: a part of the photo edited on its own, as in a photo editor — made
 * of parts, each added or taken away, in order.
 */
export interface EditMask {
  id: string;
  parts: MaskPart[];
  /** Switched off with its eye: kept, not shown. */
  hidden?: boolean;
  adjust: LocalAdjust;
}

/** At most this many masks on a photo, parts in a mask, and colors in a color range. */
export const MAX_MASKS = 8;
export const MAX_MASK_PARTS = 8;
export const MAX_RANGE_COLORS = 5;

/**
 * A mask's parts. A mask saved before masks had parts was one shape itself:
 * it reads as that one part.
 */
export function maskParts(m: EditMask): MaskPart[] {
  if (Array.isArray(m.parts)) return m.parts;
  const old = m as unknown as MaskPart & { adjust?: unknown };
  if (!old.kind) return [];
  const part: MaskPart & { adjust?: unknown; hidden?: unknown } = { ...old };
  delete part.adjust;
  delete part.hidden;
  return [part];
}

/** Whether a mask changes anything (and is on, and covers something). */
export const maskActive = (m: EditMask) =>
  !m.hidden &&
  maskParts(m).some((p) => !p.subtract) &&
  Object.values(m.adjust).some((v) => typeof v === 'number' && v !== 0);

/** A darkening (or lightening) round the edges of the photo as shown. */
export interface Vignette {
  /** −100 darker … 100 lighter. */
  amount: number;
  /** How far in it starts, 0–100; unset 50. */
  midpoint?: number;
  /** −100 squarer … 100 rounder; unset 0 (follows the photo's shape). */
  roundness?: number;
  /** How soft its edge is, 0–100; unset 50. */
  feather?: number;
}

/**
 * How one photo (or picture element) is developed, like a photo editor:
 * light, color, effects and detail. Each number is −100…100 around 0
 * (unchanged) unless said otherwise; everything after `grain` is optional
 * and unset means untouched, so older designs read as they always did.
 */
export interface PhotoAdjust {
  /** Eksposur: the whole photo lighter or darker. */
  brightness: number;
  contrast: number;
  saturation: number;
  /** Suhu: positive warmer (yellow-orange), negative cooler (blue). */
  warmth: number;
  /** A matte look: blacks lifted towards grey, 0–100. */
  fade: number;
  /** Black and white. */
  mono: boolean;
  /** Soft focus, 0–100 — a photo turned background. Unset: sharp. */
  blur?: number;
  /** Film grain, 0–100. Unset: none. */
  grain?: number;
  /** Grain size and roughness, 0–100; unset 25 and 50. */
  grainSize?: number;
  grainRough?: number;
  // ── Cahaya ──
  highlights?: number;
  shadows?: number;
  whites?: number;
  blacks?: number;
  curve?: ToneCurve;
  // ── Warna ──
  /** Tint: positive magenta, negative green. */
  tint?: number;
  /** Saturation that spares colors already strong, and skin. */
  vibrance?: number;
  hsl?: Partial<Record<ColorBand, HslShift>>;
  grade?: ColorGrade;
  /**
   * A LUT (.cube) imported in this browser, by id (see lut-store), and how
   * strongly, 0–100 (unset 100). Where it is missing the photo shows without it.
   */
  lut?: { id: string; name: string; amount?: number };
  /** Masking: parts of the photo with edits of their own. */
  masks?: EditMask[];
  // ── Efek ──
  /** Fine detail (skin, fabric) stronger or smoother. */
  texture?: number;
  /** Midtone contrast: punchier or softer. */
  clarity?: number;
  /** Kabut: haze taken away, or added. */
  dehaze?: number;
  vignette?: Vignette;
  // ── Detail ──
  /** Penajaman, 0–100, and its radius, 0–100 (unset 30). */
  sharpen?: number;
  sharpenRadius?: number;
  /** Sharpening: fine texture let through, 0–100 (unset 25); only on edges, 0–100 (unset 0). */
  sharpenDetail?: number;
  sharpenMasking?: number;
  /** Pengurangan noise, 0–100: of brightness, and of color. */
  noise?: number;
  colorNoise?: number;
  /**
   * AI Denoise: the photo cleaned by AI, kept in this browser by id (see
   * lut-store), mixed in at `amount` 0–100 (unset 100). Where it is missing the
   * photo shows as it came.
   */
  denoise?: {
    id: string;
    amount?: number;
    /** A RAW's white balance it was made at (`kelvin/tint`); at another, it is set aside. */
    wb?: string;
  };
  /**
   * A camera RAW's white balance, in Kelvin and tint (−150…150) — for a
   * picture uploaded as RAW (its id). Unset: as the camera shot it.
   */
  raw?: { id: string; kelvin: number; tint: number };
  /** Luminance noise: texture kept, 0–100 (unset 50); contrast given back, 0–100 (unset 0). */
  noiseDetail?: number;
  noiseContrast?: number;
  /** Color noise: color edges kept, 0–100 (unset 50); how wide it evens out, 0–100 (unset 50). */
  colorNoiseDetail?: number;
  colorNoiseSmooth?: number;
  /** Groups switched off with their eye — kept, not shown (nor downloaded). */
  hidden?: AdjustGroup[];
}

/**
 * Edit's groups, as Lightroom Classic has them, each with an eye to switch it
 * off and compare: Basic (white balance, tone, presence), Tone Curve, Color
 * (mixer, grading, LUT), Detail, Effects. `cahaya` is the older Light group,
 * still in designs saved before: read as Basic and Tone Curve.
 */
export type AdjustGroup = 'dasar' | 'kurva' | 'warna' | 'detail' | 'efek' | 'cahaya';

/** Which group of Edit each setting is in (Lightroom's panels). */
export const ADJUST_GROUP_OF: Partial<Record<keyof PhotoAdjust, AdjustGroup>> = {
  raw: 'dasar',
  warmth: 'dasar',
  tint: 'dasar',
  mono: 'dasar',
  brightness: 'dasar',
  contrast: 'dasar',
  highlights: 'dasar',
  shadows: 'dasar',
  whites: 'dasar',
  blacks: 'dasar',
  texture: 'dasar',
  clarity: 'dasar',
  dehaze: 'dasar',
  vibrance: 'dasar',
  saturation: 'dasar',
  curve: 'kurva',
  hsl: 'warna',
  grade: 'warna',
  lut: 'warna',
  denoise: 'detail',
  sharpen: 'detail',
  sharpenRadius: 'detail',
  sharpenDetail: 'detail',
  sharpenMasking: 'detail',
  noise: 'detail',
  noiseDetail: 'detail',
  noiseContrast: 'detail',
  colorNoise: 'detail',
  colorNoiseDetail: 'detail',
  colorNoiseSmooth: 'detail',
  vignette: 'efek',
  grain: 'efek',
  grainSize: 'efek',
  grainRough: 'efek',
  fade: 'efek',
  blur: 'efek',
};

/** The groups Sinkronkan offers, in Edit's order. */
export const SYNC_GROUPS: { id: Exclude<AdjustGroup, 'cahaya'>; label: string; detail: string }[] =
  [
    { id: 'dasar', label: 'Basic', detail: 'WB, Exposure, Tone, Presence, Black & White' },
    { id: 'kurva', label: 'Tone Curve', detail: 'Kurva RGB dan per warna' },
    { id: 'warna', label: 'Color', detail: 'Color Mixer, Color Grading, LUT' },
    { id: 'detail', label: 'Detail', detail: 'Sharpening, Noise Reduction (bukan AI Denoise)' },
    { id: 'efek', label: 'Effects', detail: 'Vignette, Grain, Fade, Blur' },
  ];

/**
 * Sinkronkan, as Lightroom's Sync: `target` with the settings of the groups
 * asked taken from `source`, the rest its own. What was made from the photo
 * itself stays: its masks, AI Denoise and RAW file. A RAW's white balance
 * (Kelvin, tint) goes from a RAW to another RAW, As Shot included.
 */
export function syncAdjust(
  source: PhotoAdjust | undefined,
  target: PhotoAdjust | undefined,
  groups: ReadonlySet<AdjustGroup>,
  raws: {
    /** The source photo came from a RAW. */
    source: boolean;
    /** The target photo's RAW id, if it came from one. */
    target: string | null;
  },
): PhotoAdjust {
  const from = source ?? NO_ADJUST;
  const out: Record<string, unknown> = { ...NO_ADJUST, ...target };
  for (const [key, group] of Object.entries(ADJUST_GROUP_OF)) {
    if (!groups.has(group) || key === 'denoise' || key === 'raw') continue;
    const v = from[key as keyof PhotoAdjust];
    if (v === undefined) delete out[key];
    else out[key] = v;
  }
  if (groups.has('dasar') && raws.source && raws.target) {
    out.raw = from.raw ? { ...from.raw, id: raws.target } : undefined;
  }
  // A group switched off with its eye stays off (or on) as on the source.
  const hidden = [
    ...(target?.hidden ?? []).filter((g) => !groups.has(g)),
    ...(from.hidden ?? []).filter((g) => groups.has(g)),
  ];
  out.hidden = hidden.length ? hidden : undefined;
  return out as unknown as PhotoAdjust;
}

/**
 * The settings as they show: the groups switched off with their eye taken
 * out (kept in the design, so switching the eye back brings them back).
 */
export function shownAdjust(a: PhotoAdjust | undefined): PhotoAdjust | undefined {
  if (!a?.hidden?.length) return a;
  const off = new Set(a.hidden);
  if (off.has('cahaya')) {
    off.add('dasar');
    off.add('kurva');
  }
  const out: PhotoAdjust = { ...a, hidden: undefined };
  if (off.has('dasar')) {
    Object.assign(out, { brightness: 0, contrast: 0, warmth: 0, saturation: 0, mono: false });
    delete out.raw;
    delete out.tint;
    delete out.highlights;
    delete out.shadows;
    delete out.whites;
    delete out.blacks;
    delete out.texture;
    delete out.clarity;
    delete out.dehaze;
    delete out.vibrance;
  }
  if (off.has('kurva')) delete out.curve;
  if (off.has('warna')) {
    delete out.hsl;
    delete out.grade;
    delete out.lut;
  }
  if (off.has('efek')) {
    Object.assign(out, { fade: 0 });
    delete out.vignette;
    delete out.grain;
    delete out.blur;
  }
  if (off.has('detail')) {
    delete out.denoise;
    delete out.sharpen;
    delete out.noise;
    delete out.colorNoise;
  }
  return out;
}

/** A soft shadow under an element or photo: offsets and blur as fractions of the slide width. */
export interface DropShadow {
  color: string;
  /** 0–1. */
  alpha: number;
  blur: number;
  x: number;
  y: number;
}

export interface PhotoStroke {
  width: number;
  color: string;
}

export const NO_ADJUST: PhotoAdjust = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  warmth: 0,
  fade: 0,
  mono: false,
};

/** Ready-made looks, a tap each. */
export const ADJUST_PRESETS: { id: string; name: string; adjust: PhotoAdjust }[] = [
  { id: 'asli', name: 'Asli', adjust: NO_ADJUST },
  {
    id: 'cerah',
    name: 'Cerah',
    adjust: { ...NO_ADJUST, brightness: 12, contrast: 6, saturation: 8 },
  },
  { id: 'hangat', name: 'Hangat', adjust: { ...NO_ADJUST, warmth: 35, saturation: 6 } },
  { id: 'sejuk', name: 'Sejuk', adjust: { ...NO_ADJUST, warmth: -32, brightness: 4 } },
  {
    id: 'pudar',
    name: 'Pudar',
    adjust: { ...NO_ADJUST, contrast: -14, saturation: -12, fade: 32 },
  },
  { id: 'kontras', name: 'Kontras', adjust: { ...NO_ADJUST, contrast: 26, saturation: 10 } },
  { id: 'klasik', name: 'Klasik', adjust: { ...NO_ADJUST, warmth: 28, saturation: -22, fade: 22 } },
  { id: 'hitam-putih', name: 'Hitam putih', adjust: { ...NO_ADJUST, contrast: 12, mono: true } },
  {
    id: 'film',
    name: 'Film',
    adjust: {
      ...NO_ADJUST,
      warmth: 12,
      saturation: -12,
      contrast: 6,
      fade: 12,
      grain: 30,
      curve: {
        rgb: [
          [0, 0.07],
          [0.25, 0.22],
          [0.75, 0.8],
          [1, 0.95],
        ],
      },
    },
  },
  {
    id: 'teal-oranye',
    name: 'Teal & oranye',
    adjust: {
      ...NO_ADJUST,
      contrast: 10,
      vibrance: 14,
      grade: {
        shadows: { hue: 190, sat: 45, lum: 0 },
        highlights: { hue: 32, sat: 38, lum: 0 },
        blending: 60,
      },
    },
  },
  {
    id: 'moody',
    name: 'Moody',
    adjust: {
      ...NO_ADJUST,
      brightness: -6,
      contrast: 14,
      saturation: -22,
      highlights: -35,
      shadows: -10,
      clarity: 18,
      grade: { shadows: { hue: 215, sat: 28, lum: -8 } },
      vignette: { amount: -35 },
    },
  },
  {
    id: 'lembut',
    name: 'Lembut',
    adjust: {
      ...NO_ADJUST,
      brightness: 6,
      contrast: -12,
      warmth: 6,
      shadows: 35,
      whites: 12,
      vibrance: 12,
      clarity: -12,
    },
  },
];

/** Whether a curve bends at all: unset, or only the straight line from 0 to 1, does not. */
export const curveBends = (points: CurvePoint[] | undefined) =>
  Boolean(points) && points!.some(([x, y]) => Math.abs(x - y) > 0.002);

export const isAdjusted = (a: PhotoAdjust | undefined) =>
  Boolean(a) &&
  (a!.mono ||
    a!.brightness !== 0 ||
    a!.contrast !== 0 ||
    a!.saturation !== 0 ||
    a!.warmth !== 0 ||
    Boolean(a!.blur) ||
    Boolean(a!.grain) ||
    a!.fade !== 0 ||
    Boolean(
      a!.highlights ||
      a!.shadows ||
      a!.whites ||
      a!.blacks ||
      a!.tint ||
      a!.vibrance ||
      a!.texture ||
      a!.clarity ||
      a!.dehaze ||
      a!.sharpen ||
      a!.noise ||
      a!.colorNoise ||
      a!.vignette?.amount,
    ) ||
    Boolean(a!.lut && (a!.lut.amount ?? 100) > 0) ||
    Boolean(a!.masks?.some(maskActive)) ||
    Boolean(a!.denoise && (a!.denoise.amount ?? 100) > 0) ||
    Boolean(a!.raw) ||
    (['rgb', 'r', 'g', 'b'] as const).some((k) => curveBends(a!.curve?.[k])) ||
    Object.values(a!.hsl ?? {}).some((v) => v && (v.h || v.s || v.l)) ||
    [a!.grade?.shadows, a!.grade?.midtones, a!.grade?.highlights, a!.grade?.global].some(
      (w) => w && (w.sat || w.lum),
    ));

export interface CollageStyle {
  gap: number;
  padding: number;
  radius: number;
  background: string;
  /** Frame thickness multiplier for framed layouts; 1 is the default look. */
  frame: number;
  /** How much of its cell every photo takes (0.3–1); unset fills the cell. */
  scale?: number;
}

export interface BackdropStyle {
  tint: number;
  blur: number;
  /** A CSS filter from BACKDROP_FILTERS; empty for the original look. */
  filter: string;
  /**
   * Where the image sits, like a photo in its cell: zoom ≥ 1, pan −1…1 along
   * each axis, tilt in degrees, mirrored. Unset: centered, covering, straight.
   */
  zoom?: number;
  ox?: number;
  oy?: number;
  rotate?: number;
  flip?: boolean;
  /** A gradient over the background color (under any background image). */
  gradient?: Gradient;
}

/** One carousel slide's own background, used when backgrounds are set per slide. */
export interface SlideBackground extends BackdropStyle {
  color: string;
}

/**
 * A freely placed photo frame (the "Tata sendiri" layout): position and size as
 * fractions of the whole canvas, like a template cell, plus its own tilt.
 */
export interface FreeCell {
  /** Stable id, so the frame keeps its place in the layer order. */
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotate: number;
}

/** A built-in font id from the font catalog, or `local:<family>` for an installed font. */
export type FontId = string;

export interface TextLayer {
  id: string;
  text: string;
  /** 0–1; unset is fully opaque. */
  opacity?: number;
  /** A line round the letters, drawn behind their fill; `width` in em. */
  outline?: { width: number; color: string };
  /** Bends the text along an arc: -1 (a smile) to 1 (an arch); unset is straight. */
  curve?: number;
  /** Tilt in degrees, turned around its middle; unset is level. */
  rotate?: number;
  /** Space from one line to the next, in em; unset is 1.15. */
  lineHeight?: number;
  /** The letters filled with a gradient, across the whole text, instead of `color`. */
  fill?: Gradient;
  /**
   * A box behind the text. `padding` in em; `radius` a share of the box's
   * height, so 0.5 makes a pill.
   */
  background?: { color: string; opacity: number; padding: number; radius: number };
  font: FontId;
  /** Font size as a fraction of the slide width. */
  size: number;
  /** CSS font weight: 400 regular … 700 bold. */
  weight: number;
  italic: boolean;
  color: string;
  /** How lines sit inside the text box. */
  align: 'left' | 'center' | 'right';
  /**
   * Box width as a fraction of the slide width; lines wrap to fit. `null`
   * means the box hugs its longest line (nothing wraps).
   */
  width: number | null;
  /** Center of the text box, as fractions of the whole canvas. */
  x: number;
  y: number;
  /** How letters are cased when drawn; the typed text is kept as typed. */
  textCase: TextCase;
  /** Letter spacing in em; wide spacing on capitals gives the "W I S U D A" look. */
  spacing: number;
  /** A shadow keeps text readable over a busy photo. */
  shadow: TextShadow;
}

/**
 * `asli` as typed · `besar` ALL CAPS · `kecil` all lowercase · `kata` Each Word
 * Capitalized (the rest of each word left as typed — the same as CSS
 * `capitalize`, so typing on the canvas looks identical).
 */
export type TextCase = 'asli' | 'besar' | 'kecil' | 'kata';

/** Applies a text case to a string. */
export function applyCase(text: string, textCase: TextCase): string {
  switch (textCase) {
    case 'besar':
      return text.toUpperCase();
    case 'kecil':
      return text.toLowerCase();
    case 'kata':
      return text.replace(
        /(^|\s)(\S)/g,
        (_, space: string, ch: string) => space + ch.toUpperCase(),
      );
    default:
      return text;
  }
}

export interface TextShadow {
  on: boolean;
  color: string;
  /** Blur radius, in em of the text size. */
  blur: number;
  /** How far the shadow falls below the text, in em. */
  distance: number;
  opacity: number;
}

export const DEFAULT_SHADOW: TextShadow = {
  on: false,
  color: '#000000',
  blur: 0.35,
  distance: 0.05,
  opacity: 0.45,
};

/** A `#rrggbb` color at an opacity, as `rgba(…)`. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Blend modes an element can mix with what is under it, as the canvas names them. */
export type BlendMode =
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'color'
  | 'luminosity'
  | 'darken'
  | 'lighten';

/** The blend modes offered, with what each does in a word — Photoshop's names stay. */
export const BLEND_MODES: { id: BlendMode | null; label: string; hint: string }[] = [
  { id: null, label: 'Normal', hint: 'Tanpa campuran' },
  { id: 'multiply', label: 'Multiply', hint: 'Menggelapkan, menyatu' },
  { id: 'screen', label: 'Screen', hint: 'Menerangkan' },
  { id: 'overlay', label: 'Overlay', hint: 'Warna lebih hidup' },
  { id: 'soft-light', label: 'Soft light', hint: 'Mewarnai lembut' },
  { id: 'hard-light', label: 'Hard light', hint: 'Mewarnai kuat' },
  { id: 'color', label: 'Color', hint: 'Hanya warnanya' },
  { id: 'luminosity', label: 'Luminosity', hint: 'Hanya terang-gelapnya' },
  { id: 'darken', label: 'Darken', hint: 'Ambil yang lebih gelap' },
  { id: 'lighten', label: 'Lighten', hint: 'Ambil yang lebih terang' },
];

/** A color of a gradient, with how solid it is (0 see-through, 1 solid). */
export interface GradientColor {
  color: string;
  alpha: number;
}

/** A color placed along a gradient, `at` 0–1 from its start. */
export interface GradientStopDef extends GradientColor {
  at: number;
}

/**
 * A fill that fades between colors. Any number of colors (`stops`); older
 * gradients have just `from`, an optional `mid` and `to`, spread between
 * `start` and `end` — `stopsOf` reads both.
 */
export interface Gradient {
  /**
   * `linear` runs one way; `reflected` runs out from its middle both ways
   * (dark–light–dark); `radial` spreads from a center; `conic` sweeps round it.
   */
  type: 'linear' | 'radial' | 'reflected' | 'conic';
  /** Linear/reflected: the way it runs, 0° top to bottom, 90° left to right. Conic: where it starts. */
  angle: number;
  /** The colors, when set; otherwise `from`, `mid` and `to`. */
  stops?: GradientStopDef[];
  /** The first and last color (kept in step with `stops`). */
  from: GradientColor;
  to: GradientColor;
  /** Older gradients: where the fade began and ended, 0–1. */
  start?: number;
  end?: number;
  /** Older gradients: a third color in between. */
  mid?: GradientColor & { at: number };
  /**
   * How softly each blend eases in and out, 0–1 (Photoshop's Smoothness):
   * 0 is a straight ramp, whose start and end show as lines. Unset: 1.
   */
  smooth?: number;
  /** Where each blend is half-way, 0.05–0.95 (Photoshop's midpoint). Unset: 0.5. */
  midpoint?: number;
  /** Linear/reflected, set on the canvas: from (x0, y0) to (x1, y1), shares of the box. Overrides `angle`. */
  line?: { x0: number; y0: number; x1: number; y1: number };
  /** Radial/conic: the center, shares of the box; unset is the middle. */
  cx?: number;
  cy?: number;
  /** Radial: how far it reaches, a share of the way to the corners; unset 1. */
  radius?: number;
  /** Radial: stretched to the box's shape (an ellipse) instead of a circle. */
  ellipse?: boolean;
  /** Film grain over it, 0–1; unset none. */
  grain?: number;
}

/** A gradient's colors, in order along it — from `stops`, or from the older `from`/`mid`/`to`. */
export function stopsOf(g: Gradient): GradientStopDef[] {
  if (g.stops && g.stops.length >= 2) return [...g.stops].sort((a, b) => a.at - b.at);
  const start = Math.min(1, Math.max(0, g.start ?? 0));
  const end = Math.max(start, Math.min(1, g.end ?? 1));
  return [
    { ...g.from, at: start },
    ...(g.mid
      ? [{ color: g.mid.color, alpha: g.mid.alpha, at: start + (end - start) * g.mid.at }]
      : []),
    { ...g.to, at: end },
  ];
}

/** A gradient with these colors, the older fields set to match — as the editor saves it. */
export function withStops(g: Gradient, stops: GradientStopDef[]): Gradient {
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  return {
    ...g,
    stops: sorted,
    from: { color: first.color, alpha: first.alpha },
    to: { color: last.color, alpha: last.alpha },
    start: undefined,
    end: undefined,
    mid: undefined,
  };
}

/** A picture's visible part: left, top, width and height as shares (0–1) of the whole. */
export interface ImageCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How Hapus background cut a picture: tuned for people, or for things. */
export type CutoutMode = 'potret' | 'objek';

/** One result of Hapus background: the cut picture, and where it goes. */
export interface CutoutVariant {
  sticker: string;
  x: number;
  y: number;
  size: number;
  ratio: number;
}

/** What a cut element shows: one of the results, or the uncut picture. */
export type CutoutPick = CutoutMode | 'asli';

export interface CutoutMark {
  from: string;
  /** The uncut picture's box, as a layer's: centre, width (slide widths), height ÷ width, turn, mirror. */
  box: { x: number; y: number; size: number; ratio: number; rotate: number; flip?: boolean };
  /**
   * The results to choose from, one per way of cutting — Hasil 1 (tuned for
   * people), Hasil 2 (for things): null when that way found nothing, missing
   * when not made yet.
   */
  variants?: Partial<Record<CutoutMode, CutoutVariant | null>>;
  /** What is in use: a result, or the picture as it was (`asli` — its background back). */
  pick?: CutoutPick;
  /** Marks from before there was a choice: the one way it was cut, and where. */
  mode?: CutoutMode;
  placed?: { x: number; y: number; size: number };
}

export interface StickerLayer {
  id: string;
  /** A built-in sticker id, or an uploaded image's id (see `isImageSticker`). */
  sticker: string;
  x: number;
  y: number;
  /** Width as a fraction of the slide width. */
  size: number;
  rotate: number;
  /** Tint for built-in (vector) stickers; an uploaded image keeps its own colors. */
  color: string;
  /**
   * Height ÷ width: fixed for an uploaded image when it is placed; for a shape,
   * whatever its side handles stretched it to.
   */
  ratio?: number;
  /** 0–1; unset is fully opaque. */
  opacity?: number;
  /** Mirrored left to right. */
  flip?: boolean;
  /** Shapes: just the outline instead of a filled shape. */
  outline?: boolean;
  /** Filled shapes: a gradient instead of the flat `color`. */
  gradient?: Gradient;
  /** How it mixes with what is under it (Photoshop's blend modes); unset is normal. */
  blend?: BlendMode;
  /** A soft shadow under it — follows a cut-out picture's own outline. */
  shadow?: DropShadow;
  /** Pictures: colors and look, as a photo's (Edit → Warna). */
  adjust?: PhotoAdjust;
  /** Pictures: melting away towards one side or the edges, as a photo's (Edit → Pudar). */
  fade?: PhotoFade;
  /** Pictures: the part of the picture shown, as shares (0–1) of it. */
  crop?: ImageCrop;
  /** Pictures: cut to a shape, as a photo can be (Ukuran & bentuk → Bentuk). */
  mask?: PhotoMask;
  /** Pictures: a line round the picture's own outline (a cut-out), `width` as a fraction of the slide width. */
  imageOutline?: { width: number; color: string };
  /** Shapes: outline and line thickness, as a fraction of the slide width. */
  lineWidth?: number;
  /** Rectangles: corner radius as a share of the short side (0.5 = pill). */
  corner?: number;
  /**
   * Hapus background was done: the uncut picture (`from`, an image asset),
   * the box it lay in, the way it was cut, and where the cut was put — so the
   * button shows it is done, and "Coba lagi" can cut it the other way.
   */
  cutout?: CutoutMark;
  /**
   * Added as a background image in the free layout. There it is a layer like
   * any other; in a ready-made layout it sits behind the photos, not over them.
   */
  behind?: boolean;
}

/** Uploaded sticker images get ids with this prefix; built-in ones never do. */
export const IMAGE_STICKER_PREFIX = 'stiker-';
export const isImageSticker = (sticker: string) => sticker.startsWith(IMAGE_STICKER_PREFIX);
/**
 * An empty background-image place, as a design keeps it: where a picture
 * goes, grey in the editor, nothing in the download — until one is chosen.
 */
export const BACKGROUND_PLACEHOLDER = 'latar-kosong';
export const isPlaceholder = (sticker: string) => sticker === BACKGROUND_PLACEHOLDER;

/** Shapes (drawn from their size, not from a fixed drawing) get ids with this prefix. */
export const SHAPE_PREFIX = 'bentuk:';
export const isShape = (sticker: string) => sticker.startsWith(SHAPE_PREFIX);

export type WatermarkPosition =
  'kiri-atas' | 'kanan-atas' | 'kiri-bawah' | 'tengah-bawah' | 'kanan-bawah';

export interface Watermark {
  enabled: boolean;
  /** Typed text, or an uploaded image (a transparent PNG looks best). */
  kind: 'teks' | 'gambar';
  /** The text; the studio name is filled in when the watermark is turned on. */
  text: string;
  position: WatermarkPosition;
  /**
   * Set once the watermark is dragged on the canvas: its center, as fractions
   * of the canvas. Picking a preset position clears it again.
   */
  custom: { x: number; y: number } | null;
  /** Text size, as a fraction of the slide width; an image is drawn a few times taller. */
  size: number;
  opacity: number;
  tone: 'terang' | 'gelap';
}

export interface CollageDoc {
  format: FormatId;
  /** Format `foto` only: the canvas's height ÷ width, the photo's own. */
  photoRatio?: number;
  /** Number of slides; always 1 unless the format is a carousel. */
  slides: number;
  templateId: string;
  slots: (Slot | null)[];
  /** Frames of the free layout; slot `i` fills `freeCells[i]`. */
  freeCells: FreeCell[];
  /** Frame drawn around freely placed photos. */
  freeFrame: 'none' | Frame;
  style: CollageStyle;
  backdrop: BackdropStyle;
  /** Carousel only: one background for all slides, or one per slide. */
  backgroundScope: 'semua' | 'per-slide';
  slideBackgrounds: SlideBackground[];
  texts: TextLayer[];
  stickers: StickerLayer[];
  watermark: Watermark;
  /**
   * Stacking order of the movable layers, bottom to top (see `layerKeys`).
   * Missing keys are fine: new items go on top, removed ones drop out.
   */
  layerOrder: string[];
  /** Per-layer visibility and lock, by layer key (or `PHOTOS_LAYER`). */
  /**
   * Per layer: hidden, locked, and `group` — the id of the saved group
   * (Kelompokkan) it belongs to; members move and get picked together.
   */
  layerMeta: Record<string, { hidden?: boolean; locked?: boolean; group?: string }>;
}

/** Starting length of the slot list; it grows when a layout has more cells. */
const INITIAL_SLOTS = Math.max(...TEMPLATES.map((t) => t.cells.length));

export function initialDoc(): CollageDoc {
  return {
    format: 'feed',
    slides: 1,
    templateId: '3-kiri-besar',
    slots: Array(INITIAL_SLOTS).fill(null),
    freeCells: [],
    freeFrame: 'none',
    style: { gap: 0.012, padding: 0.024, radius: 0, background: '#ffffff', frame: 1 },
    backdrop: { tint: 0, blur: 0, filter: '' },
    backgroundScope: 'semua',
    slideBackgrounds: [],
    texts: [],
    stickers: [],
    layerOrder: [],
    layerMeta: {},
    watermark: {
      enabled: false,
      kind: 'teks',
      text: '',
      position: 'kanan-bawah',
      custom: null,
      size: 0.028,
      opacity: 0.85,
      tone: 'terang',
    },
  };
}

/**
 * A new design with nothing on it: the canvas at a size, no template — the
 * designer places everything. A carousel starts with three slides.
 */
export function blankDoc(format: FormatId = 'feed', slides = 3, photoRatio?: number): CollageDoc {
  return {
    ...initialDoc(),
    format,
    ...(format === 'foto' && { photoRatio: photoRatio ?? 1 }),
    slides: format === 'carousel' ? Math.min(MAX_SLIDES, Math.max(MIN_SLIDES, slides)) : 1,
    templateId: FREE_LAYOUT_ID,
    slots: [],
  };
}

/** A new design that starts from a ready-made template (the first that fits the size). */
export function templateDoc(format: FormatId = 'feed'): CollageDoc {
  const doc = { ...initialDoc(), format, slides: format === 'carousel' ? 3 : 1 };
  const list = templatesFor(doc);
  return list.some((t) => t.id === doc.templateId)
    ? doc
    : { ...doc, templateId: list[0]?.id ?? doc.templateId };
}

/**
 * A new design as chosen on the start page: at a size (and, for a carousel,
 * a number of slides), empty — or laid out with template `templateId`, when
 * it is one for that size.
 */
export function startDoc(format: FormatId, slides: number, templateId: string | null): CollageDoc {
  const blank = blankDoc(format, slides);
  if (!templateId) return blank;
  const known = templatesFor(blank).some((t) => t.id === templateId);
  return known ? { ...blank, templateId } : templateDoc(format);
}

/** Height ÷ width of the whole canvas (all slides side by side). */
export function canvasRatio(
  doc: Pick<CollageDoc, 'format' | 'slides'> & { photoRatio?: number },
): number {
  return formatRatio(doc) / doc.slides;
}

/** Layouts offered for the current format: carousels have their own, generated per length. */
/** Layouts per format, worked out once — the catalog is long. */
const layoutsByFormat = new Map<FormatId, CollageTemplate[]>();

/**
 * The layouts offered for a format: a carousel's for its slide count;
 * otherwise every layout meant for the format whose photos keep a good shape
 * on its canvas (a tall story stretches a row of photos into strips).
 */
export function templatesFor(doc: Pick<CollageDoc, 'format' | 'slides'>): CollageTemplate[] {
  if (doc.format === 'carousel') return carouselTemplates(doc.slides);
  // A photo's own shape has no ready-made layouts: it is a canvas round the photo.
  if (doc.format === 'foto') return [];
  let list = layoutsByFormat.get(doc.format);
  if (!list) {
    const ratio = FORMATS[doc.format].ratio;
    list = TEMPLATES.filter(
      (t) =>
        !t.slides &&
        (!t.formats || t.formats.includes(doc.format)) &&
        // Hand-made and framed layouts are left as they are; generated tiled
        // ones must keep their shape on this canvas.
        (!t.id.startsWith('gen-') || t.free || cellsFit(t.cells, ratio, t.area)),
    );
    layoutsByFormat.set(doc.format, list);
  }
  return list;
}

/** The free layout as a template, so drawing and hit-testing treat it like any other. */
function freeTemplate(doc: CollageDoc): CollageTemplate {
  return {
    id: FREE_LAYOUT_ID,
    name: 'Tanpa template',
    free: true,
    frame: doc.freeFrame === 'none' ? undefined : doc.freeFrame,
    cells: doc.freeCells.map((c) => [c.x, c.y, c.w, c.h, c.rotate] as const),
  };
}

export function templateOf(doc: CollageDoc): CollageTemplate {
  if (doc.templateId === FREE_LAYOUT_ID) return freeTemplate(doc);
  const list = templatesFor(doc);
  return list.find((t) => t.id === doc.templateId) ?? list[0] ?? TEMPLATES[0]!;
}

export const isFreeLayout = (doc: Pick<CollageDoc, 'templateId'>) =>
  doc.templateId === FREE_LAYOUT_ID;

/** The photo in each of the first `count` cells; the slot list may be shorter. */
export function slotsFor(doc: CollageDoc, count: number): (Slot | null)[] {
  return Array.from({ length: count }, (_, i) => doc.slots[i] ?? null);
}

/** A slot list long enough for index `i`. */
export function withSlot(slots: (Slot | null)[], i: number, slot: Slot | null): (Slot | null)[] {
  const next =
    slots.length > i ? slots.slice() : [...slots, ...Array(i + 1 - slots.length).fill(null)];
  next[i] = slot;
  return next;
}

/** A background for each slide, taken from the whole-canvas one where missing. */
export function slideBackgroundsFor(doc: CollageDoc): SlideBackground[] {
  return Array.from(
    { length: doc.slides },
    (_, i) => doc.slideBackgrounds[i] ?? { color: doc.style.background, ...doc.backdrop },
  );
}

/**
 * Changes the carousel length without moving anything on screen: positions
 * are fractions of the whole canvas width, so they are rescaled to keep every
 * text, sticker and free photo on the same slide at the same spot. A generated
 * layout switches to the same pattern at the new length.
 */
export function withSlides(doc: CollageDoc, slides: number): CollageDoc {
  if (slides === doc.slides) return doc;
  const k = doc.slides / slides;
  const pattern = carouselPattern(doc.templateId);
  return {
    ...doc,
    slides,
    templateId: pattern ? carouselTemplateId(pattern, slides) : doc.templateId,
    freeCells: doc.freeCells.map((c) => ({ ...c, x: c.x * k, w: c.w * k })),
    texts: doc.texts.map((t) => ({ ...t, x: t.x * k })),
    stickers: doc.stickers.map((s) => ({ ...s, x: s.x * k })),
    watermark: doc.watermark.custom
      ? { ...doc.watermark, custom: { ...doc.watermark.custom, x: doc.watermark.custom.x * k } }
      : doc.watermark,
  };
}

/**
 * A new canvas shape, keeping the design as it was — like Canva's resize:
 * each slide's contents keep their proportions and are fitted into the new
 * shape, shrunk when it is shorter, centred with room around when taller.
 * `from` and `to` are the slide shapes (height ÷ width).
 */
export function refitDoc(doc: CollageDoc, from: number, to: number): CollageDoc {
  if (Math.abs(from - to) < 1e-6) return doc;
  const k = Math.min(1, to / from);
  const n = doc.slides;
  /** A point, as shares of the whole canvas, moved into the new shape on its own slide. */
  const point = (x: number, y: number) => {
    const slide = Math.min(n - 1, Math.max(0, Math.floor(x * n)));
    const lx = x * n - slide;
    return {
      x: (slide + 0.5 + (lx - 0.5) * k) / n,
      y: (to / 2 + (y * from - from / 2) * k) / to,
    };
  };
  return {
    ...doc,
    texts: doc.texts.map((t) => ({ ...t, ...point(t.x, t.y), size: t.size * k })),
    stickers: doc.stickers.map((st) => ({ ...st, ...point(st.x, st.y), size: st.size * k })),
    freeCells: doc.freeCells.map((c) => {
      const mid = point(c.x + c.w / 2, c.y + c.h / 2);
      const w = c.w * k;
      const h = (c.h * from * k) / to;
      return { ...c, x: mid.x - w / 2, y: mid.y - h / 2, w, h };
    }),
    watermark: doc.watermark.custom
      ? { ...doc.watermark, custom: point(doc.watermark.custom.x, doc.watermark.custom.y) }
      : doc.watermark,
  };
}

// ── Layers ──
//
// Background at the very bottom and the watermark at the very top never move.
// In a ready-made layout the photos sit together just above the background
// (one layer, `PHOTOS_LAYER`); text and stickers stack above them in any order.
// In the free layout every photo is a layer of its own and mixes with them.

export const PHOTOS_LAYER = 'photos';
/** The background (color, image) — can be hidden, never moved. */
export const BACKGROUND_LAYER = 'latar';
/** One carousel slide's background, hidden on its own from the layer list. */
export const slideBackgroundKey = (slide: number) => `latar:${slide}`;
export const textLayerKey = (id: string) => `text:${id}`;
export const stickerLayerKey = (id: string) => `sticker:${id}`;
export const photoLayerKey = (cellId: string) => `photo:${cellId}`;

/** Movable layers, bottom to top: the stored order, then anything new on top. */
export function layerKeys(doc: CollageDoc): string[] {
  const present = [
    ...(isFreeLayout(doc) ? doc.freeCells.map((c) => photoLayerKey(c.id)) : []),
    ...doc.stickers.map((s) => stickerLayerKey(s.id)),
    ...doc.texts.map((t) => textLayerKey(t.id)),
  ];
  const exists = new Set(present);
  const ordered = doc.layerOrder.filter((k) => exists.has(k));
  const placed = new Set(ordered);
  return [...ordered, ...present.filter((k) => !placed.has(k))];
}

export const isLayerHidden = (doc: CollageDoc, key: string) => Boolean(doc.layerMeta[key]?.hidden);

/**
 * Layer keys of background images (see `StickerLayer.behind`) that sit behind a
 * ready-made layout's photos — none in the free layout, where they are layers
 * like any other.
 */
export function behindKeys(doc: CollageDoc): Set<string> {
  if (isFreeLayout(doc)) return new Set();
  return new Set(doc.stickers.filter((s) => s.behind).map((s) => stickerLayerKey(s.id)));
}

/** Whether a slide's background is hidden — all of them, or just this one. */
export const isBackgroundHidden = (doc: CollageDoc, slide: number) =>
  isLayerHidden(doc, BACKGROUND_LAYER) || isLayerHidden(doc, slideBackgroundKey(slide));
export const isLayerLocked = (doc: CollageDoc, key: string) => Boolean(doc.layerMeta[key]?.locked);

export type LayerMove = 'forward' | 'backward' | 'front' | 'back';

/** Moves a layer one step or all the way, or to an index in the bottom-to-top list. */
export function moveLayer(doc: CollageDoc, key: string, to: LayerMove | number): CollageDoc {
  const keys = layerKeys(doc);
  const from = keys.indexOf(key);
  if (from < 0) return doc;
  const target =
    typeof to === 'number'
      ? to
      : to === 'forward'
        ? from + 1
        : to === 'backward'
          ? from - 1
          : to === 'front'
            ? keys.length - 1
            : 0;
  const clamped = Math.max(0, Math.min(keys.length - 1, target));
  if (clamped === from) return doc;
  const next = keys.slice();
  next.splice(from, 1);
  next.splice(clamped, 0, key);
  return { ...doc, layerOrder: next };
}

/**
 * Several layers moved together, keeping their order among themselves: all
 * to the front or the back, or each one step past the next layer outside the
 * group — one already at the end stays, and those behind it stop there.
 */
export function moveLayers(doc: CollageDoc, keys: string[], to: LayerMove): CollageDoc {
  const order = layerKeys(doc);
  const picked = new Set(keys.filter((k) => order.includes(k)));
  if (picked.size === 0) return doc;
  if (to === 'front' || to === 'back') {
    const mine = order.filter((k) => picked.has(k));
    const rest = order.filter((k) => !picked.has(k));
    return { ...doc, layerOrder: to === 'front' ? [...rest, ...mine] : [...mine, ...rest] };
  }
  const next = order.slice();
  const swap = (a: number, b: number) => ([next[a], next[b]] = [next[b]!, next[a]!]);
  // From the end it moves toward, so one member never jumps over another.
  if (to === 'forward') {
    for (let i = next.length - 2; i >= 0; i--) {
      if (picked.has(next[i]!) && !picked.has(next[i + 1]!)) swap(i, i + 1);
    }
  } else {
    for (let i = 1; i < next.length; i++) {
      if (picked.has(next[i]!) && !picked.has(next[i - 1]!)) swap(i, i - 1);
    }
  }
  return { ...doc, layerOrder: next };
}

export function patchLayerMeta(
  doc: CollageDoc,
  key: string,
  patch: { hidden?: boolean; locked?: boolean },
): CollageDoc {
  return { ...doc, layerMeta: { ...doc.layerMeta, [key]: { ...doc.layerMeta[key], ...patch } } };
}

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

/** Keeps an angle in -180…180 so it reads naturally. */
export function normalizeAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

/** Dark text on light backgrounds, light text on dark — by perceived brightness. */
export function readableOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#1c1c1c';
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1c1c1c' : '#ffffff';
}
