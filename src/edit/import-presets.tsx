/**
 * Impor preset Lightroom: .xmp presets from Lightroom Classic or Camera Raw
 * (files, or a folder of them), each shown on the photo being edited, ticked
 * ones kept as presets in a group. What a preset uses that doesn't come
 * across (masks, profiles, Kelvin white balance) is said, and the rest kept.
 */

import { open } from '@tauri-apps/plugin-dialog';
import { FileUp, FolderInput, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, cx } from '../components/ui';
import { api, type PhotoEntry } from '../lib/api';
import { num } from '../lib/format';
import { t, tRust } from '../lib/i18n';
import { fromXmp, type ImportedPreset } from './lightroom';
import { LookThumb } from './look-thumb';
import { useMyLooks } from './looks';

interface Found extends ImportedPreset {
  key: string;
}

const DEFAULT_GROUP = 'Diimpor dari Lightroom';

export function ImportPresetsDialog({ photo, onClose }: { photo: PhotoEntry | undefined; onClose: () => void }) {
  const addMany = useMyLooks((s) => s.addMany);
  const [source, setSource] = useState<string | null>(null);
  const [found, setFound] = useState<Found[] | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [group, setGroup] = useState(() => t(DEFAULT_GROUP));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const choose = async (folder: boolean) => {
    const picked = await open(
      folder
        ? { directory: true, title: t('Pilih folder preset Lightroom') }
        : { multiple: true, title: t('Pilih file preset Lightroom'), filters: [{ name: 'XMP', extensions: ['xmp'] }] },
    );
    const paths = Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : [];
    if (!paths.length) return;
    setError(null);
    try {
      const files = await api.readPresets(paths);
      const list: Found[] = [];
      let bad = 0;
      for (const [path, text] of files) {
        const name = path.split(/[\\/]/).pop()!.replace(/\.xmp$/i, '');
        const p = fromXmp(text, name);
        if (p) list.push({ ...p, key: path });
        else bad++;
      }
      setFound(list);
      setSkipped(bad);
      setTicked(new Set(list.map((p) => p.key)));
      setSource(folder ? paths[0]!.split(/[\\/]/).pop()! : t('{count} file', { n: paths.length, count: num(paths.length) }));
      const groups = new Set(list.map((p) => p.group).filter(Boolean));
      if (groups.size === 1) setGroup([...groups][0]!);
    } catch (e) {
      setError(tRust(String(e)));
    }
  };

  const chosen = (found ?? []).filter((p) => ticked.has(p.key));
  const partial = chosen.filter((p) => p.partial.length);
  const run = () => {
    addMany(chosen, group.trim() || t(DEFAULT_GROUP));
    onClose();
  };
  const toggle = (k: string) => setTicked((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));

  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={t('Impor preset Lightroom')}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-[640px] max-w-full flex-col gap-4 overflow-hidden rounded-[18px] border border-line bg-panel p-7 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">{t('Impor preset Lightroom')}</h2>
            <p className="text-xs text-faint">{t('File .xmp dari Lightroom Classic atau Adobe Camera Raw')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-center gap-3 rounded-xl border border-line p-3">
          <FolderInput size={18} className="shrink-0 text-gold-text" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-medium">{source ?? t('Belum ada yang dipilih')}</span>
            {found && (
              <span className="text-[11px] text-faint">
                {t('{count} preset ditemukan', { n: found.length, count: num(found.length) })}
                {skipped > 0 && ` · ${t('{count} file bukan preset', { n: skipped, count: num(skipped) })}`}
              </span>
            )}
          </span>
          <Button icon={FileUp} onClick={() => choose(false)}>
            {t('File')}
          </Button>
          <Button icon={FolderInput} onClick={() => choose(true)}>
            {t('Folder')}
          </Button>
        </div>
        {error && <p className="text-xs text-reject">{error}</p>}

        {found && found.length > 0 && (
          <>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">{photo ? t('Pratinjau di foto yang sedang dibuka') : ''}</span>
              <button
                type="button"
                onClick={() => setTicked(ticked.size === found.length ? new Set() : new Set(found.map((p) => p.key)))}
                className="font-medium text-gold-text hover:underline"
              >
                {ticked.size === found.length ? t('Lepas semua') : t('Pilih semua')}
              </button>
            </div>
            <div className="grid min-h-0 grid-cols-3 gap-3 overflow-y-auto pr-1">
              {found.map((p) => {
                const on = ticked.has(p.key);
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => toggle(p.key)}
                    aria-pressed={on}
                    title={p.partial.length ? t('Tidak ikut: {list}', { list: p.partial.join(', ') }) : p.name}
                    className={cx('flex flex-col gap-2 rounded-xl p-2 text-left', on ? 'bg-gold/[0.06] ring-1 ring-gold' : 'bg-panel-2 ring-1 ring-line-soft')}
                  >
                    {photo ? <LookThumb photo={photo} look={{ id: p.key, adjust: p.adjust }} size={200} className="aspect-[3/2] w-full" /> : null}
                    <span className="flex items-center gap-2">
                      <span className={cx('flex size-4 shrink-0 items-center justify-center rounded border text-[10px]', on ? 'border-gold bg-gold text-white' : 'border-faint')}>{on && '✓'}</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{p.name}</span>
                      {p.partial.length > 0 && <span className="rounded bg-maybe/15 px-1.5 py-px text-[10px] text-maybe">{t('Sebagian')}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {partial.length > 0 && (
              <p className="flex gap-2 rounded-[10px] bg-panel-2 p-3 text-[11px] text-faint">
                <TriangleAlert size={13} className="mt-px shrink-0 text-maybe" />
                {t('{count} preset memakai fitur Lightroom yang belum bisa dibaca (masking, profil, white balance Kelvin). Pengaturan lainnya tetap ikut — tandanya "Sebagian".', {
                  n: partial.length,
                  count: num(partial.length),
                })}
              </p>
            )}
          </>
        )}
        {found && found.length === 0 && <p className="py-6 text-center text-sm text-faint">{t('Tidak ada preset Lightroom di sini.')}</p>}

        <div className="flex items-center gap-2.5">
          <label className="mr-auto flex items-center gap-2 text-xs text-muted">
            {t('Simpan ke grup')}
            <input
              type="text"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              className="h-8 w-48 rounded-lg border border-line bg-bg px-2.5 text-xs text-fg outline-none focus:border-gold"
            />
          </label>
          <Button variant="plain" onClick={onClose}>
            {t('Batal')}
          </Button>
          <Button variant="primary" icon={FileUp} onClick={run} disabled={!chosen.length}>
            {t('Impor {count} preset', { n: chosen.length, count: num(chosen.length) })}
          </Button>
        </div>
      </div>
    </div>
  );
}
