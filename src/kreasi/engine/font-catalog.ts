/**
 * Text fonts for the collage editor.
 *
 * Built-in fonts are loaded by next/font (see ./fonts.ts, which must define
 * the same CSS variables). Fonts installed on the photographer's computer are
 * used by family name, with an id of `local:<family>`.
 */

export type FontCategory = 'sans' | 'serif' | 'script' | 'display';

export const FONT_CATEGORIES: { id: FontCategory; label: string }[] = [
  { id: 'sans', label: 'Sans' },
  { id: 'serif', label: 'Serif' },
  { id: 'script', label: 'Tulisan' },
  { id: 'display', label: 'Display' },
];

export interface FontInfo {
  label: string;
  /** CSS variable holding the family name next/font generated. */
  cssVar: string;
  category: FontCategory;
  /** Has a real bold — faking bold on a single-weight script looks smeared. */
  bold: boolean;
}

/** Built-in fonts. Ids of the first six predate the catalog and stay as they are. */
export const FONTS: Record<string, FontInfo> = {
  // Sans
  sans: { label: 'Inter', cssVar: '--fk-inter', category: 'sans', bold: true },
  modern: { label: 'Montserrat', cssVar: '--fk-montserrat', category: 'sans', bold: true },
  poppins: { label: 'Poppins', cssVar: '--fk-poppins', category: 'sans', bold: true },
  'dm-sans': { label: 'DM Sans', cssVar: '--fk-dm-sans', category: 'sans', bold: true },
  raleway: { label: 'Raleway', cssVar: '--fk-raleway', category: 'sans', bold: true },
  'work-sans': { label: 'Work Sans', cssVar: '--fk-work-sans', category: 'sans', bold: true },
  josefin: { label: 'Josefin Sans', cssVar: '--fk-josefin', category: 'sans', bold: true },
  quicksand: { label: 'Quicksand', cssVar: '--fk-quicksand', category: 'sans', bold: true },
  rounded: { label: 'Nunito', cssVar: '--fk-nunito', category: 'sans', bold: true },
  'plus-jakarta-sans': {
    label: 'Plus Jakarta Sans',
    cssVar: '--fk-plus-jakarta-sans',
    category: 'sans',
    bold: true,
  },
  manrope: { label: 'Manrope', cssVar: '--fk-manrope', category: 'sans', bold: true },
  outfit: { label: 'Outfit', cssVar: '--fk-outfit', category: 'sans', bold: true },
  lato: { label: 'Lato', cssVar: '--fk-lato', category: 'sans', bold: true },
  'open-sans': { label: 'Open Sans', cssVar: '--fk-open-sans', category: 'sans', bold: true },
  karla: { label: 'Karla', cssVar: '--fk-karla', category: 'sans', bold: true },
  mulish: { label: 'Mulish', cssVar: '--fk-mulish', category: 'sans', bold: true },
  figtree: { label: 'Figtree', cssVar: '--fk-figtree', category: 'sans', bold: true },
  'space-grotesk': {
    label: 'Space Grotesk',
    cssVar: '--fk-space-grotesk',
    category: 'sans',
    bold: true,
  },
  syne: { label: 'Syne', cssVar: '--fk-syne', category: 'sans', bold: true },
  jost: { label: 'Jost', cssVar: '--fk-jost', category: 'sans', bold: true },
  lexend: { label: 'Lexend', cssVar: '--fk-lexend', category: 'sans', bold: true },
  'tenor-sans': { label: 'Tenor Sans', cssVar: '--fk-tenor-sans', category: 'sans', bold: false },
  // Serif
  serif: { label: 'Cormorant', cssVar: '--fk-cormorant', category: 'serif', bold: true },
  display: { label: 'Playfair Display', cssVar: '--fk-playfair', category: 'serif', bold: true },
  lora: { label: 'Lora', cssVar: '--fk-lora', category: 'serif', bold: true },
  'eb-garamond': {
    label: 'EB Garamond',
    cssVar: '--fk-eb-garamond',
    category: 'serif',
    bold: true,
  },
  baskerville: {
    label: 'Libre Baskerville',
    cssVar: '--fk-baskerville',
    category: 'serif',
    bold: true,
  },
  'bodoni-moda': { label: 'Bodoni Moda', cssVar: '--fk-bodoni', category: 'serif', bold: true },
  cinzel: { label: 'Cinzel', cssVar: '--fk-cinzel', category: 'serif', bold: true },
  'dm-serif': {
    label: 'DM Serif Display',
    cssVar: '--fk-dm-serif',
    category: 'serif',
    bold: false,
  },
  marcellus: { label: 'Marcellus', cssVar: '--fk-marcellus', category: 'serif', bold: false },
  merriweather: {
    label: 'Merriweather',
    cssVar: '--fk-merriweather',
    category: 'serif',
    bold: true,
  },
  'crimson-text': {
    label: 'Crimson Text',
    cssVar: '--fk-crimson-text',
    category: 'serif',
    bold: true,
  },
  spectral: { label: 'Spectral', cssVar: '--fk-spectral', category: 'serif', bold: true },
  prata: { label: 'Prata', cssVar: '--fk-prata', category: 'serif', bold: false },
  cardo: { label: 'Cardo', cssVar: '--fk-cardo', category: 'serif', bold: true },
  'gilda-display': {
    label: 'Gilda Display',
    cssVar: '--fk-gilda-display',
    category: 'serif',
    bold: false,
  },
  fraunces: { label: 'Fraunces', cssVar: '--fk-fraunces', category: 'serif', bold: true },
  bellefair: { label: 'Bellefair', cssVar: '--fk-bellefair', category: 'serif', bold: false },
  'libre-caslon-text': {
    label: 'Libre Caslon Text',
    cssVar: '--fk-libre-caslon-text',
    category: 'serif',
    bold: true,
  },
  forum: { label: 'Forum', cssVar: '--fk-forum', category: 'serif', bold: false },
  gloock: { label: 'Gloock', cssVar: '--fk-gloock', category: 'serif', bold: false },
  'young-serif': {
    label: 'Young Serif',
    cssVar: '--fk-young-serif',
    category: 'serif',
    bold: false,
  },
  'instrument-serif': {
    label: 'Instrument Serif',
    cssVar: '--fk-instrument-serif',
    category: 'serif',
    bold: false,
  },
  'josefin-slab': {
    label: 'Josefin Slab',
    cssVar: '--fk-josefin-slab',
    category: 'serif',
    bold: true,
  },
  // Handwriting
  script: { label: 'Great Vibes', cssVar: '--fk-great-vibes', category: 'script', bold: false },
  dancing: { label: 'Dancing Script', cssVar: '--fk-dancing', category: 'script', bold: true },
  parisienne: { label: 'Parisienne', cssVar: '--fk-parisienne', category: 'script', bold: false },
  allura: { label: 'Allura', cssVar: '--fk-allura', category: 'script', bold: false },
  sacramento: { label: 'Sacramento', cssVar: '--fk-sacramento', category: 'script', bold: false },
  pinyon: { label: 'Pinyon Script', cssVar: '--fk-pinyon', category: 'script', bold: false },
  satisfy: { label: 'Satisfy', cssVar: '--fk-satisfy', category: 'script', bold: false },
  caveat: { label: 'Caveat', cssVar: '--fk-caveat', category: 'script', bold: true },
  pacifico: { label: 'Pacifico', cssVar: '--fk-pacifico', category: 'script', bold: false },
  'alex-brush': { label: 'Alex Brush', cssVar: '--fk-alex-brush', category: 'script', bold: false },
  tangerine: { label: 'Tangerine', cssVar: '--fk-tangerine', category: 'script', bold: true },
  'kaushan-script': {
    label: 'Kaushan Script',
    cssVar: '--fk-kaushan-script',
    category: 'script',
    bold: false,
  },
  'mrs-saint-delafield': {
    label: 'Mrs Saint Delafield',
    cssVar: '--fk-mrs-saint-delafield',
    category: 'script',
    bold: false,
  },
  'monsieur-la-doulaise': {
    label: 'Monsieur La Doulaise',
    cssVar: '--fk-monsieur-la-doulaise',
    category: 'script',
    bold: false,
  },
  'homemade-apple': {
    label: 'Homemade Apple',
    cssVar: '--fk-homemade-apple',
    category: 'script',
    bold: false,
  },
  'shadows-into-light': {
    label: 'Shadows Into Light',
    cssVar: '--fk-shadows-into-light',
    category: 'script',
    bold: false,
  },
  'amatic-sc': { label: 'Amatic SC', cssVar: '--fk-amatic-sc', category: 'script', bold: true },
  yellowtail: { label: 'Yellowtail', cssVar: '--fk-yellowtail', category: 'script', bold: false },
  italianno: { label: 'Italianno', cssVar: '--fk-italianno', category: 'script', bold: false },
  'rouge-script': {
    label: 'Rouge Script',
    cssVar: '--fk-rouge-script',
    category: 'script',
    bold: false,
  },
  'petit-formal-script': {
    label: 'Petit Formal Script',
    cssVar: '--fk-petit-formal-script',
    category: 'script',
    bold: false,
  },
  'la-belle-aurore': {
    label: 'La Belle Aurore',
    cssVar: '--fk-la-belle-aurore',
    category: 'script',
    bold: false,
  },
  kalam: { label: 'Kalam', cssVar: '--fk-kalam', category: 'script', bold: true },
  'patrick-hand': {
    label: 'Patrick Hand',
    cssVar: '--fk-patrick-hand',
    category: 'script',
    bold: false,
  },
  'indie-flower': {
    label: 'Indie Flower',
    cssVar: '--fk-indie-flower',
    category: 'script',
    bold: false,
  },
  'mr-dafoe': { label: 'Mr Dafoe', cssVar: '--fk-mr-dafoe', category: 'script', bold: false },
  birthstone: { label: 'Birthstone', cssVar: '--fk-birthstone', category: 'script', bold: false },
  'ms-madi': { label: 'Ms Madi', cssVar: '--fk-ms-madi', category: 'script', bold: false },
  'style-script': {
    label: 'Style Script',
    cssVar: '--fk-style-script',
    category: 'script',
    bold: false,
  },
  corinthia: { label: 'Corinthia', cssVar: '--fk-corinthia', category: 'script', bold: true },
  // Display
  'bebas-neue': { label: 'Bebas Neue', cssVar: '--fk-bebas', category: 'display', bold: false },
  anton: { label: 'Anton', cssVar: '--fk-anton', category: 'display', bold: false },
  'abril-fatface': {
    label: 'Abril Fatface',
    cssVar: '--fk-abril',
    category: 'display',
    bold: false,
  },
  italiana: { label: 'Italiana', cssVar: '--fk-italiana', category: 'display', bold: false },
  oswald: { label: 'Oswald', cssVar: '--fk-oswald', category: 'display', bold: true },
  righteous: { label: 'Righteous', cssVar: '--fk-righteous', category: 'display', bold: false },
  lobster: { label: 'Lobster', cssVar: '--fk-lobster', category: 'display', bold: false },
  bungee: { label: 'Bungee', cssVar: '--fk-bungee', category: 'display', bold: false },
  'alfa-slab-one': {
    label: 'Alfa Slab One',
    cssVar: '--fk-alfa-slab-one',
    category: 'display',
    bold: false,
  },
  'yeseva-one': {
    label: 'Yeseva One',
    cssVar: '--fk-yeseva-one',
    category: 'display',
    bold: false,
  },
  staatliches: {
    label: 'Staatliches',
    cssVar: '--fk-staatliches',
    category: 'display',
    bold: false,
  },
  fredoka: { label: 'Fredoka', cssVar: '--fk-fredoka', category: 'display', bold: true },
  chewy: { label: 'Chewy', cssVar: '--fk-chewy', category: 'display', bold: false },
  limelight: { label: 'Limelight', cssVar: '--fk-limelight', category: 'display', bold: false },
  'poiret-one': {
    label: 'Poiret One',
    cssVar: '--fk-poiret-one',
    category: 'display',
    bold: false,
  },
  'cinzel-decorative': {
    label: 'Cinzel Decorative',
    cssVar: '--fk-cinzel-decorative',
    category: 'display',
    bold: true,
  },
  syncopate: { label: 'Syncopate', cssVar: '--fk-syncopate', category: 'display', bold: true },
  'unica-one': { label: 'Unica One', cssVar: '--fk-unica-one', category: 'display', bold: false },
  'archivo-black': {
    label: 'Archivo Black',
    cssVar: '--fk-archivo-black',
    category: 'display',
    bold: false,
  },
  'dela-gothic-one': {
    label: 'Dela Gothic One',
    cssVar: '--fk-dela-gothic-one',
    category: 'display',
    bold: false,
  },
  'rubik-mono-one': {
    label: 'Rubik Mono One',
    cssVar: '--fk-rubik-mono-one',
    category: 'display',
    bold: false,
  },
  monoton: { label: 'Monoton', cssVar: '--fk-monoton', category: 'display', bold: false },
};

export const LOCAL_PREFIX = 'local:';
export const isLocalFont = (id: string) => id.startsWith(LOCAL_PREFIX);
export const localFontId = (family: string) => `${LOCAL_PREFIX}${family}`;

/** Display name of any font id. */
export function fontLabel(id: string): string {
  if (isLocalFont(id)) return id.slice(LOCAL_PREFIX.length);
  return FONTS[id]?.label ?? 'Inter';
}

/** Whether bold is real for this font. Local fonts: let the browser decide. */
export function fontHasBold(id: string): boolean {
  return isLocalFont(id) ? true : (FONTS[id]?.bold ?? true);
}

/** Resolved family names of built-in fonts, read from the page's CSS variables. */
export type FontFamilies = Partial<Record<string, string>>;

/** The CSS `font-family` value for a font id — usable in canvas and in the DOM. */
export function fontFamily(id: string, families: FontFamilies): string {
  if (isLocalFont(id)) return `"${id.slice(LOCAL_PREFIX.length).replace(/"/g, '')}", sans-serif`;
  return families[id] || 'Georgia, serif';
}
