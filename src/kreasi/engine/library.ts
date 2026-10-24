/**
 * "Gambarmu": images the photographer uploaded — a studio logo, ornaments —
 * kept for every future collage, not just the current draft.
 *
 * Like the draft, it lives in this browser only (IndexedDB): nothing is sent
 * to or stored on the server. It is a separate database from the draft, so
 * "Mulai baru" clears the collage but keeps the library.
 */

const DB_NAME = 'pilihfotomu-pustaka';
const STORE = 'gambar';

export interface LibraryImage {
  id: string;
  name: string;
  blob: Blob;
  addedAt: number;
  /** SHA-256 of the picture's bytes: the same picture is kept once. Missing on older ones. */
  hash?: string;
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

/** Oldest first, the order they were added. Empty when IndexedDB is refused. */
export async function listLibrary(): Promise<LibraryImage[]> {
  try {
    const all = await tx<LibraryImage[]>(
      'readonly',
      (s) => s.getAll() as IDBRequest<LibraryImage[]>,
    );
    return all.sort((a, b) => a.addedAt - b.addedAt);
  } catch {
    return [];
  }
}

/** The picture's fingerprint: the same bytes, the same picture — whatever it was called. */
export async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Keeps a picture — unless the very same picture is already kept: then that
 * one's id comes back and nothing is added. Resolves to the id in Gambar.
 */
export async function addToLibrary(image: Omit<LibraryImage, 'addedAt' | 'hash'>): Promise<string> {
  try {
    const hash = await hashBlob(image.blob);
    const all = await tx<LibraryImage[]>(
      'readonly',
      (s) => s.getAll() as IDBRequest<LibraryImage[]>,
    );
    const same = all.find((l) => l.hash === hash);
    if (same) return same.id;
    await tx('readwrite', (s) => s.put({ ...image, hash, addedAt: Date.now() }));
  } catch {
    // IndexedDB refused: it just is not kept.
  }
  return image.id;
}

/** The kept picture with these bytes, if any. */
export async function findInLibrary(blob: Blob): Promise<LibraryImage | null> {
  try {
    const hash = await hashBlob(blob);
    const all = await tx<LibraryImage[]>(
      'readonly',
      (s) => s.getAll() as IDBRequest<LibraryImage[]>,
    );
    return all.find((l) => l.hash === hash) ?? null;
  } catch {
    return null;
  }
}

/** Cut-outs made by Hapus background before they stopped being kept (they live in their designs). */
const OLD_CUTOUT = / tanpa background\.png$/;

/**
 * Tidies Gambar once per opening: every picture fingerprinted, the same
 * picture kept once (the oldest), and old cut-outs let go. Designs that use a
 * picture let go keep their own copy in their draft. Resolves to the ids gone.
 */
export async function tidyLibrary(): Promise<Set<string>> {
  const gone = new Set<string>();
  try {
    const all = (
      await tx<LibraryImage[]>('readonly', (s) => s.getAll() as IDBRequest<LibraryImage[]>)
    ).sort((a, b) => a.addedAt - b.addedAt);
    const seen = new Set<string>();
    for (const image of all) {
      if (OLD_CUTOUT.test(image.name)) {
        gone.add(image.id);
        continue;
      }
      let hash = image.hash;
      if (!hash) {
        hash = await hashBlob(image.blob);
        await tx('readwrite', (s) => s.put({ ...image, hash }));
      }
      if (seen.has(hash)) gone.add(image.id);
      else seen.add(hash);
    }
    for (const id of gone) await tx('readwrite', (s) => s.delete(id));
  } catch {
    // Left as it is.
  }
  return gone;
}

export const removeFromLibrary = (id: string) =>
  tx('readwrite', (s) => s.delete(id)).catch(() => undefined);

/** Empties Gambarmu. */
export const clearLibrary = () => tx('readwrite', (s) => s.clear()).catch(() => undefined);
