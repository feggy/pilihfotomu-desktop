/**
 * The editor's Foto panel: the photos of the source, to click into the design
 * or drag onto the canvas — a new frame on an empty canvas, a photo place's
 * picture on a template.
 */

import { Folder, ImageOff, ImagePlus, Images, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';

import { cx } from '../components/ui';
import { num } from '../lib/format';
import { t } from '../lib/i18n';
import { useApp } from '../store';
import { filesSource, folderSource, useSourceThumbs } from './sources';
import { ranked, useKreasi, type SourcePhoto } from './store';
import { PhotoThumb } from './ui';

type Filter = 'pick' | 'all';

export function PhotosPanel({ onPick, hint }: { onPick: (p: SourcePhoto) => void; hint: string }) {
  const source = useKreasi((s) => s.source);
  const { setSource, setRatios } = useKreasi.getState();
  const fail = useApp((s) => s.fail);
  const [filter, setFilter] = useState<Filter>('pick');
  const [q, setQ] = useState('');
  useSourceThumbs(source);

  const isSession = !!source?.photos.some((p) => p.status);
  const photos = useMemo(() => {
    const query = q.trim().toLowerCase();
    return ranked(source?.photos ?? [])
      .filter((p) => (!isSession || filter === 'all' || p.status === 'pick') && (!query || p.name.toLowerCase().includes(query)))
      .slice(0, 400);
  }, [source, filter, q, isSession]);

  // Shapes are learned from thumbnails as they load: a new frame takes the photo's shape.
  const pending = useRef(new Map<number, number>());
  const flush = useRef<number | null>(null);
  const seen = (id: number, img: HTMLImageElement) => {
    pending.current.set(id, img.naturalWidth / Math.max(1, img.naturalHeight));
    flush.current ??= window.setTimeout(() => {
      setRatios(new Map(pending.current));
      pending.current.clear();
      flush.current = null;
    }, 150);
  };

  const change = async (how: 'files' | 'folder') => {
    try {
      const s = await (how === 'files' ? filesSource() : folderSource());
      if (s) setSource(s);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <span className="pt-2 pb-1 text-[11px] font-semibold text-faint uppercase">{t('Foto##latar')}</span>
      {source && (
        <span className="flex h-8 items-center gap-2 rounded-lg bg-panel-2 px-2.5 text-xs font-medium">
          <Images size={13} className="shrink-0 text-gold-text" /> <span className="truncate">{source.name}</span>
        </span>
      )}
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => change('files')}
          className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel-2 text-xs font-medium hover:border-faint"
        >
          <ImagePlus size={13} className="text-gold-text" /> {source ? t('Pilih foto lain') : t('Pilih foto##isi')}
        </button>
        <button
          type="button"
          onClick={() => change('folder')}
          title={t('Pilih folder foto')}
          aria-label={t('Pilih folder foto')}
          className="flex size-8 items-center justify-center rounded-lg border border-line bg-panel-2 text-muted hover:border-faint hover:text-fg"
        >
          <Folder size={13} />
        </button>
      </div>
      {source && (
        <>
          <div className="flex items-center gap-1.5">
            {isSession && (
              <div className="flex shrink-0 gap-0.5 rounded-lg bg-panel-2 p-0.5">
                {(
                  [
                    ['pick', 'Dipilih'],
                    ['all', 'Semua'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFilter(id)}
                    className={cx('h-6 rounded-md px-2 text-[11px]', filter === id ? 'bg-raised font-semibold text-fg' : 'text-muted hover:text-fg')}
                  >
                    {t(label)}
                  </button>
                ))}
              </div>
            )}
            <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-line bg-bg px-2 focus-within:border-gold">
              <Search size={12} className="shrink-0 text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Cari nama file…')} className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-faint" />
            </label>
          </div>
          <p className="text-[11px] text-faint">{hint}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {photos.map((p) => (
              <button
                key={p.id}
                type="button"
                title={p.name}
                onClick={() => onPick(p)}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-pilihfotomu-foto', String(p.id));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                className="aspect-[3/2] overflow-hidden rounded-md bg-raised hover:ring-2 hover:ring-gold"
              >
                {p.thumb ? (
                  <PhotoThumb
                    photo={p}
                    loading="lazy"
                    onLoad={(e) => p.ratio == null && seen(p.id, e.currentTarget)}
                    className="size-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <span className="flex size-full items-center justify-center text-faint">
                    <ImageOff size={14} />
                  </span>
                )}
              </button>
            ))}
          </div>
          {!photos.length && <p className="py-6 text-center text-xs text-faint">{t('Belum ada foto di sumber ini.')}</p>}
          {photos.length === 400 && <p className="text-[11px] text-faint">{t('{count} foto teratas; cari nama file untuk yang lain.', { count: num(400) })}</p>}
        </>
      )}
      {!source && <p className="text-xs text-muted">{t('Pilih foto atau folder untuk mulai mengisi desain.')}</p>}
    </div>
  );
}
