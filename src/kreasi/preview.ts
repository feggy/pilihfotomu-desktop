/**
 * Template thumbnails, drawn by the engine with stand-in pictures in the
 * photo places (`editor.scene`) — the bundled templates come without
 * example images. Drawn one at a time, off the main path, and kept for the
 * rest of the session.
 */

import { isPlaceholder, templateOf, type CollageDoc } from './engine/document';
import { itemBounds } from './engine/bounds';
import { drawCollage, frameOf, type DrawAssets } from './engine/render';
import { fontFamilies, loadDocFonts } from './kit';

export function emptyAssets(): DrawAssets {
  return {
    images: new Map(),
    backdrop: null,
    slideBackdrops: [],
    watermark: null,
    stickerImages: new Map(),
    studioName: '',
    families: fontFamilies(),
  };
}

/** Editor options for a picture of a design: no selection, numbered stand-ins. */
export const sceneEditor = (numbered = false) => ({
  selection: null,
  swapTarget: null,
  numbered,
  scene: !numbered,
  emptyFill: '#e8e2d4',
  emptyText: '#8c6a30',
  accent: '#c9a96e',
});

const cache = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

/** A data URL picture of `doc`, `width` px wide (one slide wide for a carousel shows all slides). */
export function previewOf(key: string, doc: CollageDoc, width: number, numbered = false): Promise<string> {
  const k = `${key}@${width}${numbered ? 'n' : ''}`;
  let p = cache.get(k);
  if (!p) {
    p = (queue = queue.then(async () => {
      await loadDocFonts(doc);
      const f = frameOf(doc, width * doc.slides);
      const canvas = document.createElement('canvas');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(f.width * dpr);
      canvas.height = Math.round(f.height * dpr);
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      // An empty background-picture place is the editor's grey box: not part of how the design looks.
      const shown = { ...doc, stickers: doc.stickers.filter((st) => !isPlaceholder(st.sticker)) };
      drawCollage(ctx, { width: f.width, doc: shown, template: templateOf(doc), assets: emptyAssets(), editor: sceneEditor(numbered) });
      // Let the window breathe between thumbnails.
      await new Promise((r) => setTimeout(r, 0));
      return canvas.toDataURL('image/jpeg', 0.86);
    })) as Promise<string>;
    cache.set(k, p);
  }
  return p;
}

/**
 * A picture of the texts and elements of `doc` only, cropped to them with a
 * little room and fitted into a `side`-px square — previews of presets,
 * stickers and shapes, where the thing itself should fill the tile.
 */
export function itemPreviewOf(key: string, doc: CollageDoc, side: number): Promise<string> {
  const k = `${key}@item${side}`;
  let p = cache.get(k);
  if (!p) {
    p = (queue = queue.then(async () => {
      await loadDocFonts(doc);
      const W = 600;
      const f = frameOf(doc, W);
      const big = document.createElement('canvas');
      big.width = W;
      big.height = Math.round(f.height);
      const ctx = big.getContext('2d')!;
      drawCollage(ctx, { width: W, doc, template: templateOf(doc), assets: emptyAssets() });
      const boxes = itemBounds(doc, templateOf(doc), f, fontFamilies(), ctx);
      const l = Math.min(...boxes.map((b) => b.l)), r = Math.max(...boxes.map((b) => b.r));
      const t = Math.min(...boxes.map((b) => b.t)), b = Math.max(...boxes.map((b) => b.b));
      // A thin line is wide but barely tall: give it room to read as a line.
      const w = Math.max(r - l, 20), h = Math.max(b - t, 20);
      const pad = Math.max(w, h) * 0.12;
      const size = Math.max(w, h) + 2 * pad;
      const sx = (l + r) / 2 - size / 2, sy = (t + b) / 2 - size / 2;
      const out = document.createElement('canvas');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      out.width = out.height = Math.round(side * dpr);
      const o = out.getContext('2d')!;
      o.fillStyle = doc.style.background;
      o.fillRect(0, 0, out.width, out.height);
      o.drawImage(big, sx, sy, size, size, 0, 0, out.width, out.height);
      await new Promise((res) => setTimeout(res, 0));
      return out.toDataURL('image/png');
    })) as Promise<string>;
    cache.set(k, p);
  }
  return p;
}
