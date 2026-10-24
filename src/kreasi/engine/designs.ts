import {
  BACKGROUND_PLACEHOLDER,
  FORMATS,
  FREE_LAYOUT_ID,
  PHOTOS_LAYER,
  behindKeys,
  isFreeLayout,
  layerKeys,
  newId,
  photoLayerKey,
  formatRatio,
  stickerLayerKey,
  type CollageDoc,
  type FormatId,
  type FreeCell,
  type PhotoAdjust,
  type PhotoStroke,
  type Slot,
  type StickerLayer,
} from './document';
import { cellLayouts, frameOf } from './render';
import { isLocalFont } from './font-catalog';
import type { CollageTemplate } from './templates';

/**
 * The saved-design format. Raised when its shape changes, so a design saved
 * today still opens after — and, once designs can be shared as templates, on
 * someone else's computer. 0 is what designs saved before versioning read as.
 */
export const DESIGN_VERSION = 1;

/** What a design is, at a glance — for the list now, for template filters later. */
export interface DesignInfo {
  format: FormatId;
  slides: number;
  /** Photo places it has. */
  photos: number;
  /**
   * Fonts from the photographer's own computer: they show only where they are
   * installed, so a design using them would look different for someone else.
   */
  localFonts: string[];
}

/**
 * "Desainku": a collage's look saved without its photos or background images —
 * layout, background colors, texts, elements, watermark — to start the next
 * client's collage from.
 *
 * Kept in this browser only (IndexedDB), like the draft and Gambarmu: nothing
 * is sent to the server. The watermark logo and image elements travel with
 * it as blobs, so a design still works after they were removed elsewhere.
 */

const DB_NAME = 'pilihfotomu-desain';
const STORE = 'desain';

