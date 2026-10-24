/**
 * Template thumbnails, drawn by the engine with stand-in pictures in the
 * photo places (`editor.scene`) — the bundled templates come without
 * example images. Drawn one at a time, off the main path, and kept for the
 * rest of the session.
 */

import { templateOf, type CollageDoc } from './engine/document';
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
      drawCollage(ctx, { width: f.width, doc, template: templateOf(doc), assets: emptyAssets(), editor: sceneEditor(numbered) });
      // Let the window breathe between thumbnails.
      await new Promise((r) => setTimeout(r, 0));
      return canvas.toDataURL('image/jpeg', 0.86);
    })) as Promise<string>;
    cache.set(k, p);
  }
  return p;
}
