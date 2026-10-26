/**
 * A photo with a look on it, small: the presets' pictures (Edit foto's
 * list, Impor preset Lightroom). Made from the photo's thumbnail.
 */

import { useEffect, useState } from 'react';

import { cx } from '../components/ui';
import { thumbUrl, type PhotoEntry } from '../lib/api';
import { NO_ADJUST, shownAdjust, type PhotoAdjust } from '../kreasi/engine/document';
import { developed } from '../kreasi/engine/develop';
import { drawAdjustOverlays } from '../kreasi/engine/render';
import { loadLocalImage } from '../kreasi/kit';
import { NO_GEOMETRY, drawGeometry, outputSize, type EditSettings } from './geometry';
import { applyLook } from './looks';

/** The current photo with a preset on it, small. */
export function LookThumb({ photo, look, size = 96, className }: { photo: PhotoEntry; look: { id: string; adjust: PhotoAdjust }; size?: number; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const url = thumbUrl(photo.thumb);
    if (!url) return;
    loadLocalImage(url)
      .then((img) => {
        if (!alive) return;
        const dev = developed(img, applyLook(look.adjust, NO_ADJUST), size);
        const c = document.createElement('canvas');
        const k = size / Math.max(img.naturalWidth, img.naturalHeight);
        c.width = Math.round(img.naturalWidth * k);
        c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d')!.drawImage(dev ?? img, 0, 0, c.width, c.height);
        setSrc(c.toDataURL('image/jpeg', 0.8));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [photo.id, look.id, size]);
  return (
    <span
      className={cx('shrink-0 rounded bg-line bg-cover bg-center', className ?? 'h-8 w-11')}
      style={{ backgroundImage: src ? `url(${src})` : undefined }}
    />
  );
}


/** A photo's thumbnail as edited (light, color, crop), over the plain one in the strip. */
export function EditedThumb({ photo, settings, size = 160, delay = 250 }: { photo: PhotoEntry; settings: EditSettings; size?: number; delay?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const key = JSON.stringify(settings);
  useEffect(() => {
    let alive = true;
    const url = thumbUrl(photo.thumb);
    if (!url) return;
    // A moment after the last change: a slider moving doesn't redraw the strip each step.
    const timer = window.setTimeout(() => {
      loadLocalImage(url)
        .then((img) => {
          if (!alive) return;
          const a = shownAdjust(settings);
          const dev = developed(img, a, size);
          const g = settings.geometry ?? NO_GEOMETRY;
          const out = outputSize(img.naturalWidth, img.naturalHeight, g);
          const k = size / Math.max(out.w, out.h);
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(out.w * k));
          c.height = Math.max(1, Math.round(out.h * k));
          const ctx = c.getContext('2d')!;
          drawGeometry(ctx, dev ?? img, img.naturalWidth, img.naturalHeight, g, c.width, c.height);
          drawAdjustOverlays(ctx, { x: 0, y: 0, w: c.width, h: c.height }, a, !!dev);
          setSrc(c.toDataURL('image/jpeg', 0.8));
        })
        .catch(() => {});
    }, delay);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [photo.id, key]);
  return src ? <span className="absolute inset-0 bg-bg bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url(${src})` }} /> : null;
}
