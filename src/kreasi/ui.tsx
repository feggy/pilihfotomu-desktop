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
