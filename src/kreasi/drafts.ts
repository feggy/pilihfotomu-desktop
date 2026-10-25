/**
 * Buat konten designs saved as they are made — `<app data>/kreasi/<id>.json`
 * through Rust — so closing the window or going back never loses work.
 * The photos are referenced, not copied: by session folder, scanned folder,
 * or the list of files picked one by one.
 */

import { api } from '../lib/api';
import { slotsFor, templateOf, type CollageDoc } from './engine/document';
import { drawCollage, frameOf } from './engine/render';
import { blankTemplate, isBlankId, loadDocFonts, loadLocalImage, type Template } from './kit';
import { emptyAssets } from './preview';
import type { Source } from './store';

export const DRAFT_VERSION = 1;

export interface Draft {
  v: number;
  id: string;
  name: string;
  templateId: string;
  templateName: string;
  updatedAt: number;
  doc: CollageDoc;
  source: Source | null;
  /** Small JPEG of the design with its photos, for the list. */
  cover: string | null;
}

export const newDraftId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A picture of the design with its photos' thumbnails, `width` px wide. */
export async function coverOf(doc: CollageDoc, width = 220): Promise<string | null> {
  try {
    await loadDocFonts(doc);
    const images = new Map<string, HTMLImageElement>();
    await Promise.all(
      slotsFor(doc, templateOf(doc).cells.length).map(async (s) => {
        if (s?.file.thumbnailUrl) images.set(s.file.fileId, await loadLocalImage(s.file.thumbnailUrl).catch(() => null as never));
      }),
    );
    const f = frameOf(doc, width * doc.slides);
    const c = document.createElement('canvas');
    c.width = Math.round(f.width);
    c.height = Math.round(f.height);
    drawCollage(c.getContext('2d')!, { width: f.width, doc, template: templateOf(doc), assets: { ...emptyAssets(), images } });
    return c.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  }
}

export async function saveDraft(d: Omit<Draft, 'v' | 'updatedAt' | 'cover'>) {
  const draft: Draft = { ...d, v: DRAFT_VERSION, updatedAt: Date.now(), cover: await coverOf(d.doc) };
  await api.saveDraft(d.id, JSON.stringify(draft));
  return draft.updatedAt;
}

export async function listDrafts(): Promise<Draft[]> {
  const raw = await api.listDrafts().catch(() => [] as string[]);
  return (raw ?? []).flatMap((r) => {
    try {
      const d = JSON.parse(r) as Draft;
      return d.v === DRAFT_VERSION ? [d] : [];
    } catch {
      return [];
    }
  });
}

/**
 * Makes a draft's photos readable again after a restart: files picked one by
 * one are registered with Rust under the same key as before.
 */
export async function reopenSource(source: Source | null): Promise<Source | null> {
  if (!source) return source;
  const root = source.files?.length ? (await api.openFiles(source.files)).root : source.root;
  // Dragged-in files again, in the same order: the same ids.
  if (source.added?.length) await api.addFiles(root, source.added).catch(() => []);
  return { ...source, root };
}

/** The template a draft started from — bundled, own, or an empty canvas. */
export const templateOfDraft = (all: Template[], d: Draft) =>
  all.find((t) => t.id === d.templateId) ?? (isBlankId(d.templateId) ? blankTemplate(d.doc.format) : null);
