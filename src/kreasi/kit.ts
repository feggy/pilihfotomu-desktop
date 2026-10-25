/**
 * The desktop side of Buat konten: the bundled templates, fonts for the
 * canvas, and photos from this computer as the engine's `DriveFile`s.
 * Everything that draws is in ./engine (copied from pilihfotomu-web).
 */

import { convertFileSrc } from '@tauri-apps/api/core';

import { api } from '../lib/api';
import { t } from '../lib/i18n';
import {
  BACKGROUND_PLACEHOLDER,
  blankDoc,
  FORMATS,
  IMAGE_STICKER_PREFIX,
  emptyPhotoFile,
  isPlaceholder,
  templateOf,
  type CollageDoc,
  type FormatId,
  type StickerLayer,
} from './engine/document';
import { normalizeDoc } from './engine/draft';
import { FONTS, type FontFamilies } from './engine/font-catalog';
import { cellLayouts, frameOf } from './engine/render';
import type { DriveFile } from './engine/types';
// Declares the bundled fonts and the --fk-* variables `fontFamilies` reads.
import './engine/fonts';

// ── Templates ─────────────────────────────────────────────────────

export type TemplateCategory =
  | 'pernikahan'
  | 'lamaran'
  | 'wisuda'
  | 'ulang-tahun'
  | 'ucapan'
  | 'keluarga'
  | 'bisnis'
  | 'game'
  | 'lainnya';

/** Category chips in the order a photographer looks for them. */
export const CATEGORIES: { id: TemplateCategory; label: string }[] = [
  { id: 'pernikahan', label: 'Pernikahan' },
  { id: 'lamaran', label: 'Lamaran' },
  { id: 'wisuda', label: 'Wisuda' },
  { id: 'ulang-tahun', label: 'Ulang tahun' },
  { id: 'ucapan', label: 'Ucapan' },
  { id: 'keluarga', label: 'Keluarga' },
  { id: 'bisnis', label: 'Bisnis' },
  { id: 'game', label: 'Game' },
  { id: 'lainnya', label: 'Lainnya' },
];

/** Bundled from pilihfotomu-api's community templates (public/kreasi/templates.json). */
export interface Template {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  format: FormatId;
  slides: number;
  /** `{"doc": CollageDoc}` as text; parsed on first use. */
  document: string;
  /** One of the photographer's own (Template saya), saved on this computer. */
  mine?: boolean;
  /** Own templates: when saved, for the newest first. */
  savedAt?: number;
}

// ── Starting from nothing ─────────────────────────────────────────

const BLANK_PREFIX = 'kosong-';
/** The canvases "Mulai dari kosong" offers. */
export const BLANK_FORMATS: FormatId[] = ['story', 'feed', 'square', 'carousel', 'cetak-4r', 'cetak-5r', 'cetak-10r', 'a4'];

/** An empty canvas of a format (a carousel starts with three slides), as a template. */
export function blankTemplate(format: FormatId): Template {
  return {
    id: `${BLANK_PREFIX}${format}`,
    name: t('Desain kosong'),
    description: '',
    category: 'lainnya',
    format,
    slides: format === 'carousel' ? 3 : 1,
    document: JSON.stringify({ doc: blankDoc(format, 3) }),
  };
}
export const isBlankId = (id: string) => id.startsWith(BLANK_PREFIX);

// ── Template saya ─────────────────────────────────────────────────

/** The photographer's own templates, newest first. */
export async function loadMyTemplates(): Promise<Template[]> {
  const raw = await api.listMyTemplates().catch(() => [] as string[]);
  return (raw ?? []).flatMap((r) => {
    try {
      const tp = JSON.parse(r) as Template;
      return tp.mine ? [tp] : [];
    } catch {
      return [];
    }
  });
}

/**
 * Saves `doc` as one of the photographer's own templates: the design without
 * its photos — the places stay, a background picture goes back to an empty
 * place — so it can be filled again for the next client.
 */
export async function saveMyTemplate(name: string, doc: CollageDoc, category: TemplateCategory): Promise<Template> {
  const kept: CollageDoc = {
    ...doc,
    // Each place keeps its look (shape, corners) without its photo.
    slots: doc.slots.map((s, i) => s && { ...s, file: emptyPhotoFile(i + 1), zoom: 1, ox: 0, oy: 0, rotate: 0, flip: false }),
    stickers: doc.stickers.map((s) => (photoIdOfSticker(s.sticker) != null ? { ...s, sticker: BACKGROUND_PLACEHOLDER } : s)),
  };
  const tp: Template = {
    id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: name.trim() || t('Template saya'),
    description: '',
    category,
    format: doc.format,
    slides: doc.slides,
    document: JSON.stringify({ doc: kept }),
    mine: true,
    savedAt: Date.now(),
  };
  await api.saveMyTemplate(tp.id, JSON.stringify(tp));
  return tp;
}
let templates: Promise<Template[]> | null = null;
export const loadTemplates = () =>
  (templates ??= fetch('/kreasi/templates.json').then((r) => {
    if (!r.ok) throw new Error('Template tidak bisa dibaca.');
    return r.json() as Promise<Template[]>;
  }));

