import type { DriveFile } from './types';
import { DEFAULT_SHADOW, IMAGE_STICKER_PREFIX, initialDoc, type CollageDoc } from './document';
import { makeZip, readZip } from './zip';
import { listLibrary } from './library';
import { byteSize } from './byte-size';

/**
 * The collage draft lives in this browser only — nothing goes to the server.
 *
 * The document (layout, which photo where, style, text…) is small JSON in
 * localStorage. Photos from the photographer's computer and the background
 * image are files, so they go to IndexedDB, keyed by their id; object URLs are
 * recreated from them on restore.
 */

const DOC_KEY = 'pilihfotomu-kolase-draf-v1';
const INDEX_KEY = 'pilihfotomu-kolase-daftar-v1';

/**
 * Every collage is a draft of its own, so starting another — for the same
 * client or without one — never overwrites the one before. The scope is the
 * open draft's id. Drafts from before there could be several per booking have
 * the booking code as id, or '' without a booking (the original, unprefixed
 * keys); new ones get an id from `newDraftId`.
 */
let scope = '';
/** The booking the open draft belongs to, for its entry in the list. */
let scopeBooking: string | null = null;
export function setDraftScope(id: string, bookingCode: string | null) {
  scope = id;
  scopeBooking = bookingCode;
}

/** A fresh draft id. Lowercase, so it never reads as a booking code; never has a '/'. */
export const newDraftId = () =>
  `draf-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The booking a draft belongs to. Older entries have none recorded: their id is the booking. */
export const draftBooking = (d: DraftEntry): string | null =>
  d.booking !== undefined ? d.booking : d.id || null;

/**
 * Which draft to open: the one asked for (`''` is the original draft without a
 * booking), else the latest for this booking — or without one — else a first one.
 */
export function resolveDraftId(asked: string | null, bookingCode: string | null): string {
  if (asked !== null && !asked.includes('/')) return asked;
  const latest = listDrafts().find((d) => draftBooking(d) === bookingCode);
  return latest?.id ?? bookingCode ?? '';
}

/** The editor's address for a draft. */
const FRESH_KEY = 'pilihfotomu-kolase-draf-baru';

/**
 * A draft just made for the photographer (from a shared template): opening it
 * the first time is not "restoring" anything. Kept for one opening only.
 */
export function markDraftFresh(id: string) {
  try {
    sessionStorage.setItem(FRESH_KEY, id);
  } catch {
    // Storage off — the restored notice just shows, as for any draft.
  }
}

export function takeDraftFresh(id: string): boolean {
  try {
    if (sessionStorage.getItem(FRESH_KEY) !== id) return false;
    sessionStorage.removeItem(FRESH_KEY);
    return true;
  } catch {
    return false;
  }
}

export function draftHref(id: string, bookingCode: string | null): string {
  const params = new URLSearchParams();
  if (bookingCode) params.set('booking', bookingCode);
  params.set('draf', id);
  return `/dashboard/kreasi?${params.toString()}`;
}
const docKey = (id = scope) => (id ? `${DOC_KEY}:${id}` : DOC_KEY);
/** File keys never contain '/', so the prefix cannot collide with a real key. */
const keyIn = (id: string, key: string) => (id ? `${id}/${key}` : key);
const fileKey = (key: string) => keyIn(scope, key);
const inScope = (key: string, id: string) => (id ? key.startsWith(`${id}/`) : !key.includes('/'));
const DB_NAME = 'pilihfotomu-kolase';
const STORE = 'files';
export const BACKDROP_KEY = 'latar';
export const WATERMARK_KEY = 'watermark';
export const slideBackdropKey = (slide: number) => `latar-slide-${slide}`;

export const isLocalFile = (file: DriveFile) => file.fileId.startsWith('lokal-');
/**
 * A computer image is one image, whether it fills a photo place or is an
 * element: the photo's id and the picture's id in Gambar share their tail.
 */
export const libraryIdOfLocal = (fileId: string) =>
  `${IMAGE_STICKER_PREFIX}${fileId.slice('lokal-'.length)}`;
export const localIdOfLibrary = (assetId: string) =>
  `lokal-${assetId.slice(IMAGE_STICKER_PREFIX.length)}`;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
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

/**
 * Told when something could not be kept — the browser's storage is full, or
 * refused — so the editor can say so instead of losing work quietly.
 */
let onStorageError: (() => void) | null = null;
export function watchStorageErrors(listener: (() => void) | null) {
  onStorageError = listener;
}

/** Stored files never block the editor: a private window may refuse IndexedDB. */
export const putFile = (key: string, blob: Blob) =>
  tx('readwrite', (s) => s.put(blob, fileKey(key))).catch(() => onStorageError?.());
export const deleteFile = (key: string) =>
  tx('readwrite', (s) => s.delete(fileKey(key))).catch(() => undefined);
const getFile = (key: string) =>
  tx<Blob | undefined>(
    'readonly',
    (s) => s.get(fileKey(key)) as IDBRequest<Blob | undefined>,
  ).catch(() => undefined);
/**
 * A sharper picture of each draft for the start page's cards, kept with the
 * draft's files (the small one in the list stays small, for localStorage).
 */
export const PREVIEW_KEY = 'pratinjau';
export const getDraftPreview = (id: string) =>
  tx<Blob | undefined>(
    'readonly',
    (s) => s.get(keyIn(id, PREVIEW_KEY)) as IDBRequest<Blob | undefined>,
  ).catch(() => undefined);

/**
 * "Mulai dari foto": the photo picked on the start page, left with the new
 * draft's files for the editor to place — once, even across a reload.
 */
const START_PHOTO_KEY = 'foto-awal';
export const putStartPhoto = (id: string, photo: File) =>
  tx('readwrite', (s) => s.put(photo, keyIn(id, START_PHOTO_KEY)));
export async function takeStartPhoto(id: string): Promise<File | undefined> {
  const photo = await tx<File | undefined>(
    'readonly',
    (s) => s.get(keyIn(id, START_PHOTO_KEY)) as IDBRequest<File | undefined>,
  ).catch(() => undefined);
  if (photo)
    await tx('readwrite', (s) => s.delete(keyIn(id, START_PHOTO_KEY))).catch(() => undefined);
  return photo;
}

/** One draft's files only — other bookings' drafts stay. */
async function clearFiles(id: string) {
  try {
    const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    await Promise.all(
      keys
        .filter((k) => typeof k === 'string' && inScope(k, id))
        .map((k) => tx('readwrite', (s) => s.delete(k))),
    );
  } catch {
    // Nothing to clear.
  }
}

/** A computer photo as the editor sees it: shaped like a Drive file. */
export function localDriveFile(fileId: string, name: string, url: string): DriveFile {
  return {
    id: fileId,
    fileId,
    fileName: name,
    fileNumber: null,
    thumbnailUrl: url,
    previewUrl: url,
    webViewUrl: null,
    downloadUrl: null,
    order: 0,
  };
}

interface StoredDraft {
  doc: CollageDoc;
  /** Computer photos the photographer added, so the picker shows them again. */
  localFiles: { fileId: string; name: string }[];
  hasBackdrop: boolean;
  hasWatermarkImage?: boolean;
  /** Which carousel slides have their own background image. */
  slideBackdrops?: boolean[];
  /** Uploaded sticker images, stored in IndexedDB under their id. */
  stickerAssets?: { id: string; name: string }[];
  savedAt: number;
}

/** An uploaded sticker image as the editor keeps it. */
export interface StickerAsset {
  id: string;
  name: string;
  url: string;
}

export function saveDraft(
  doc: CollageDoc,
  localFiles: DriveFile[],
  images: { backdrop: boolean; watermark: boolean; slides: boolean[] },
  stickerAssets: StickerAsset[] = [],
  /**
   * For the drafts list: a small picture, whose collage it is, and the name
   * the photographer gave it. `listed: false` keeps an empty collage out.
   */
  meta: { thumb?: string; title?: string; name?: string; listed?: boolean } = {},
): boolean {
  const draft: StoredDraft = {
    doc,
    localFiles: localFiles.map((f) => ({ fileId: f.fileId, name: f.fileName })),
    hasBackdrop: images.backdrop,
    hasWatermarkImage: images.watermark,
    slideBackdrops: images.slides,
    stickerAssets: stickerAssets.map(({ id, name }) => ({ id, name })),
    savedAt: Date.now(),
  };
  try {
    localStorage.setItem(docKey(), JSON.stringify(draft));
    const all = listDrafts();
    const others = all.filter((d) => d.id !== scope);
    const { listed = true, thumb, title } = meta;
    const entry: DraftEntry = {
      id: scope,
      booking: scopeBooking,
      savedAt: draft.savedAt,
      thumb,
      title,
      // A name the photographer gave stays through every save.
      name: 'name' in meta ? meta.name || undefined : all.find((d) => d.id === scope)?.name,
      // So does what the account holds of it.
      synced: all.find((d) => d.id === scope)?.synced,
    };
    // No limit: a draft leaves the list only when the photographer deletes it.
    localStorage.setItem(INDEX_KEY, JSON.stringify(listed ? [entry, ...others] : others));
    return true;
  } catch {
    // Storage full or disabled — the editor keeps working; the caller says so.
    return false;
  }
}

/** One draft in the "Kolase terakhir" list. */
export interface DraftEntry {
  /** See `setDraftScope`: a booking code or '' on older drafts, else from `newDraftId`. */
  id: string;
  /** The booking it belongs to; missing on older entries (see `draftBooking`). */
  booking?: string | null;
  savedAt: number;
  thumb?: string;
  /** The client's name, when the draft belongs to a booking. */
  title?: string;
  /** A name the photographer gave it, shown instead of the client's. */
  name?: string;
  /** The design last saved to, or opened from, the account (see `openAccountDraft`). */
  synced?: string;
}

/**
 * Where a draft's pictures come from, for the start page: pictures from this
 * computer (kept in this browser only) and photos from Google Drive (shown
 * from Drive). Unreadable: neither.
 */
export function draftSources(id: string): { local: boolean; drive: boolean } {
  try {
    const raw = localStorage.getItem(docKey(id));
    if (!raw) return { local: false, drive: false };
    const d = JSON.parse(raw) as StoredDraft;
    // Empty photo places (a template's) have no file yet.
    const photos = d.doc.slots.map((s) => s?.file?.fileId).filter((f): f is string => Boolean(f));
    return {
      local:
        photos.some((f) => f.startsWith('lokal-')) ||
        (d.stickerAssets?.length ?? 0) > 0 ||
        d.hasBackdrop ||
        Boolean(d.hasWatermarkImage),
      drive: photos.some((f) => !f.startsWith('lokal-')),
    };
  } catch {
    return { local: false, drive: false };
  }
}

/** sessionStorage: a note for the editor, after it opens onto another draft. */
export const ARRIVAL_NOTICE = 'pilihfotomu-kolase-pesan';

/** Names a draft in the list; an empty name goes back to the client's. */
export function renameDraft(id: string, name: string) {
  try {
    const trimmed = name.trim().slice(0, 60);
    const list = listDrafts().map((d) => (d.id === id ? { ...d, name: trimmed || undefined } : d));
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    // Storage full or disabled — the name just is not kept.
  }
}

/** Drafts in this browser, most recently saved first. */
export function listDrafts(): DraftEntry[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as DraftEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * How each draft got into the account, by id: saved by itself ("Simpan
 * otomatis ke akun") or on purpose. Kept in this browser, where the draft is.
 */
const ACCOUNT_WAY_KEY = 'pilihfotomu-cara-simpan-akun-v1';
type AccountWay = 'otomatis' | 'manual';
function readAccountWays(): Record<string, AccountWay> {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_WAY_KEY) ?? '{}') as Record<string, AccountWay>;
  } catch {
    return {};
  }
}
function writeAccountWays(ways: Record<string, AccountWay>) {
  try {
    localStorage.setItem(ACCOUNT_WAY_KEY, JSON.stringify(ways));
  } catch {
    // Not remembered: the account copy then stays when the draft goes.
  }
}
/** Notes how a draft reached the account. Saved on purpose once, it stays "manual". */
export function noteAccountSave(id: string, way: AccountWay) {
  const ways = readAccountWays();
  if (way === 'otomatis' && ways[id] === 'manual') return;
  writeAccountWays({ ...ways, [id]: way });
}
/** Whether the account holds this draft only because it saved itself there. */
export const savedToAccountByItself = (id: string) => readAccountWays()[id] === 'otomatis';

/**
 * Removes a draft — its document, files and list entry — and its copy in the
 * account when that copy saved itself there: it was never asked for, so it
 * goes with the draft instead of piling up. One saved on purpose stays.
 * Returns whether the account's list changed.
 */
export async function deleteDraft(id: string): Promise<boolean> {
  try {
    localStorage.removeItem(docKey(id));
    localStorage.setItem(INDEX_KEY, JSON.stringify(listDrafts().filter((d) => d.id !== id)));
  } catch {
    // Nothing to clear.
  }
  await clearFiles(id);
  const ways = readAccountWays();
  const way = ways[id];
  if (!way) return false;
  delete ways[id];
  writeAccountWays(ways);
  if (way !== 'otomatis') return false;
  try {
    return true;
  } catch {
    // Offline, or already gone: the copy stays; it can be deleted from the account list.
    return false;
  }
}

/**
 * Images the draft had but this browser no longer holds — cleared site data,
 * another browser, a private window — so the editor can say what went missing
 * instead of quietly leaving it out.
 */
export interface MissingImages {
  /** Computer photos still placed in the collage: their places stay, marked, until replaced. */
  photos: { fileId: string; name: string }[];
  backdrop: boolean;
  watermark: boolean;
  /** Carousel slides whose own background image is gone. */
  slides: number[];
  /** Uploaded images still placed as layers, by sticker id. */
  stickers: { id: string; name: string }[];
}

export interface RestoredDraft {
  doc: CollageDoc;
  localFiles: DriveFile[];
  backdrop: { url: string } | null;
  watermark: { url: string } | null;
  slideBackdrops: ({ url: string } | null)[];
  stickerAssets: StickerAsset[];
  /** Object URLs made for this restore; the caller revokes them on leave. */
  urls: string[];
  missing: MissingImages;
  savedAt: number;
}

/**
 * A stored design merged onto a fresh document, so designs from older
 * versions — drafts, account copies, shared templates — still open: missing
 * fields get their defaults, old field shapes their new ones. Photo places
 * are taken as they are (see `loadDraft` for this browser's own photos).
 */
export function normalizeDoc(stored: CollageDoc): CollageDoc {
  const draft = { doc: stored };
  const base = initialDoc();
  return {
    ...base,
    ...draft.doc,
    style: { ...base.style, ...draft.doc.style },
    backdrop: { ...base.backdrop, ...draft.doc.backdrop },
    // Older drafts had no `kind`/`text`/`custom`; their extra fields are harmless.
    watermark: { ...base.watermark, ...draft.doc.watermark },
    // Older drafts: no weight/italic/width, and a separate "serif-italic" font.
    texts: (draft.doc.texts ?? []).map((t) => {
      const legacy = t as unknown as {
        font: string;
        shadow: unknown;
        spacing?: number;
        caps?: boolean;
      };
      const wasItalicSerif = legacy.font === 'serif-italic';
      const legacyWeight: Record<string, number> = { serif: 600, rounded: 800, sans: 500 };
      return {
        ...t,
        font: wasItalicSerif ? 'serif' : t.font,
        italic: t.italic ?? wasItalicSerif,
        weight: t.weight ?? legacyWeight[legacy.font] ?? 400,
        width: t.width ?? null,
        // Caps used to bring fixed wide spacing; the shadow used to be on/off only.
        spacing: legacy.spacing ?? (legacy.caps ? 0.2 : 0),
        textCase: t.textCase ?? (legacy.caps ? 'besar' : 'asli'),
        shadow:
          typeof legacy.shadow === 'boolean'
            ? { ...DEFAULT_SHADOW, on: legacy.shadow }
            : { ...DEFAULT_SHADOW, ...t.shadow },
      };
    }),
    stickers: draft.doc.stickers ?? [],
    // Older drafts had free frames without ids.
    freeCells: (draft.doc.freeCells ?? []).map((c, i) => ({ ...c, id: c.id ?? `lama-${i}` })),
    layerOrder: draft.doc.layerOrder ?? [],
    layerMeta: draft.doc.layerMeta ?? {},
    slideBackgrounds: draft.doc.slideBackgrounds ?? [],
    slots: (draft.doc.slots ?? []).map((slot) =>
      slot ? { ...slot, rotate: slot.rotate ?? 0, flip: slot.flip ?? false } : null,
    ),
  };
}

/** Reads the draft back, rebuilding computer photos from IndexedDB. */
export async function loadDraft(): Promise<RestoredDraft | null> {
  let draft: StoredDraft;
  try {
    const raw = localStorage.getItem(docKey());
    if (!raw) return null;
    draft = JSON.parse(raw) as StoredDraft;
  } catch {
    return null;
  }

  const urls: string[] = [];
  const locals = new Map<string, DriveFile>();
  const lost = new Map<string, string>();
  for (const { fileId, name } of draft.localFiles ?? []) {
    const blob = await getFile(fileId);
    if (!blob) {
      lost.set(fileId, name);
      continue;
    }
    const url = URL.createObjectURL(blob);
    urls.push(url);
    locals.set(fileId, localDriveFile(fileId, name, url));
  }

  // Merge onto a fresh document so drafts from older versions still open.
  const base = initialDoc();
  const doc: CollageDoc = {
    ...normalizeDoc(draft.doc),
    slots: Array.from(
      { length: Math.max(base.slots.length, draft.doc.slots?.length ?? 0) },
      (_, i) => {
        const slot = draft.doc.slots?.[i];
        if (!slot) return null;
        // Older drafts predate rotate/flip.
        const withDefaults = { ...slot, rotate: slot.rotate ?? 0, flip: slot.flip ?? false };
        if (!slot.file.fileId.startsWith('lokal-')) return withDefaults;
        const local = locals.get(slot.file.fileId);
        if (local) return { ...withDefaults, file: local };
        // A computer photo whose file is gone keeps its place, with nothing to
        // load, so the editor can mark it as missing until another is chosen.
        if (!lost.has(slot.file.fileId)) lost.set(slot.file.fileId, slot.file.fileName);
        return { ...withDefaults, file: { ...slot.file, thumbnailUrl: null, previewUrl: null } };
      },
    ),
  };

  const restoreFile = async (key: string) => {
    const blob = await getFile(key);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.push(url);
    return { url };
  };
  const backdrop = draft.hasBackdrop ? await restoreFile(BACKDROP_KEY) : null;
  const watermark = draft.hasWatermarkImage ? await restoreFile(WATERMARK_KEY) : null;
  const stickerAssets: StickerAsset[] = [];
  const lostStickers: { id: string; name: string }[] = [];
  for (const { id, name } of draft.stickerAssets ?? []) {
    const file = await restoreFile(id);
    if (file) stickerAssets.push({ id, name, url: file.url });
    else lostStickers.push({ id, name });
  }
  const slideBackdrops = await Promise.all(
    (draft.slideBackdrops ?? []).map((has, i) => (has ? restoreFile(slideBackdropKey(i)) : null)),
  );
  // Only what the collage still uses counts: a photo left in the picker, or an
  // image no longer on the canvas, is not worth a warning.
  const placed = new Set(doc.slots.map((s) => s?.file.fileId));
  const onCanvas = new Set(doc.stickers.map((s) => s.sticker));
  const missing: MissingImages = {
    photos: [...lost].filter(([id]) => placed.has(id)).map(([fileId, name]) => ({ fileId, name })),
    backdrop: Boolean(draft.hasBackdrop && !backdrop),
    watermark: Boolean(draft.hasWatermarkImage && !watermark && doc.watermark.kind === 'gambar'),
    slides: slideBackdrops.flatMap((b, i) => (draft.slideBackdrops?.[i] && !b ? [i] : [])),
    stickers: lostStickers.filter((s) => onCanvas.has(s.id)),
  };

  return {
    doc,
    localFiles: [...locals.values()],
    backdrop,
    watermark,
    slideBackdrops,
    stickerAssets,
    urls,
    missing,
    savedAt: draft.savedAt,
  };
}

// ── Keeping drafts safe: persistence, space, copies, backup files ──

/**
 * Asks the browser to keep this site's storage even when the disk runs low
 * (and, in Safari, after a week without a visit). Chrome and Edge decide on
 * their own, without asking; Firefox asks the photographer once. True when kept.
 */
export async function keepStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export interface StorageStatus {
  /** Bytes this site uses, and may use — as the browser estimates them. */
  used: number;
  quota: number;
  /** Whether the browser promised to keep it (see `keepStorage`). */
  kept: boolean;
}

export async function storageStatus(): Promise<StorageStatus | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const [{ usage = 0, quota = 0 }, kept] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted?.() ?? Promise.resolve(false),
    ]);
    return { used: usage, quota, kept };
  } catch {
    return null;
  }
}

/** A draft's stored files, by their key within the draft. */
async function filesOf(id: string): Promise<Map<string, Blob>> {
  const files = new Map<string, Blob>();
  const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
  for (const k of keys) {
    if (typeof k !== 'string' || !inScope(k, id)) continue;
    const blob = await tx<Blob | undefined>(
      'readonly',
      (s) => s.get(k) as IDBRequest<Blob | undefined>,
    );
    if (blob) files.set(id ? k.slice(id.length + 1) : k, blob);
  }
  return files;
}

/** Writes a draft under a new id: its document, its files, and its place in the list. */
async function addDraft(
  raw: string,
  entry: Omit<DraftEntry, 'id'>,
  files: Map<string, Blob>,
): Promise<string> {
  const id = newDraftId();
  for (const [key, blob] of files) await tx('readwrite', (s) => s.put(blob, keyIn(id, key)));
  localStorage.setItem(docKey(id), raw);
  localStorage.setItem(INDEX_KEY, JSON.stringify([{ ...entry, id }, ...listDrafts()]));
  return id;
}

/** A copy of a draft — photos and all — named after it, first in the list. */
export async function duplicateDraft(id: string): Promise<string | null> {
  const raw = localStorage.getItem(docKey(id));
  const entry = listDrafts().find((d) => d.id === id);
  if (!raw || !entry) return null;
  const booking = draftBooking(entry);
  const base = entry.name ?? entry.title ?? (booking ? `Booking ${booking}` : 'Desain');
  return addDraft(
    raw,
    { ...entry, booking, name: `${base} (salinan)`, savedAt: Date.now(), synced: undefined },
    await filesOf(id),
  );
}

/** What a backup file is, so a file of anything else is refused plainly. */
const BACKUP_KIND = 'pilihfotomu-kolase';
const BACKUP_VERSION = 1;
export const BACKUP_EXTENSION = '.kolase';

interface BackupManifest {
  kind: typeof BACKUP_KIND;
  version: number;
  drafts: { entry: DraftEntry; doc: string; files: string[] }[];
}

/**
 * Drafts as one file to keep elsewhere or open in another browser: each
 * draft's document with its computer photos, background, logo and images.
 * Drive photos stay links — they load from Drive wherever the file is opened.
 */
export async function backupDrafts(ids: string[]): Promise<Blob> {
  const entries = listDrafts();
  const manifest: BackupManifest = { kind: BACKUP_KIND, version: BACKUP_VERSION, drafts: [] };
  const zipped: { name: string; blob: Blob }[] = [];
  for (const [i, id] of ids.entries()) {
    const doc = localStorage.getItem(docKey(id));
    const entry = entries.find((d) => d.id === id);
    if (!doc || !entry) continue;
    const files = await filesOf(id);
    manifest.drafts.push({
      entry: { ...entry, booking: draftBooking(entry) },
      doc,
      files: [...files.keys()],
    });
    for (const [key, blob] of files) zipped.push({ name: `${i}/${key}`, blob });
  }
  const json = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  return makeZip([{ name: 'kolase.json', blob: json }, ...zipped]);
}

/**
 * Adds the drafts in a backup file as new drafts — never over the ones here,
 * so opening the same file twice just gives two copies. Returns how many.
 */
/** How a restore went: drafts added, and which came back without some pictures. */
export interface RestoreResult {
  count: number;
  /** The drafts added, in the file's order. */
  ids: string[];
  /**
   * Drafts whose backup lacks pictures they use — gone from the browser before
   * it was backed up. `photos` are computer photos; `images` the background,
   * logo and placed images. Drive photos are links and are checked when opened.
   */
  incomplete: { name: string; photos: number; images: number }[];
}

/** What a draft uses that is not among `has` — see `RestoreResult.incomplete`. */
function lacking(raw: string, has: (key: string) => boolean): { photos: number; images: number } {
  let draft: StoredDraft;
  try {
    draft = JSON.parse(raw) as StoredDraft;
  } catch {
    return { photos: 0, images: 0 };
  }
  const doc = draft.doc;
  const photos = new Set(
    (doc.slots ?? []).flatMap((slot) =>
      slot && slot.file.fileId.startsWith('lokal-') && !has(slot.file.fileId)
        ? [slot.file.fileId]
        : [],
    ),
  ).size;
  const onCanvas = new Set((doc.stickers ?? []).map((st) => st.sticker));
  const images = [
    draft.hasBackdrop && !has(BACKDROP_KEY),
    draft.hasWatermarkImage && doc.watermark?.kind === 'gambar' && !has(WATERMARK_KEY),
    ...(draft.slideBackdrops ?? []).map((on, i) => on && !has(slideBackdropKey(i))),
    ...(draft.stickerAssets ?? []).map(({ id }) => onCanvas.has(id) && !has(id)),
  ].filter(Boolean).length;
  return { photos, images };
}

export async function restoreBackup(file: Blob): Promise<RestoreResult> {
  let zip: Map<string, Blob>;
  let manifest: BackupManifest;
  try {
    zip = await readZip(file);
    manifest = JSON.parse(await (zip.get('kolase.json')?.text() ?? '')) as BackupManifest;
  } catch {
    throw new Error('File ini bukan cadangan desain.');
  }
  if (manifest.kind !== BACKUP_KIND) throw new Error('File ini bukan cadangan desain.');
  if (manifest.version > BACKUP_VERSION) {
    throw new Error(
      'Cadangan ini dibuat versi yang lebih baru. Muat ulang halaman, lalu coba lagi.',
    );
  }
  // An image missing from the backup but still in Gambarmu comes back from there.
  const library = new Set((await listLibrary().catch(() => [])).map((l) => l.id));
  const incomplete: RestoreResult['incomplete'] = [];
  const ids: string[] = [];
  // Oldest first, so the list ends up in the order the file had.
  const drafts = manifest.drafts.map((d, i) => ({ ...d, i })).reverse();
  for (const { entry, doc, files, i } of drafts) {
    const blobs = new Map<string, Blob>();
    for (const key of files) {
      const blob = zip.get(`${i}/${key}`);
      if (blob) blobs.set(key, blob);
    }
    ids.unshift(await addDraft(doc, { ...entry, savedAt: entry.savedAt || Date.now() }, blobs));
    const lack = lacking(doc, (key) => blobs.has(key) || library.has(key));
    if (lack.photos || lack.images) {
      const booking = draftBooking(entry);
      const name = entry.name ?? entry.title ?? (booking ? `Booking ${booking}` : 'Tanpa booking');
      incomplete.unshift({ name, ...lack });
    }
  }
  return { count: drafts.length, ids, incomplete };
}

/**
 * Every draft in this browser, with all their files — the list, each
 * document, and any left behind without an entry. Backup files already
 * downloaded are the photographer's own and stay where they are.
 */
/** What the drafts take: their documents (this browser's storage) and their pictures. */
export async function draftsBytes(): Promise<number> {
  let n = 0;
  try {
    for (const k of Object.keys(localStorage)) {
      if (k === DOC_KEY || k.startsWith(`${DOC_KEY}:`) || k === INDEX_KEY) {
        n += (localStorage.getItem(k)?.length ?? 0) * 2;
      }
    }
  } catch {
    // Unreadable: counted as nothing.
  }
  const files = await tx<unknown[]>('readonly', (s) => s.getAll()).catch(() => [] as unknown[]);
  return n + byteSize(files);
}

/** Every text in every draft's document — the ids of what the drafts still use. */
export function draftTexts(): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.add(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  try {
    for (const k of Object.keys(localStorage)) {
      if (k !== DOC_KEY && !k.startsWith(`${DOC_KEY}:`)) continue;
      walk(JSON.parse(localStorage.getItem(k) ?? 'null'));
    }
  } catch {
    // Unreadable: nothing is taken as unused on its account (see `cleanUnused`).
    out.add('*');
  }
  return out;
}

export async function deleteAllDrafts() {
  try {
    const keys = Object.keys(localStorage).filter(
      (k) => k === DOC_KEY || k.startsWith(`${DOC_KEY}:`) || k === INDEX_KEY,
    );
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    // Nothing to clear.
  }
  await tx('readwrite', (s) => s.clear()).catch(() => undefined);
}

// ── The copy in the account: the design only ──

/** A picture's own address: meaningless on another computer, and never sent to the server. */
const PICTURE_URL = /^(blob:|data:[\w.+-]+\/[\w.+-]+[;,])/;
const withoutPictures = (_key: string, value: unknown) =>
  typeof value === 'string' && PICTURE_URL.test(value) ? null : value;

/**
 * A draft's design, to keep in the account: text only — layout, words,
 * positions, and photos as references (a Drive file, a computer photo's name).
 * No picture goes along; null when the draft is not in this browser.
 */
export function draftDocument(id: string): string | null {
  try {
    const raw = localStorage.getItem(docKey(id));
    return raw ? JSON.stringify(JSON.parse(raw), withoutPictures) : null;
  } catch {
    return null;
  }
}

/** The pictures a design uses that only this browser holds: they stay behind when it travels. */
export const browserPictures = (document: string) => lacking(document, () => false);

/**
 * A design's fingerprint: its document with keys in order and picture
 * addresses left out, so the same design matches wherever it was saved —
 * however often, and whenever, the editor wrote it.
 */
function designHash(doc: unknown): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canon)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canon((v as Record<string, unknown>)[k])]),
          )
        : typeof v === 'string' && PICTURE_URL.test(v)
          ? null
          : v;
  const text = JSON.stringify(canon(doc)) ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(36)}-${text.length.toString(36)}`;
}

