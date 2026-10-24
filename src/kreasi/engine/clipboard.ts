import type { FreeCell, Slot, StickerLayer, TextLayer } from './document';

/**
 * Copied layers (Ctrl/⌘ + C), kept in this browser so they paste into any
 * collage — another client's draft included. The layers are JSON in
 * localStorage; pictures only this draft holds (computer photos, uploaded
 * images) travel along as files in their own small IndexedDB store, since a
 * draft's own files are not reachable from another.
 */
export interface LayerPayload {
  texts: TextLayer[];
  stickers: StickerLayer[];
  /** Free-layout photo frames, with the photo in each. */
  cells: { cell: FreeCell; slot: Slot | null }[];
  /** The canvas they came from — one slide's height per width, and slides — to keep their shape. */
  from?: { ratio: number; slides: number };
  /** Their layer keys, bottom to top, so they stack as they did. */
  order?: string[];
  /** The draft they were copied from: pasted back into it, they shift a little. */
  origin?: string;
  /** Saved groups among them, as lists of their layer keys — pasted grouped again. */
  groups?: string[][];
}

const KEY = 'pilihfotomu-kolase-salinan-v1';

/**
 * Put on the system clipboard as text with each copy, so a paste can tell
 * which came last: these layers, or a picture copied elsewhere since.
 */
export const CLIPBOARD_MARK = 'pilihfotomu-kolase:';

export function markSystemClipboard() {
  void navigator.clipboard?.writeText(`${CLIPBOARD_MARK}${Date.now()}`).catch(() => undefined);
}
const DB_NAME = 'pilihfotomu-salinan';
const STORE = 'files';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<R>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<R>) {
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

/**
 * Replaces what was copied before — at once, so a paste right after (or a
 * cut) never meets the old copy. Its pictures follow with `writeClipboardFiles`.
 */
export function writeClipboard(payload: LayerPayload): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** The pictures of the copy just written, for pasting into another draft. */
export async function writeClipboardFiles(files: Map<string, Blob>) {
  await tx('readwrite', (s) => s.clear()).catch(() => undefined);
  for (const [id, blob] of files) {
    await tx('readwrite', (s) => s.put(blob, id)).catch(() => undefined);
  }
}

export function readClipboard(): LayerPayload | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as LayerPayload;
    const empty = !p.texts?.length && !p.stickers?.length && !p.cells?.length;
    return empty
      ? null
      : { ...p, texts: p.texts ?? [], stickers: p.stickers ?? [], cells: p.cells ?? [] };
  } catch {
    return null;
  }
}

/** A picture that came with the copy, by its file or image id. */
export const clipboardFile = (id: string) =>
  tx<Blob | undefined>('readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>).catch(
    () => undefined,
  );