const docs = new Map<string, CollageDoc>();
/** The template's design, ready to draw — every photo place empty. */
export function templateDoc(t: Template): CollageDoc {
  let doc = docs.get(t.id);
  if (!doc) {
    doc = normalizeDoc((JSON.parse(t.document) as { doc: CollageDoc }).doc);
    docs.set(t.id, doc);
  }
  return doc;
}

export type Shape = 'portrait' | 'landscape' | 'square';
export const shapeOf = (ratio: number): Shape => (ratio > 1.08 ? 'landscape' : ratio < 0.93 ? 'portrait' : 'square');

/** Each photo place of a design: its width ÷ height and shape, in order. */
export function slotShapes(doc: CollageDoc): { ratio: number; shape: Shape }[] {
  const template = templateOf(doc);
  const f = frameOf(doc, 1000);
  return cellLayouts(template, f, doc.style, doc.slots).map((c) => {
    const ratio = c.photo.w / Math.max(1, c.photo.h);
    return { ratio, shape: shapeOf(ratio) };
  });
}

export const formatLabel = (f: FormatId) => FORMATS[f]?.label ?? f;

// ── Fonts ─────────────────────────────────────────────────────────

let families: FontFamilies | null = null;
/** Font id → CSS family, read once from the `--fk-*` variables in ./fonts.css. */
export function fontFamilies(): FontFamilies {
  if (families) return families;
  const css = getComputedStyle(document.documentElement);
  families = {};
  for (const [id, f] of Object.entries(FONTS)) {
    const name = css.getPropertyValue(f.cssVar).trim();
    if (name) families[id] = `${name}, sans-serif`;
  }
  return families;
}

/**
 * Loads the fonts a design's texts use before the canvas draws them — a
 * canvas doesn't wait for fonts; it would draw the fallback.
 */
export async function loadDocFonts(doc: CollageDoc) {
  const fam = fontFamilies();
  await Promise.all(
    doc.texts.flatMap((t) => {
      const family = fam[t.font];
      if (!family) return [];
      const style = `${t.italic ? 'italic ' : ''}${t.weight ?? 400} 40px ${family}`;
      return [document.fonts.load(style).catch(() => [])];
    }),
  );
}

// ── Photos from this computer ─────────────────────────────────────

/**
 * A photo of a session folder, for the engine. `fileId` is the session id and
 * photo id; previews are files in the app cache, served by the asset protocol.
 */
export function photoFile(opts: { root: string; id: number; name: string; thumb: string | null; preview?: string | null }): DriveFile {
  return {
    id: `${opts.root}#${opts.id}`,
    fileId: `foto-${opts.id}`,
    fileName: opts.name,
    fileNumber: null,
    thumbnailUrl: opts.thumb ? convertFileSrc(opts.thumb) : null,
    previewUrl: opts.preview ? convertFileSrc(opts.preview) : null,
    webViewUrl: null,
    downloadUrl: null,
    order: opts.id,
  };
}

export const photoIdOf = (file: DriveFile) => (file.fileId.startsWith('foto-') ? Number(file.fileId.slice(5)) : null);

export { emptyPhotoFile };

/**
 * A background-image place filled with a session photo: an image sticker
 * whose id names the photo, so the design file stays small and the picture
 * is read from the folder like the photo places' are.
 */
const PHOTO_STICKER = `${IMAGE_STICKER_PREFIX}foto-`;
export const photoSticker = (photoId: number) => `${PHOTO_STICKER}${photoId}`;
export const photoIdOfSticker = (sticker: string) => (sticker.startsWith(PHOTO_STICKER) ? Number(sticker.slice(PHOTO_STICKER.length)) : null);
/** A place for a background picture, empty or filled with a photo. */
export const isPicturePlace = (st: Pick<StickerLayer, 'sticker'>) => isPlaceholder(st.sticker) || photoIdOfSticker(st.sticker) != null;
export const EMPTY_PICTURE = BACKGROUND_PLACEHOLDER;

/**
 * `img` cut to the middle at a box `ratio` (height / width) — the engine
 * stretches a picture to its box, a photo should fill it instead.
 */
export function coverCrop(img: HTMLImageElement, ratio: number): HTMLCanvasElement {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const sw = Math.min(iw, ih / ratio), sh = sw * ratio;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw));
  c.height = Math.max(1, Math.round(sh));
  c.getContext('2d')!.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, c.width, c.height);
  return c;
}

const images = new Map<string, Promise<HTMLImageElement>>();
/**
 * An image for the canvas from an asset-protocol URL. Fetched into a blob URL
 * first: same-origin, so the canvas stays exportable.
 */
export function loadLocalImage(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Foto tidak bisa dibaca (${r.status}).`);
        return r.blob();
      })
      .then(
        (blob) =>
          new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Foto tidak bisa dibaca.'));
            img.src = URL.createObjectURL(blob);
          }),
      );
    p.catch(() => images.delete(url));
    images.set(url, p);
  }
  return p;
}