const docOf = (raw: string): unknown => {
  try {
    return (JSON.parse(raw) as StoredDraft).doc;
  } catch {
    return null;
  }
};

/** Whether the account already holds this draft's design as it is now (saved there, unchanged since). */
export function isAccountSynced(id: string): boolean {
  try {
    const entry = listDrafts().find((d) => d.id === id);
    const raw = localStorage.getItem(docKey(id));
    return Boolean(entry?.synced && raw && designHash(docOf(raw)) === entry.synced);
  } catch {
    return false;
  }
}

/** Remembers which design the account holds for a draft — after saving it there, or opening it from there. */
export function markSynced(id: string, document: string) {
  try {
    const synced = designHash(docOf(document));
    const list = listDrafts().map((d) => (d.id === id ? { ...d, synced } : d));
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    // Storage full or disabled: the next open just compares again.
  }
}

/**
 * Opens a design from the account as the draft it was saved from.
 *
 * Not in this browser: it comes in as a draft of its own (same id), its
 * computer pictures marked missing until replaced. In this browser, its
 * pictures are still here, and what happens depends on which side changed
 * since they last matched (`DraftEntry.synced`):
 * - the same design, or only this browser's changed → this browser's opens;
 * - only the account's changed → it replaces the one here;
 * - both changed → nothing is lost: this browser's stays, and the account's
 *   opens as a copy beside it (`copy: true`), pictures and all.
 */
