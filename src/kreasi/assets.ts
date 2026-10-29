/**
 * Picture elements made in the editor (a photo with its background removed)
 * or brought in from this computer (a logo, a PNG),
 * kept as PNG files under `<app data>/kreasi/assets/` so drafts and exports
 * find them again. On the canvas they are image stickers named by their file.
 */

import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { IMAGE_STICKER_PREFIX, type CollageDoc } from './engine/document';

const ASSET = `${IMAGE_STICKER_PREFIX}aset-`;
export const assetSticker = (id: string) => `${ASSET}${id}`;
export const assetIdOf = (sticker: string) => (sticker.startsWith(ASSET) ? sticker.slice(ASSET.length) : null);
/** Uploads are named apart from cut-outs: they have no photo behind them to touch up with. */
const UPLOAD = 'unggah-';
export const isUpload = (sticker: string) => !!assetIdOf(sticker)?.startsWith(UPLOAD);
/** A cut-out from a photo (Hapus latar), which "Rapikan potongan" can touch up. */
export const isCutout = (sticker: string) => assetIdOf(sticker) != null && !isUpload(sticker);

const newAssetId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function put(id: string, canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG gagal dibuat'))), 'image/png'),
  );
  await api.saveAsset(id, new Uint8Array(await blob.arrayBuffer()));
  const img = new Image();
  img.src = canvas.toDataURL('image/png');
  cache.set(id, img.decode().then(() => img));
}

/**
 * Keeps a cut-out as a new picture element; its sticker id. Two companions
 * go with it, so it can be touched up with a brush later (`cutout-refine`):
 * the photo uncut (`-asli`) and the cut-out before trimming (`-penuh`), both
 * the size of the photo's place.
 */
export async function saveCutout(shown: HTMLCanvasElement, original: HTMLCanvasElement, full: HTMLCanvasElement): Promise<string> {
  const id = newAssetId();
  await Promise.all([put(id, shown), put(`${id}-asli`, original), put(`${id}-penuh`, full)]);
  return assetSticker(id);
}

/** Largest side an uploaded picture is kept at: plenty for any export, light to load. */
const UPLOAD_SIDE = 2400;

/**
 * A picture from this computer (a logo, a PNG with see-through parts) kept as
 * a new picture element: its sticker id, and its height ÷ width.
 */
export async function saveUpload(file: Blob): Promise<{ sticker: string; ratio: number }> {
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error(t('Gambar ini tidak bisa dibaca. Pakai PNG, JPEG, atau WebP.'));
  });
  const k = Math.min(1, UPLOAD_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const id = `${UPLOAD}${newAssetId()}`;
  await put(id, canvas);
  return { sticker: assetSticker(id), ratio: canvas.height / canvas.width };
}

/** The companions of a cut-out element, or null for an element without them. */
export async function cutoutParts(sticker: string): Promise<{ original: HTMLImageElement; full: HTMLImageElement } | null> {
  const id = assetIdOf(sticker);
  if (!id) return null;
  try {
    const [original, full] = await Promise.all([assetImage(`${id}-asli`), assetImage(`${id}-penuh`)]);
    return { original, full };
  } catch {
    return null;
  }
}

const cache = new Map<string, Promise<HTMLImageElement>>();

/** A picture element's image, read once. */
export function assetImage(id: string): Promise<HTMLImageElement> {
  let p = cache.get(id);
  if (!p) {
    p = api.loadAsset(id).then(async (bytes) => {
      const img = new Image();
      img.src = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      await img.decode();
      return img;
    });
    p.catch(() => cache.delete(id));
    cache.set(id, p);
  }
  return p;
}

/** Takes an uploaded picture's file away, and forgets the copy read from it. */
export async function deleteUploadFile(id: string) {
  await api.deleteUpload(id);
  cache.delete(id);
}

/** Every picture element `doc` uses, by sticker id (missing files left out). */
export async function docAssets(doc: CollageDoc): Promise<Map<string, HTMLImageElement>> {
  const out = new Map<string, HTMLImageElement>();
  await Promise.all(
    doc.stickers.map(async (st) => {
      const id = assetIdOf(st.sticker);
      if (id) await assetImage(id).then((img) => out.set(st.sticker, img), () => {});
    }),
  );
  return out;
}
