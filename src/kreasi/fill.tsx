import { open } from '@tauri-apps/plugin-dialog';
import { ArrowLeft, ArrowRight, Folder, ImageOff, ImagePlus, MousePointerClick, Sparkles, Star, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Switch, cx } from '../components/ui';
import { api, thumbUrl } from '../lib/api';
import { num } from '../lib/format';
import { t, tj } from '../lib/i18n';
import { useApp } from '../store';
import { DocCanvas, useBox, useDocImages } from './canvas';
import { slotShapes, formatLabel } from './kit';
import { fits, placed, ranked, useKreasi, type Source, type SourcePhoto } from './store';
import { SHAPE_LABEL, ShapeIcon, Steps } from './ui';

type Filter = 'pick' | 'five' | 'all';

/** The open session as a photo source. */
export function sessionSource(): Source | null {
  const s = useApp.getState().session;
  if (!s) return null;
  return {
    root: s.root,
    name: s.name,
    photos: s.photos.map((p) => ({
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

/** Any folder: its photos by name, thumbnails made as they are needed. */
async function folderSource(): Promise<Source | null> {
  const root = await open({ directory: true, title: t('Pilih folder foto') });
  if (typeof root !== 'string') return null;
  const photos = await api.scanPhotos(root);
  return {
    root,
    name: root.split(/[\\/]/).pop() || root,
    photos: photos.map((p) => ({ id: p.id, name: (p.raw ?? p.jpeg ?? '').split(/[\\/]/).pop() || p.stem, thumb: null })),
  };
}

/** Layar 13 · Isi foto: the template's photo places, filled from a session or folder. */
export function Fill() {
  const { doc, template, source, active } = useKreasi();
  const { setStep, setSource, setRatios, setActive, place, autoFill } = useKreasi.getState();
  const fail = useApp((s) => s.fail);
  const [filter, setFilter] = useState<Filter>('pick');
  const [onlyFit, setOnlyFit] = useState(true);
  const [stageRef, stage] = useBox<HTMLDivElement>();

  useEffect(() => {
    if (!useKreasi.getState().source) setSource(sessionSource());
  }, [setSource]);

  // Folder sources have no thumbnails yet: make them, a page at a time.
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

  // Shapes are learned from thumbnails as they load, in batches.
  const pending = useRef(new Map<number, number>());
  const flush = useRef<number | null>(null);
  const seen = (id: number, img: HTMLImageElement) => {
    pending.current.set(id, img.naturalWidth / Math.max(1, img.naturalHeight));
    if (flush.current == null)
      flush.current = window.setTimeout(() => {
        setRatios(new Map(pending.current));
        pending.current.clear();
        flush.current = null;
      }, 150);
  };

  // Learn the shape of the likeliest photos up front, not only as they scroll
  // into view — filling automatically and "pas untuk slot" depend on it.
  useEffect(() => {
    if (!source) return;
    let alive = true;
    const todo = ranked(source.photos).filter((p) => p.ratio == null && p.thumb).slice(0, 400);
    let i = 0;
    const next = () => {
      if (!alive || i >= todo.length) return;
      const p = todo[i++]!;
      const img = new Image();
      img.onload = () => (seen(p.id, img), next());
      img.onerror = next;
      img.src = thumbUrl(p.thumb)!;
    };
    for (let k = 0; k < 6; k++) next();
    return () => {
      alive = false;
    };
  }, [source?.root, source?.photos.filter((p) => p.thumb).length]);

  const shapes = useMemo(() => (doc ? slotShapes(doc) : []), [doc]);
  const filled = useMemo(() => (doc ? placed(doc) : []), [doc]);
  const want = shapes[active]?.shape ?? 'square';
  const isSession = !!source?.photos.some((p) => p.status);

  const photos = useMemo(() => {
    if (!source) return [];
    const list = ranked(source.photos).filter(
      (p) =>
        (!isSession || filter === 'all' || (filter === 'pick' ? p.status === 'pick' : p.rating === 5)) &&
        (!onlyFit || fits(p, want)),
    );
    return list;
  }, [source, filter, onlyFit, want, isSession]);

  const counts = useMemo(() => {
    const ps = source?.photos ?? [];
    return { pick: ps.filter((p) => p.status === 'pick').length, five: ps.filter((p) => p.rating === 5).length, all: ps.length };
  }, [source]);

  const images = useDocImages(doc, source?.root ?? null, false);
  if (!doc || !template) return null;
  const done = filled.filter((x) => x != null).length;
  const allDone = done === filled.length;
  const slotOf = new Map(filled.flatMap((id, i) => (id != null ? [[id, i] as const] : [])));

  const changeSource = async () => {
    try {
      const s = await folderSource();
      if (s) {
        setSource(s);
        setFilter('all');
      }
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col gap-4 px-6 pt-6 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <button type="button" onClick={() => setStep('galeri')} aria-label={t('Kembali')} className="text-muted hover:text-fg">
              <ArrowLeft size={18} />
            </button>
            <div className="flex flex-col gap-0.5">
              <h1 className="text-[22px] font-semibold">{t('Isi foto')}</h1>
              <span className="text-xs text-faint">
                {template.name} · {formatLabel(template.format)} · {t('{count} foto', { n: filled.length, count: num(filled.length) })}
              </span>
            </div>
          </div>
          <Steps at={2} onGo={(n) => n === 1 && setStep('galeri')} />
        </div>

        {source && (
          <div className="flex items-center gap-2.5 rounded-[10px] border border-gold/40 bg-gold/[0.07] px-3.5 py-2.5 text-[13px]">
            <MousePointerClick size={16} className="shrink-0 text-gold-text" />
            <span>
              {tj('Mengisi {slot} — bentuknya {shape}. Klik foto untuk mengisi, atau klik tempat lain di kanan.', {
                slot: <b className="font-semibold">{t('Foto {n}', { n: active + 1 })}</b>,
                shape: <b className="font-semibold lowercase">{t(SHAPE_LABEL[want])}</b>,
              })}
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={changeSource}
              className="flex h-[34px] items-center gap-2 rounded-[10px] border border-line bg-panel px-3 text-xs font-medium hover:border-faint"
              title={t('Ganti folder')}
            >
              <Folder size={14} className="text-gold-text" /> {source?.name ?? t('Pilih folder foto')}
            </button>
            {isSession && (
              <div className="flex gap-1 rounded-[10px] bg-panel p-[3px]">
                {(
                  [
                    ['pick', 'Dipilih', counts.pick],
                    ['five', 'Bintang 5', counts.five],
                    ['all', 'Semua', counts.all],
                  ] as const
                ).map(([id, label, n]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFilter(id)}
                    className={cx(
                      'flex h-[30px] items-center gap-1.5 rounded-lg px-3 text-xs',
                      filter === id ? 'border border-line bg-raised font-semibold text-fg' : 'font-medium text-muted hover:text-fg',
                    )}
                  >
                    {t(label)} <span className="text-[11px] font-normal text-faint">{num(n)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            {t('Hanya yang pas untuk slot')}
            <Switch label={t('Hanya yang pas untuk slot')} checked={onlyFit} onChange={setOnlyFit} />
          </label>
        </div>

        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 pb-8">
          {!source ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center text-sm text-muted">
              <ImagePlus size={28} className="text-faint" />
              {t('Pilih folder berisi foto untuk template ini.')}
              <button type="button" onClick={changeSource} className="rounded-[10px] bg-gold-gradient px-4 py-2 text-[13px] font-semibold text-white">
                {t('Pilih folder foto')}
              </button>
            </div>
          ) : photos.length === 0 ? (
            <Empty
              want={want}
              onShowAll={() => setOnlyFit(false)}
              onAll={isSession && filter !== 'all' ? () => setFilter('all') : undefined}
              onTemplate={() => setStep('galeri')}
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {photos.map((p) => (
                <PhotoTile key={p.id} photo={p} slot={slotOf.get(p.id)} onClick={() => place(active, p)} onSeen={seen} />
              ))}
            </div>
          )}
        </div>
      </section>

      <aside className="flex w-[380px] shrink-0 flex-col gap-3.5 border-l border-line-soft bg-panel p-6">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold">{template.name}</span>
          <span className="text-xs text-faint">{t('{done} dari {total} terisi', { done, total: filled.length })}</span>
        </div>
        <div ref={stageRef} className="flex h-[330px] shrink-0 items-center justify-center rounded-xl bg-panel-2 p-4">
          {stage.w > 0 && (
            <DocCanvas
              doc={doc}
              images={images}
              box={{ w: stage.w - 32, h: stage.h - 32 }}
              selection={{ kind: 'cell', index: active }}
              numbered
              handlers={{ onSelect: (s) => s?.kind === 'cell' && setActive(s.index) }}
            />
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
          {filled.map((id, i) => {
            const p = id != null ? source?.photos.find((x) => x.id === id) : null;
            const on = i === active;
            return (
              <div
                key={i}
                role="button"
                tabIndex={0}
                onClick={() => setActive(i)}
                className={cx(
                  'flex shrink-0 cursor-pointer items-center gap-3 rounded-[10px] p-2',
                  on ? 'bg-gold/[0.08] ring-1 ring-gold' : 'bg-panel-2 hover:bg-raised',
                )}
              >
                {p?.thumb ? (
                  <img src={thumbUrl(p.thumb)} alt="" className="h-[34px] w-12 rounded object-cover" />
                ) : (
                  <span className={cx('flex h-[34px] w-12 items-center justify-center rounded text-xs font-bold', on ? 'bg-gold/20 text-gold-text' : 'bg-raised text-faint')}>
                    {i + 1}
                  </span>
                )}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cx('truncate text-xs', p ? 'font-medium' : on ? 'font-semibold' : 'text-muted')}>
                    {p ? `${t('Foto {n}', { n: i + 1 })} · ${p.name}` : on ? t('Foto {n} · sedang diisi', { n: i + 1 }) : t('Foto {n} · kosong', { n: i + 1 })}
                  </span>
                  <span className="flex items-center gap-1 text-[11px] text-faint">
                    <ShapeIcon shape={shapes[i]!.shape} size={12} /> {t(SHAPE_LABEL[shapes[i]!.shape])}
                    {p?.rating ? (
                      <>
                        {' · '}
                        <Star size={10} className="fill-current" /> {p.rating}
                      </>
                    ) : null}
                  </span>
                </span>
                {p && (
                  <button
                    type="button"
                    onClick={(e) => (e.stopPropagation(), place(i, null))}
                    aria-label={t('Kosongkan')}
                    className="rounded p-1 text-faint hover:bg-line hover:text-fg"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={autoFill}
          disabled={allDone || !source}
          className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-[10px] border border-line bg-panel-2 text-[13px] font-medium hover:bg-raised disabled:opacity-40"
        >
          <Sparkles size={15} className="text-gold-text" /> {t('Isi sisanya otomatis')}
        </button>
        <p className="-mt-1.5 text-[11px] text-faint">{t('Dipilihkan dari foto Dipilih: bintang tertinggi, bentuknya pas, dan tidak dari grup burst yang sama.')}</p>
        <button
          type="button"
          onClick={() => setStep('edit')}
          disabled={done === 0}
          className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-gold-gradient text-sm font-semibold text-white disabled:opacity-45"
        >
          {t('Lanjut ke edit')} <ArrowRight size={16} />
        </button>
      </aside>
    </div>
  );
}

function PhotoTile({
  photo: p,
  slot,
  onClick,
  onSeen,
}: {
  photo: SourcePhoto;
  slot: number | undefined;
  onClick: () => void;
  onSeen: (id: number, img: HTMLImageElement) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={p.name}
      className={cx('relative aspect-[3/2] overflow-hidden rounded-lg bg-raised', slot != null ? 'ring-2 ring-gold' : 'hover:ring-1 hover:ring-line')}
    >
      {p.thumb ? (
        <img
          src={thumbUrl(p.thumb)}
          alt=""
          loading="lazy"
          onLoad={(e) => p.ratio == null && onSeen(p.id, e.currentTarget)}
          className="size-full object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-faint">
          <ImageOff size={18} />
        </span>
      )}
      {slot != null && (
        <span className="absolute top-2 left-2 flex size-[22px] items-center justify-center rounded-full bg-gold text-[11px] font-bold text-bg">
          {slot + 1}
        </span>
      )}
      {p.rating ? (
        <span className="absolute bottom-2 left-2 flex items-center gap-0.5 rounded bg-bg/85 px-1.5 py-0.5 text-[9px] font-medium">
          <Star size={9} className="fill-gold-text text-gold-text" /> {p.rating}
        </span>
      ) : null}
    </button>
  );
}

/** Layar 17d: nothing in this source has the shape the place needs. */
function Empty({
  want,
  onShowAll,
  onAll,
  onTemplate,
}: {
  want: 'portrait' | 'landscape' | 'square';
  onShowAll: () => void;
  onAll?: () => void;
  onTemplate: () => void;
}) {
  const row = (icon: React.ReactNode, title: string, sub: string, onClick: () => void, gold = false) => (
    <button
      type="button"
      onClick={onClick}
      className={cx('flex w-full items-center gap-3 rounded-[10px] p-3 text-left', gold ? 'bg-gold/[0.08] ring-1 ring-gold' : 'bg-panel-2 hover:bg-raised')}
    >
      {icon}
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium">{title}</span>
        <span className="text-[11px] text-faint">{sub}</span>
      </span>
    </button>
  );
  return (
    <div className="flex flex-col items-center gap-4 py-14 text-center">
      <span className="flex size-[72px] items-center justify-center rounded-[20px] bg-panel-2 text-faint">
        <ShapeIcon shape={want} size={30} />
      </span>
      <div className="flex flex-col gap-1.5">
        <span className="text-lg font-semibold">{t('Tidak ada foto {shape} di sini', { shape: t(SHAPE_LABEL[want]).toLowerCase() })}</span>
        <span className="text-[13px] text-muted">{t('Tempat ini butuh bentuk itu. Pilih salah satu:')}</span>
      </div>
      <div className="flex w-[420px] max-w-full flex-col gap-2">
        {row(<ImagePlus size={16} className="text-gold-text" />, t('Tampilkan semua bentuk'), t('Dipotong otomatis supaya pas di tempatnya'), onShowAll, true)}
        {onAll && row(<Folder size={16} className="text-muted" />, t('Cari di Semua'), t('Termasuk foto Cek dan Lewati'), onAll)}
        {row(<ArrowLeft size={16} className="text-muted" />, t('Ganti template'), t('Cari template dengan tempat foto lain'), onTemplate)}
      </div>
    </div>
  );
}