export async function openAccountDraft(
  id: string,
  document: string,
  meta: { name: string; bookingCode: string | null },
): Promise<{ id: string; copy: boolean }> {
  const cloud = JSON.parse(document) as StoredDraft;
  const cloudHash = designHash(cloud.doc);
  const entry = listDrafts().find((d) => d.id === id);
  const here = localStorage.getItem(docKey(id));
  const savedAt = Date.now();
  if (here && entry) {
    const localHash = designHash(docOf(here));
    const cloudChanged = cloudHash !== localHash && cloudHash !== entry.synced;
    const localChanged = localHash !== entry.synced;
    if (!cloudChanged) {
      if (localHash === cloudHash) markSynced(id, document);
      return { id, copy: false };
    }
    if (localChanged) {
      const copy = await addDraft(
        JSON.stringify({ ...cloud, savedAt }),
        { booking: meta.bookingCode, savedAt, name: `${meta.name} (dari akun)`, synced: cloudHash },
        await filesOf(id),
      );
      return { id: copy, copy: true };
    }
  }
  localStorage.setItem(docKey(id), JSON.stringify({ ...cloud, savedAt }));
  const others = listDrafts().filter((d) => d.id !== id);
  const next: DraftEntry = entry
    ? { ...entry, savedAt, synced: cloudHash }
    : { id, booking: meta.bookingCode, savedAt, name: meta.name, synced: cloudHash };
  localStorage.setItem(INDEX_KEY, JSON.stringify([next, ...others]));
  return { id, copy: false };
}

/** Forget the draft and every stored file — "Mulai baru". */
/** Clears the current draft. */
export const clearDraft = () => deleteDraft(scope);