export interface SavedDesign {
  /** Missing on designs saved before versioning (read as 0). */
  version?: number;
  id: string;
  name: string;
  createdAt: number;
  /** Missing on designs saved before versioning. */
  info?: DesignInfo;
  /** A small picture of the collage when it was saved. */
  thumb: string;
  /** The document with its photos taken out. */
  doc: CollageDoc;
  /**
   * Never kept: a design leaves background images out (in the free layout their
   * places stay, as grey placeholders). Always null; ignored if an older design has one.
   */
  backdrop: Blob | null;
  watermark: Blob | null;
  /** As `backdrop`: always empty. */
  slideBackdrops: (Blob | null)[];
  /**
   * How each photo place was styled — corners, line, colors, frame — put
   * back on whatever photos fill it. By place, like the photos.
   */
  slotLooks?: (SlotLook | null)[];
  /** Uploaded images placed as layers, by their sticker id. */
  stickers: { id: string; name: string; blob: Blob }[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<R>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<R>,
): Promise<R> {
  const db = await openDb();
  try {
    return await new Promise<R>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Newest first. Empty when IndexedDB is refused (a private window, say). */
export async function listDesigns(): Promise<SavedDesign[]> {
  try {
    const all = await tx<SavedDesign[]>('readonly', (s) => s.getAll() as IDBRequest<SavedDesign[]>);
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export const saveDesign = (design: SavedDesign) => tx('readwrite', (s) => s.put(design));

export const deleteDesign = (id: string) =>
  tx('readwrite', (s) => s.delete(id)).catch(() => undefined);

/** Empties Desainku. */
export const clearDesigns = () => tx('readwrite', (s) => s.clear()).catch(() => undefined);

/** A photo place's own styling, without the photo — see `SavedDesign.slotLooks`. */
export type SlotLook = Pick<Slot, 'radius' | 'stroke' | 'frame' | 'adjust' | 'mask'>;

/** What of a photo's styling a design keeps for its place. */
export function lookOf(slot: Slot | null | undefined): SlotLook | null {
  if (!slot) return null;
  const look: SlotLook = {};
  if (slot.radius != null) look.radius = slot.radius;
  if (slot.stroke) look.stroke = slot.stroke as PhotoStroke;
  if (slot.frame != null) look.frame = slot.frame;
  if (slot.adjust) look.adjust = slot.adjust as PhotoAdjust;
  if (slot.mask) look.mask = slot.mask;
  return Object.keys(look).length ? look : null;
}

/**
 * The same collage as a free ("Tata sendiri") layout: every photo place becomes
 * a frame where it was drawn — gap, margin and size included — and every
 * background image a grey placeholder layer at the bottom. Designs are kept
 * this way, so everything in them can be moved; the collage itself is left as
 * it is.
 *
 * `backgroundPlaces`: where background images were — a carousel slide each, or
 * null for the whole canvas.
 */
export function asFreeLayout(
  doc: CollageDoc,
  template: CollageTemplate,
  backgroundPlaces: (number | null)[] = [],
): CollageDoc {
  if (isFreeLayout(doc)) return doc;
  const f = frameOf(doc, 1000);
  const cells: FreeCell[] = cellLayouts(template, f, doc.style, doc.slots).map(({ rect }, i) => ({
    id: newId(),
    x: rect.x / f.width,
    y: rect.y / f.height,
    w: rect.w / f.width,
    h: rect.h / f.height,
    rotate: template.cells[i]![4] ?? 0,
  }));
  const slideH = formatRatio(doc);
  const places: StickerLayer[] = backgroundPlaces.map((slide) => {
    const areaW = slide === null ? doc.slides : 1;
    return {
      id: newId(),
      sticker: BACKGROUND_PLACEHOLDER,
      x: slide === null ? 0.5 : (slide + 0.5) / doc.slides,
      y: 0.5,
      size: areaW,
      rotate: 0,
      color: '#000000',
      ratio: slideH / areaW,
      behind: true,
    };
  });
  // Bottom to top: background places, background images already layers, the
  // photos (the layout's bottom layer), then text and elements as they were.
  const keys = layerKeys(doc);
  const back = behindKeys(doc);
  const photosHidden = Boolean(doc.layerMeta[PHOTOS_LAYER]?.hidden);
  return {
    ...doc,
    templateId: FREE_LAYOUT_ID,
    freeCells: cells,
    freeFrame: template.frame ?? 'none',
    // Sizes are in the frames now; a collage-wide size would shrink them again.
    style: { ...doc.style, scale: undefined },
    stickers: [...places, ...doc.stickers],
    layerOrder: [
      ...places.map((p) => stickerLayerKey(p.id)),
      ...keys.filter((k) => back.has(k)),
      ...cells.map((c) => photoLayerKey(c.id)),
      ...keys.filter((k) => !back.has(k)),
    ],
    layerMeta: photosHidden
      ? {
          ...doc.layerMeta,
          ...Object.fromEntries(cells.map((c) => [photoLayerKey(c.id), { hidden: true }])),
        }
      : doc.layerMeta,
  };
}

/** A design's canvas in words: "Feed 4:5", "Story 9:16", "Carousel 3 slide"… */
export function designFormatLabel(design: Pick<SavedDesign, 'doc'>): string {
  const { format, slides } = design.doc;
  return format === 'carousel' ? `Carousel ${slides} slide` : FORMATS[format].label;
}

/** Whether a design is made for this canvas — same format, and same slide count on a carousel. */
export function designFits(
  design: Pick<SavedDesign, 'doc'>,
  canvas: Pick<CollageDoc, 'format' | 'slides'>,
): boolean {
  return (
    design.doc.format === canvas.format &&
    (canvas.format !== 'carousel' || design.doc.slides === canvas.slides)
  );
}

/** The document a design keeps: everything but which photo goes where. */
export function withoutPhotos(doc: CollageDoc): CollageDoc {
  return { ...doc, slots: [] };
}

/**
 * The document with its background-image layers emptied (see
 * `StickerLayer.behind`): each keeps its place, size and tilt as an empty
 * placeholder, for whoever uses the design to put their own picture in.
 */
export function withoutBackgroundLayers(doc: CollageDoc): CollageDoc {
  if (!doc.stickers.some((s) => s.behind)) return doc;
  return {
    ...doc,
    stickers: doc.stickers.map((s) =>
      s.behind ? { ...s, sticker: BACKGROUND_PLACEHOLDER, opacity: undefined, flip: undefined } : s,
    ),
  };
}

export function designInfo(doc: CollageDoc, template: CollageTemplate): DesignInfo {
  return {
    format: doc.format,
    slides: doc.slides,
    photos: isFreeLayout(doc) ? doc.freeCells.length : template.cells.length,
    localFonts: [...new Set(doc.texts.map((t) => t.font).filter(isLocalFont))],
  };
}
