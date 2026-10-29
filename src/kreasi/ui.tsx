import { Check, RectangleHorizontal, RectangleVertical, Square } from 'lucide-react';
import { Fragment, useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';

import { cx } from '../components/ui';
import { api, thumbUrl } from '../lib/api';
import { t } from '../lib/i18n';
import type { CollageDoc } from './engine/document';
import type { Shape } from './kit';
import { previewOf } from './preview';
import { useKreasi, type SourcePhoto } from './store';

const STEPS = ['Pilih template', 'Isi foto', 'Edit & ekspor'];

/** 1 Pilih template — 2 Isi foto — 3 Edit & ekspor; earlier steps can be clicked. */
export function Steps({ at, onGo, noPhotos }: { at: 1 | 2 | 3; onGo?: (step: 1 | 2 | 3) => void; noPhotos?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {STEPS.map((label, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        // A design from an empty canvas gets its photos in the editor: no Isi foto step.
        if (noPhotos && n === 2) return null;
        const shown = noPhotos && n === 3 ? 2 : n;
        const done = n < at;
        const current = n === at;
        return (
          <Fragment key={label}>
            {i > 0 && <span className="h-px w-7 bg-line" />}
            <button
              type="button"
              disabled={!done || !onGo}
              onClick={() => onGo?.(n)}
              className="flex items-center gap-2 disabled:cursor-default"
            >
              <span
                className={cx(
                  'flex size-[22px] items-center justify-center rounded-full text-[11px] font-semibold',
                  done || current ? 'bg-gold text-bg' : 'bg-raised text-faint',
                )}
              >
                {done ? <Check size={12} strokeWidth={3} /> : shown}
              </span>
              <span className={cx('text-[13px]', current ? 'font-semibold text-fg' : done ? 'font-medium text-muted' : 'font-medium text-faint')}>
                {/* A design from an empty canvas starts with its size, not a template. */}
                {t(noPhotos && n === 1 ? 'Pilih kanvas' : label)}
              </span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/** A design drawn by the engine; only once it scrolls into view. */
export function DocPicture({
  id,
  doc,
  width,
  numbered,
  className,
}: {
  id: string;
  doc: CollageDoc;
  width: number;
  numbered?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      previewOf(id, doc, width, numbered).then((s) => alive && setSrc(s), () => {});
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [id, doc, width, numbered]);
  return (
    <img
      ref={ref}
      src={src ?? undefined}
      alt=""
      draggable={false}
      className={cx('rounded-[4px] bg-raised object-contain shadow-[0_6px_20px_rgb(0_0_0/0.35)]', !src && 'animate-pulse', className)}
    />
  );
}

export const SHAPE_LABEL: Record<Shape, string> = { landscape: 'Landscape', portrait: 'Portrait', square: 'Persegi' };
export const ShapeIcon = ({ shape, size = 15, className }: { shape: Shape; size?: number; className?: string }) => {
  const I = shape === 'landscape' ? RectangleHorizontal : shape === 'portrait' ? RectangleVertical : Square;
  return <I size={size} className={className} />;
};

/**
 * A source photo's thumbnail. One whose cache file is gone (the cache was
 * cleared) is made again once and loaded afresh; nothing if that fails too.
 */
export function PhotoThumb({ photo, ...img }: { photo: SourcePhoto } & ImgHTMLAttributes<HTMLImageElement>) {
  const root = useKreasi((s) => s.source?.root);
  // 0: first try; a time: made again; -1: gave up.
  const [v, setV] = useState(0);
  if (!photo.thumb || v < 0) return null;
  const src = thumbUrl(photo.thumb);
  return (
    <img
      alt=""
      {...img}
      src={v ? `${src}?v=${v}` : src}
      onError={() => {
        if (v || !root) return setV(-1);
        api.thumbnails(root, [photo.id]).then((got) => setV(got[photo.id] ? Date.now() : -1), () => setV(-1));
      }}
    />
  );
}

/**
 * Leaving a design that was worked on: keep it under Lanjutkan desain, or
 * throw it away. Closing the window or quitting keeps it without asking.
 */
export function LeaveDialog({ onSave, onDiscard, onCancel }: { onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onSave();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-50 flex items-center justify-center bg-black/70 p-4" onMouseDown={onCancel}>
      <div role="dialog" aria-label={t('Simpan desain ini?')} onMouseDown={(e) => e.stopPropagation()} className="flex w-[400px] max-w-full flex-col gap-4 rounded-[18px] border border-line bg-panel p-6 shadow-2xl">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold">{t('Simpan desain ini?')}</h2>
          <p className="text-[13px] text-muted">{t('Disimpan di Lanjutkan desain, bisa dibuka lagi kapan saja. Kalau dihapus, desain ini hilang.')}</p>
        </div>
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={onDiscard} className="h-9 rounded-[10px] px-3 text-[13px] font-medium text-reject hover:bg-reject/10">
            {t('Hapus desain')}
          </button>
          <span className="flex gap-2">
            <button type="button" onClick={onCancel} className="h-9 rounded-[10px] px-3 text-[13px] font-medium text-muted hover:text-fg">
              {t('Batal')}
            </button>
            <button type="button" onClick={onSave} className="h-9 rounded-[10px] bg-gold-gradient px-4 text-[13px] font-semibold text-white">
              {t('Simpan')}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
