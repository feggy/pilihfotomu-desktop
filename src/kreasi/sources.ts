/**
 * Where Buat konten's photos come from: the open session, photos picked one
 * by one, or any folder — for Isi foto and for the editor's Foto panel.
 */

import { open } from '@tauri-apps/plugin-dialog';
import { useEffect } from 'react';

import { api, type Photo } from '../lib/api';
import { num } from '../lib/format';
import { t } from '../lib/i18n';
import { useApp } from '../store';
import { useKreasi, type Source, type SourcePhoto } from './store';

/**
 * The open session as a photo source: its Pilih photos (what "Buat konten
 * dari foto Dipilih" promises), or everything not skipped while nothing is
 * Pilih yet.
 */
export function sessionSource(): Source | null {
  const s = useApp.getState().session;
  if (!s) return null;
  const picks = s.photos.filter((p) => p.status === 'pick');
  const times = s.photos.map((p) => p.takenAt).filter((x): x is number => x != null);
  return {
    root: s.root,
    name: s.name,
    saveDir: s.root,
    shotAt: times.length ? Math.min(...times) : null,
    photos: (picks.length ? picks : s.photos.filter((p) => p.status !== 'reject')).map((p) => ({
      id: p.id,
      name: p.name,
      thumb: p.thumb,
      status: p.status,
      rating: p.rating,
      group: p.group,
      faces: p.faces?.map(({ x, y, w, h }) => ({ x, y, w, h })),
    })),
  };
}

const fileName = (p: Photo) => (p.raw ?? p.jpeg ?? '').split(/[\\/]/).pop() || p.stem;

/** Any folder: its photos by name, thumbnails made as they are needed. */
export async function folderSource(): Promise<Source | null> {
  const root = await open({ directory: true, title: t('Pilih folder foto') });
  if (typeof root !== 'string') return null;
  const photos = await api.scanPhotos(root);
  return {
    root,
    name: root.split(/[\\/]/).pop() || root,
    saveDir: root,
    photos: photos.map((p) => ({ id: p.id, name: fileName(p), thumb: null })),
  };
}

/** Photos picked one by one — the usual case: a template needs only a few. */
export async function filesSource(): Promise<Source | null> {
  const picked = await open({
    multiple: true,
    title: t('Pilih foto##isi'),
    filters: [{ name: t('Foto'), extensions: PHOTO_EXTS }],
  });
  const paths = Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : [];
  if (!paths.length) return null;
  const got = await api.openFiles(paths);
  return {
    root: got.root,
    name: t('{count} foto dipilih', { n: got.photos.length, count: num(got.photos.length) }),
    saveDir: got.dir,
    files: paths,
    photos: got.photos.map((p) => ({ id: p.id, name: fileName(p), thumb: null })),
  };
}

/**
 * Files dragged in from Finder: added to the source's photos (new ids after
 * the last), and remembered so a reopened draft finds them again.
 */
export async function addDropped(source: Source, paths: string[]): Promise<{ source: Source; added: SourcePhoto[] }> {
  const wanted = paths.filter((p) => PHOTO_EXTS.includes(p.split('.').pop()?.toLowerCase() ?? ''));
  if (!wanted.length) throw new Error(t('File yang diseret bukan foto RAW atau JPEG.'));
  const got = await api.addFiles(source.root, wanted);
  const known = new Set(source.photos.map((p) => p.id));
  const fresh = got.filter((p) => !known.has(p.id)).map((p) => ({ id: p.id, name: fileName(p), thumb: null }));
  const added = got.map((p) => source.photos.find((x) => x.id === p.id) ?? fresh.find((x) => x.id === p.id)!);
  return {
    source: { ...source, photos: [...source.photos, ...fresh], added: [...(source.added ?? []), ...wanted.filter((w) => !source.added?.includes(w))] },
    added,
  };
}

/** What the file picker offers: JPEG and the RAW kinds the scanner reads (src-tauri/src/scan.rs). */
export const PHOTO_EXTS = ['jpg', 'jpeg', 'cr3', 'cr2', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'dng', 'pef', 'srw', '3fr', 'iiq', 'x3f'];

/** Folder sources have no thumbnails yet: makes them, a page at a time. */
export function useSourceThumbs(source: Source | null) {
  useEffect(() => {
    if (!source || source.photos.every((p) => p.thumb)) return;
    let alive = true;
    (async () => {
      const missing = source.photos.filter((p) => !p.thumb).map((p) => p.id);
      for (let i = 0; i < missing.length && alive; i += 48) {
        const got = await api.thumbnails(source.root, missing.slice(i, i + 48)).catch(() => ({}) as Record<number, string | null>);
        if (!alive) return;
        useKreasi.setState(({ source: s }) =>
          s ? { source: { ...s, photos: s.photos.map((p) => (got[p.id] ? { ...p, thumb: got[p.id] } : p)) } } : {},
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [source?.root, source?.photos.length]);

}
