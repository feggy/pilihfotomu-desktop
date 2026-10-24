import { byteSize } from './byte-size';
import { listDesigns } from './designs';
import { draftTexts, draftsBytes, libraryIdOfLocal } from './draft';
import { listLibrary } from './library';
import { deleteEntry, storeEntries } from './lut-store';

/**
 * What Ruang Kreasi keeps in this browser, by kind, in bytes — to say what the
 * space is taken by. `other` is the rest the browser counts for this site
 * (its own caches), none of it a design.
 */
export interface StorageUse {
  drafts: number;
  library: number;
  raws: number;
  denoised: number;
  masks: number;
  luts: number;
  designs: number;
  /** Kept but used by nothing any more (see `cleanUnused`). */
  unused: number;
}

/**
 * What the drafts, Gambar and Template saya still use: every text in them —
 * a denoise's or a subject mask's id, a photo's — and Gambar's own pictures
 * (a RAW is kept under its picture's id). Null when a draft cannot be read:
 * then nothing counts as unused.
 */
async function stillUsed(): Promise<Set<string> | null> {
  const used = draftTexts();
  if (used.has('*')) return null;
  // A photo in a draft is its Gambar picture under another name.
  for (const t of [...used]) if (t.startsWith('lokal-')) used.add(libraryIdOfLocal(t));
  for (const item of (await listLibrary().catch(() => null)) ?? []) used.add(item.id);
  const walk = (v: unknown) => {
    if (typeof v === 'string') used.add(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  for (const d of await listDesigns().catch(() => [])) walk(d.doc);
  return used;
}

/** The kinds tidied: AI Denoise results, subject masks and RAW files — LUTs are kept, as imported. */
const TIDIED = ['denoised', 'masks', 'raws'] as const;

export async function storageUse(): Promise<StorageUse> {
  const [drafts, library, designs, luts, ...kinds] = await Promise.all([
    draftsBytes(),
    listLibrary()
      .then(byteSize)
      .catch(() => 0),
    listDesigns()
      .then(byteSize)
      .catch(() => 0),
    storeEntries('luts').then((e) => e.reduce((n, x) => n + x.bytes, 0)),
    ...TIDIED.map((s) => storeEntries(s)),
  ]);
  const used = await stillUsed();
  const sum = (e: { key: string; bytes: number }[]) => e.reduce((n, x) => n + x.bytes, 0);
  const unused = used ? kinds.reduce((n, e) => n + sum(e.filter((x) => !used.has(x.key))), 0) : 0;
  const [denoised, masks, raws] = kinds.map(sum) as [number, number, number];
  return { drafts, library, raws, denoised, masks, luts, designs, unused };
}

/**
 * Removes what nothing uses any more: AI Denoise results and subject masks no
 * draft points to, RAW files neither Gambar nor a draft holds — left behind
 * when their draft or picture was deleted. Returns the bytes freed.
 */
export async function cleanUnused(): Promise<number> {
  const used = await stillUsed();
  if (!used) return 0;
  let freed = 0;
  for (const store of TIDIED) {
    for (const e of await storeEntries(store)) {
      if (used.has(e.key)) continue;
      await deleteEntry(store, e.key);
      freed += e.bytes;
    }
  }
  return freed;
}
