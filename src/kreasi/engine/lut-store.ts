import { byteSize } from './byte-size';
/**
 * LUTs (.cube) imported in Edit — and Pilih subjek's masks, and AI Denoise's
 * results — kept in this browser (IndexedDB), never sent anywhere. A photo's settings name its LUT by id; opened where the LUT
 * is missing, the photo shows without it until the .cube is imported again.
 */

export interface StoredLut {
  id: string;
  name: string;
  /** Points along each side (the cube is size³). */
  size: number;
  /** RGBA, size³ × 4 bytes, red fastest, then green, then blue. */
  data: Uint8Array;
  createdAt: number;
}

const DB = 'pilihfotomu-lut';
const STORE = 'luts';
/** Masking › Pilih subjek: the masks worked out, as PNG, by id — also only in this browser. */
const MASKS = 'masks';
/** AI Denoise: each photo cleaned, as PNG, by id — only in this browser too. */
const DENOISED = 'denoised';
/** Camera RAW files uploaded: the file, and what was read from it — by the picture's id. */
const RAWS = 'raws';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 4);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(MASKS)) db.createObjectStore(MASKS);
      if (!db.objectStoreNames.contains(DENOISED)) db.createObjectStore(DENOISED);
      if (!db.objectStoreNames.contains(RAWS)) db.createObjectStore(RAWS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
  store = STORE,
) {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(store, mode).objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** The stores kept here, for what they take and for tidying. */
export type LutStoreName = 'luts' | 'masks' | 'denoised' | 'raws';

/** Every entry of a store: its key and roughly its bytes. */
export function storeEntries(store: LutStoreName): Promise<{ key: string; bytes: number }[]> {
  return open()
    .then(
      (db) =>
        new Promise<{ key: string; bytes: number }[]>((resolve, reject) => {
          const out: { key: string; bytes: number }[] = [];
          const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
          req.onsuccess = () => {
            const c = req.result;
            if (!c) return resolve(out);
            out.push({ key: String(c.primaryKey), bytes: byteSize(c.value) });
            c.continue();
          };
          req.onerror = () => reject(req.error);
        }),
    )
    .catch(() => []);
}
/** Removes one entry of a store. */
export const deleteEntry = (store: LutStoreName, key: string) =>
  run('readwrite', (s) => s.delete(key), store).catch(() => undefined);

export const saveLut = (lut: StoredLut) => run('readwrite', (s) => s.put(lut));
export const getLut = (id: string) =>
  run<StoredLut | undefined>('readonly', (s) => s.get(id)).catch(() => undefined);
export const deleteLut = (id: string) => run('readwrite', (s) => s.delete(id));
/** Every LUT imported here, newest last — names only for a list. */
export const listLuts = () =>
  run<StoredLut[]>('readonly', (s) => s.getAll())
    .then((all) => all.sort((a, b) => a.createdAt - b.createdAt))
    .catch(() => [] as StoredLut[]);

/**
 * A .cube file read: its 3D table, as RGBA bytes. Throws with a message a
 * person can act on when the file is not one.
 */
export function parseCube(text: string, name: string): Omit<StoredLut, 'id' | 'createdAt'> {
  let size = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0]!.toUpperCase();
    if (key === 'LUT_3D_SIZE') size = Number(parts[1]);
    else if (key === 'LUT_1D_SIZE')
      throw new Error('LUT 1D belum didukung — pakai LUT 3D (.cube).');
    else if (key === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number);
    else if (key === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number);
    else if (key === 'TITLE' || /^[A-Z_]+$/.test(key)) continue;
    else if (parts.length >= 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }
  if (!Number.isInteger(size) || size < 2 || size > 128) {
    throw new Error('File ini bukan LUT .cube yang valid (LUT_3D_SIZE tidak ditemukan).');
  }
  if (values.length !== size * size * size * 3 || values.some((v) => !Number.isFinite(v))) {
    throw new Error('Isi LUT tidak lengkap atau rusak.');
  }
  const data = new Uint8Array(size * size * size * 4);
  for (let i = 0; i < size * size * size; i++) {
    for (let c = 0; c < 3; c++) {
      const v = (values[i * 3 + c]! - min[c]!) / Math.max(1e-6, max[c]! - min[c]!);
      data[i * 4 + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
    data[i * 4 + 3] = 255;
  }
  return { name: name.replace(/\.cube$/i, ''), size, data };
}

export const saveMaskImage = (id: string, png: Blob) =>
  run('readwrite', (s) => s.put(png, id), MASKS);
export const getMaskImage = (id: string) =>
  run<Blob | undefined>('readonly', (s) => s.get(id), MASKS).catch(() => undefined);

export const saveDenoised = (id: string, png: Blob) =>
  run('readwrite', (s) => s.put(png, id), DENOISED);
export const getDenoised = (id: string) =>
  run<Blob | undefined>('readonly', (s) => s.get(id), DENOISED).catch(() => undefined);

export interface StoredRaw {
  file: Blob;
  name: string;
  asShot: { kelvin: number; tint: number };
  /** The sensor's full size; missing on RAWs kept before it was noted. */
  sensor?: { width: number; height: number };
}
export const saveRaw = (id: string, raw: StoredRaw) =>
  run('readwrite', (s) => s.put(raw, id), RAWS);
export const getRaw = (id: string) =>
  run<StoredRaw | undefined>('readonly', (s) => s.get(id), RAWS).catch(() => undefined);
/** The pictures that came from a RAW, by id. */
export const listRawIds = () =>
  run<IDBValidKey[]>('readonly', (s) => s.getAllKeys(), RAWS)
    .then((keys) => keys.map(String))
    .catch(() => [] as string[]);
