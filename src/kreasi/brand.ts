/**
 * The studio's brand, set once (Pengaturan › Brand studio) and used in every
 * design: the name ("Nama Studio" texts, the text watermark), a logo (an
 * element, or the image watermark), house colours (first in every colour
 * picker) and a house font (first in the font list).
 */

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { IMAGE_STICKER_PREFIX } from './engine/document';

export interface Brand {
  studio: string;
  /** The logo as a data URL (PNG with transparency looks best), or none. */
  logo: string | null;
  /** Height ÷ width of the logo, for placing it as an element. */
  logoRatio: number;
  colors: string[];
  /** A `FONTS` id, or none. */
  font: string | null;
}

interface BrandState extends Brand {
  set: (patch: Partial<Brand>) => void;
}

export const MAX_BRAND_COLORS = 6;

export const useBrand = create<BrandState>()(
  persist(
    (set) => ({ studio: '', logo: null, logoRatio: 1, colors: [], font: null, set: (patch) => set(patch) }),
    { name: 'pilihfotomu-brand-v1' },
  ),
);

/** The logo placed as an element: one id, its picture comes from the brand. */
export const LOGO_STICKER = `${IMAGE_STICKER_PREFIX}brand-logo`;

let logoCache: { url: string; img: Promise<HTMLImageElement> } | null = null;

/** The logo as an image for the canvas, or null. */
export function brandLogo(): Promise<HTMLImageElement | null> {
  const url = useBrand.getState().logo;
  if (!url) return Promise.resolve(null);
  if (logoCache?.url !== url) {
    const img = new Image();
    logoCache = {
      url,
      img: new Promise((resolve, reject) => {
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      }),
    };
  }
  return logoCache.img.catch(() => null);
}

/** The logo image, re-read when the brand's logo changes. */
export function useBrandLogo(): HTMLImageElement | null {
  const url = useBrand((s) => s.logo);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let alive = true;
    brandLogo().then((i) => alive && setImg(i));
    return () => {
      alive = false;
    };
  }, [url]);
  return img;
}

/** A picked image file as a data URL plus its height ÷ width, shrunk to at most `max` px. */
export function readLogo(file: File, max = 1200): Promise<{ url: string; ratio: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        resolve({ url: c.toDataURL('image/png'), ratio: c.height / c.width });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
