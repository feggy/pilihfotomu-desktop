/**
 * Edit foto's picture: the photo's 2048 px preview developed on the GPU with
 * its settings (kreasi/engine/develop.ts), turned and cropped (geometry.ts),
 * as it is or split before | after. In the crop tool the whole straightened
 * frame shows, with the crop drawn over it to drag. The white balance
 * pipette reads the photo as it came, under the pointer.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { convertFileSrc } from '@tauri-apps/api/core';

import { cx } from '../components/ui';
import { api } from '../lib/api';
import { t } from '../lib/i18n';
import { previewUrl, useBox } from '../kreasi/canvas';
import { shownAdjust } from '../kreasi/engine/document';
import { developed } from '../kreasi/engine/develop';
import { drawAdjustOverlays } from '../kreasi/engine/render';
import { loadLocalImage } from '../kreasi/kit';
import { EYEDROPPER } from './cursors';
import { depthOf, type DepthMap } from './lens-blur';
import { shotLens, type ShotLens } from './lens-profile';
import { cleanedImage, prepared } from './source';
import { NO_GEOMETRY, coverScale, cropFromView, cropToView, drawGeometry, frameSize, outputSize, type EditSettings, type Geometry } from './geometry';

export type ViewMode = 'after' | 'split' | 'before';

/** How long a click's (or Z's) zoom takes. */
const GLIDE_MS = 220;

/** Room round the frame in the crop tool (CSS px), for a turned photo's corners and for turning. */
const CROP_ROOM = 64;

/** What part of the photo is on screen, as shares of it; `aspect` is the photo's width ÷ height as shown. */
export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
  aspect: number;
}

/** Full-size pictures read for zooming in, the last few kept. */
const fulls = new Map<string, Promise<HTMLImageElement>>();
function loadFull(root: string, id: number): Promise<HTMLImageElement> {
  const key = `${root}#${id}`;
  let p = fulls.get(key);
  if (!p) {
    p = api.fullResImage(root, id).then(async (f) => {
      const blob = await (await fetch(convertFileSrc(f.path))).blob();
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      URL.revokeObjectURL(url);
      return img;
    });
    p.catch(() => fulls.delete(key));
    fulls.set(key, p);
    if (fulls.size > 3) fulls.delete(fulls.keys().next().value!);
  }
  return p;
}

/** While a slider moves the photo is developed this large at most: it keeps up. */
const MOVING_SIDE = 1024;

/** Brightness spread of what is shown, 64 bins each of R, G and B (0–1). */
export type Histogram = [Float32Array, Float32Array, Float32Array];

type Crop = NonNullable<Geometry['crop']>;

export function EditView({
  root,
  id,
  settings,
  mode,
  moving,
  picking,
  cropping,
  masking = false,
  layer,
  zoomToggle = 0,
  placeholder,
  onViewport,
  panRef,
  ratio,
  leveling,
  onLevel,
  onPicked,
  onHistogram,
  onCrop,
  onCropDone,
  onAngle,
  onCropCommit,
  onSize,
}: {
  root: string;
  id: number;
  settings: EditSettings | undefined;
  mode: ViewMode;
  /** A control is being dragged: a quicker, smaller develop. */
  moving: boolean;
  picking: boolean;
  /** The crop tool is open: the whole frame, the crop over it. */
  cropping: boolean;
  /** Masking: the photo whole and upright, `layer` over it. */
  masking?: boolean;
  layer?: React.ReactNode;
  /** The photo's thumbnail, shown while it loads. */
  placeholder?: string;
  /** Changes when Z is pressed: to 1:1 (the full-size photo, a pixel of it to a pixel of the screen), or back to fit. */
  zoomToggle?: number;
  /** The part of the photo in view while zoomed (shares of it), and its shape; null when all of it shows. */
  onViewport?: (v: Viewport | null) => void;
  /** Filled with a way to move the view: centred on (x, y), shares of the photo (the Navigator's box). */
  panRef?: React.MutableRefObject<((x: number, y: number) => void) | null>;
  /** Crop shape kept while dragging (width ÷ height of the frame's pixels); null is free. */
  ratio: number | null;
  /** "Tarik garis": a line drawn on the photo gives how far it leans. */
  leveling: boolean;
  /** The line drawn leans this many degrees (clockwise) from level or upright. */
  onLevel: (degrees: number) => void;
  /** The color (sRGB 0–255) the pipette was clicked on. */
  onPicked: (rgb: [number, number, number]) => void;
  onHistogram: (h: Histogram | null) => void;
  onCrop: (c: Crop) => void;
  onCropDone: () => void;
  /** Turned by dragging outside the crop (degrees, live). */
  onAngle?: (deg: number) => void;
  /** Double-click inside the crop: done. */
  onCropCommit?: () => void;
  /** The photo's own size, once read (for the crop's ratios). */
  onSize?: (w: number, h: number) => void;
}) {
  const [boxRef, box] = useBox<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  /** The first frame of this photo is on screen (until then, the thumbnail and a spinner). */
  const [drawn, setDrawn] = useState(false);
  const [split, setSplit] = useState(0.5);
  const g = masking ? NO_GEOMETRY : (settings?.geometry ?? NO_GEOMETRY);

  useEffect(() => {
    let alive = true;
    setImg(null);
    setFailed(false);
    setDrawn(false);
    previewUrl(root, id)
      .then(loadLocalImage)
      .then(
        (i) => {
          if (!alive) return;
          setImg(i);
          onSize?.(i.naturalWidth, i.naturalHeight);
        },
        () => alive && setFailed(true),
      );
    return () => {
      alive = false;
    };
  }, [root, id]);

  // Zoom: 1 fits the photo in; more is bigger (pinch, ⌘/ctrl-scroll, Z, a click).
  // While masking or removing it zooms too, but a click or drag is the brush's:
  // there it moves round with two fingers (scroll) or the Navigator.
  const [scale, setScale] = useState(1);
  const zoomable = !cropping;
  const zoomed = zoomable && scale > 1.001;
  useEffect(() => {
    // Another photo: back to fit, and a glide under way dropped.
    window.clearTimeout(gliding.current);
    setScale(1);
  }, [root, id]);

  // The full-size photo, read once the preview isn't sharp enough (a RAW takes a moment).
  const [full, setFull] = useState<HTMLImageElement | null>(null);
  useEffect(() => setFull(null), [root, id]);

  const dpr = window.devicePixelRatio || 1;
  // The fitted size, from the preview: zooming scales it.
  const pw = img?.naturalWidth ?? 1;
  const ph = img?.naturalHeight ?? 1;
  const base = (() => {
    if (!img || !box.w || !box.h) return null;
    const out = cropping ? frameSize(pw, ph, g) : outputSize(pw, ph, g);
    const m = cropping ? 72 : 48;
    const k = Math.min((box.w - m) / out.w, (box.h - m) / out.h);
    return { w: Math.round(out.w * k), h: Math.round(out.h * k), outW: out.w };
  })();
  const s = zoomable ? scale : 1;
  const needFull = !!base && base.w * s * dpr > base.outW * 1.05;
  useEffect(() => {
    if (!needFull || full) return;
    let alive = true;
    loadFull(root, id).then((f) => alive && setFull(f), () => {});
    return () => {
      alive = false;
    };
  }, [needFull, full, root, id]);
  const pic = needFull && full ? full : img;
  // AI Denoise's cleaned copy, at the size being shown.
  const [clean, setClean] = useState<HTMLImageElement | null>(null);
  const denoising = (settings?.aiDenoise?.amount ?? 0) > 0;
  const bigClean = needFull && !!full;
  useEffect(() => {
    setClean(null);
    if (!denoising) return;
    let alive = true;
    cleanedImage(root, id, bigClean).then((c) => alive && setClean(c), () => {});
    return () => {
      alive = false;
    };
  }, [denoising, bigClean, root, id]);

  // Lens Blur's depth, read once it is used.
  const [depth, setDepth] = useState<DepthMap | null>(null);
  const blurring = (settings?.lensBlur?.amount ?? 0) > 0;
  useEffect(() => {
    if (!blurring) return;
    let alive = true;
    depthOf(root, id).then((d) => alive && setDepth(d), () => {});
    return () => {
      alive = false;
    };
  }, [blurring, root, id]);
  useEffect(() => setDepth(null), [root, id]);

  const iw = pic?.naturalWidth ?? 1;
  const ih = pic?.naturalHeight ?? 1;
  const shown = cropping ? frameSize(iw, ih, g) : outputSize(iw, ih, g);
  // On screen (CSS px); the canvas holds no more pixels than the photo has.
  const fit = base ? { w: Math.round(base.w * s), h: Math.round(base.h * s) } : null;
  const backing = fit ? Math.min(1, shown.w / (fit.w * dpr)) * dpr : dpr;
  /** 1:1 — a pixel of the full-size photo to a pixel of the screen (an estimate until it is read). */
  const oneToOne = () => (base ? Math.max(2, (full ? (cropping ? frameSize(full.naturalWidth, full.naturalHeight, g) : outputSize(full.naturalWidth, full.naturalHeight, g)).w : base.outW * 3) / (dpr * base.w)) : 2);
  const maxScale = () => oneToOne() * 2;

  useEffect(() => {
    const c = canvas.current;
    const img = pic;
    if (!c || !img || !fit) return;
    // Cropping: room round the frame, so a turned photo's corners show.
    const m = cropping ? Math.round(CROP_ROOM * backing) : 0;
    const w = Math.max(1, Math.round(fit.w * backing));
    const h = Math.max(1, Math.round(fit.h * backing));
    c.width = w + 2 * m;
    c.height = h + 2 * m;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(m, m);
    const a = shownAdjust(settings);
    const draw = (src: CanvasImageSource) => drawGeometry(ctx, src, iw, ih, g, w, h, cropping);
    ctx.clearRect(-m, -m, c.width, c.height);
    if (mode === 'before') draw(img);
    else {
      // What was removed is filled in first, then the whole is developed.
      const base = prepared(img, iw, ih, settings, denoising ? clean : null, blurring ? depth : null);
      const dev = developed(base, a, moving ? MOVING_SIDE : undefined);
      draw(dev ?? base);
      drawAdjustOverlays(ctx, { x: 0, y: 0, w, h }, a, !!dev);
    }
    if (!moving && !cropping && !zoomed) onHistogram(histogramOf(c));
    setDrawn(true);
    if (mode === 'split' && !cropping) {
      // The photo as it came, on the left of the line.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, w * split, h);
      ctx.clip();
      draw(img);
      ctx.restore();
    }
  }, [pic, clean, depth, settings, mode, split, moving, cropping, masking, fit?.w, fit?.h, backing]);

  // Zooming keeps the point under the pointer (or fingers) where it is.
  const scroller = useRef<HTMLDivElement>(null);
  const photoBox = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);
  const scaleRef = useRef(scale);
  const zoomTo = (next: number, cx?: number, cy?: number) => {
    const r = photoBox.current?.getBoundingClientRect();
    const el = scroller.current?.getBoundingClientRect();
    if (!r || !el) return;
    const px = cx ?? el.left + el.width / 2;
    const py = cy ?? el.top + el.height / 2;
    // Several pinch steps can come before the next draw: each from the last.
    if (!anchor.current) anchor.current = { fx: (px - r.left) / r.width, fy: (py - r.top) / r.height, cx: px, cy: py };
    const v = Math.min(maxScale(), Math.max(1, next));
    scaleRef.current = v;
    setScale(v);
  };
  // A glide or pinch keeps its on-screen scale until the new size is laid out
  // (here, before the browser paints): dropped earlier, the photo would show
  // a frame at its old size — a flicker as the zoom lands.
  const held = useRef(false);
  const unhold = () => {
    const box = photoBox.current;
    held.current = false;
    if (!box) return;
    box.style.transition = '';
    box.style.transform = '';
    box.style.willChange = '';
  };
  useLayoutEffect(() => {
    if (held.current) unhold();
    const a = anchor.current;
    const el = scroller.current;
    const r = photoBox.current?.getBoundingClientRect();
    if (!a || !el || !r) return;
    el.scrollLeft += r.left + a.fx * r.width - a.cx;
    el.scrollTop += r.top + a.fy * r.height - a.cy;
    anchor.current = null;
  }, [fit?.w, fit?.h]);
  // A new scale that rounds to the same size lays nothing out: let go of the hold anyway.
  useLayoutEffect(() => {
    if (held.current) unhold();
  }, [scale]);

  /**
   * A click or Z: the zoom glides there (scaled on screen, as a pinch is),
   * ending where the scroller will put the photo — centred while smaller
   * than the view, never leaving a gap when larger — then is drawn sharp.
   */
  const gliding = useRef(0);
  const glide = (next: number, cx?: number, cy?: number) => {
    const box = photoBox.current;
    const el = scroller.current;
    if (!box || !el) return zoomTo(next, cx, cy);
    window.clearTimeout(gliding.current);
    const r = box.getBoundingClientRect();
    const v = el.getBoundingClientRect();
    const to = Math.min(maxScale(), Math.max(1, next));
    const px = cx ?? v.left + v.width / 2;
    const py = cy ?? v.top + v.height / 2;
    const k = to / scaleRef.current;
    const w = r.width * k;
    const h = r.height * k;
    const place = (at: number, size: number, lo: number, span: number) =>
      size <= span ? lo + (span - size) / 2 : Math.min(lo, Math.max(lo + span - size, at));
    const left = place(px - (px - r.left) * k, w, v.left, v.width);
    const top = place(py - (py - r.top) * k, h, v.top, v.height);
    box.style.transformOrigin = '0 0';
    box.style.willChange = 'transform';
    box.style.transition = `transform ${GLIDE_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1)`;
    box.style.transform = `translate(${left - r.left}px, ${top - r.top}px) scale(${k})`;
    gliding.current = window.setTimeout(() => {
      if (Math.abs(to - scaleRef.current) < 1e-6) return unhold();
      held.current = true;
      anchor.current = { fx: 0, fy: 0, cx: left, cy: top };
      scaleRef.current = to;
      setScale(to);
    }, GLIDE_MS);
  };

  // Z: 1:1 where the pointer is (the middle when it is off the photo), or back to fit.
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    if (zoomable) glide(zoomed ? 1 : oneToOne(), pointer.current?.x, pointer.current?.y);
  }, [zoomToggle]);

  // Pinch on a trackpad: WebKit's gesture events (the app's window), or a
  // wheel with ctrl held (Chrome, and ⌘/ctrl + scroll anywhere). While the
  // fingers move the picture is only scaled on screen (cheap, smooth); it is
  // drawn again at its new size once they rest.
  const live = useRef<{ from: number; to: number; rect: DOMRect; cx: number; cy: number; timer: number } | null>(null);
  const pinch = (target: number, cx: number, cy: number) => {
    const box = photoBox.current;
    if (!box) return;
    let g = live.current;
    if (!g) {
      const rect = box.getBoundingClientRect();
      g = live.current = { from: scaleRef.current, to: scaleRef.current, rect, cx, cy, timer: 0 };
      box.style.transformOrigin = `${cx - rect.left}px ${cy - rect.top}px`;
      box.style.willChange = 'transform';
    }
    g.to = Math.min(maxScale(), Math.max(1, target));
    box.style.transform = `scale(${g.to / g.from})`;
    window.clearTimeout(g.timer);
    g.timer = window.setTimeout(settle, 140);
  };
  const settle = () => {
    const g = live.current;
    const box = photoBox.current;
    live.current = null;
    if (!g || !box) return;
    // The point pinched stays where it was on the photo as drawn before.
    if (Math.abs(g.to - scaleRef.current) < 1e-6) return unhold();
    anchor.current = { fx: (g.cx - g.rect.left) / g.rect.width, fy: (g.cy - g.rect.top) / g.rect.height, cx: g.cx, cy: g.cy };
    held.current = true;
    scaleRef.current = g.to;
    setScale(g.to);
  };
  useEffect(() => {
    const el = scroller.current;
    if (!el || !zoomable) return;
    let gesturing = false;
    let start = 1;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      // WebKit sends both for one pinch: its gesture events lead.
      if (gesturing) return;
      const now = live.current?.to ?? scaleRef.current;
      pinch(now * Math.exp(-e.deltaY * 0.012), e.clientX, e.clientY);
    };
    const gStart = (e: Event) => {
      e.preventDefault();
      gesturing = true;
      start = live.current?.to ?? scaleRef.current;
    };
    const gChange = (e: Event) => {
      e.preventDefault();
      const ev = e as Event & { scale: number; clientX?: number; clientY?: number };
      // WebKit's gesture events may come without a place: then the pointer's
      // (where the fingers are), not the photo's middle.
      const v = el.getBoundingClientRect();
      const x = Number.isFinite(ev.clientX) ? ev.clientX! : (pointer.current?.x ?? v.left + v.width / 2);
      const y = Number.isFinite(ev.clientY) ? ev.clientY! : (pointer.current?.y ?? v.top + v.height / 2);
      pinch(start * ev.scale, x, y);
    };
    const gEnd = (e: Event) => {
      e.preventDefault();
      gesturing = false;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('gesturestart', gStart);
    el.addEventListener('gesturechange', gChange);
    el.addEventListener('gestureend', gEnd);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('gesturestart', gStart);
      el.removeEventListener('gesturechange', gChange);
      el.removeEventListener('gestureend', gEnd);
    };
  });

  // The Navigator's box: what is in view, told after every scroll and zoom;
  // and its drag, moving the view.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !onViewport) return;
    let frame = 0;
    const measure = () => {
      const b = photoBox.current?.getBoundingClientRect();
      const v = el.getBoundingClientRect();
      if (!b || !zoomed) return onViewport(null);
      const x0 = Math.max(0, (v.left - b.left) / b.width);
      const y0 = Math.max(0, (v.top - b.top) / b.height);
      const x1 = Math.min(1, (v.right - b.left) / b.width);
      const y1 = Math.min(1, (v.bottom - b.top) / b.height);
      onViewport({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, aspect: b.width / b.height });
    };
    // Now (zooming out clears it at once), then once a frame while scrolling.
    measure();
    const tell = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    el.addEventListener('scroll', tell);
    return () => {
      el.removeEventListener('scroll', tell);
      cancelAnimationFrame(frame);
    };
  }, [zoomed, fit?.w, fit?.h, onViewport]);
  useEffect(() => {
    if (!panRef) return;
    panRef.current = (x, y) => {
      const el = scroller.current;
      const box = photoBox.current;
      if (!el || !box || !zoomed) return;
      el.scrollLeft = box.offsetLeft + x * box.offsetWidth - el.clientWidth / 2;
      el.scrollTop = box.offsetTop + y * box.offsetHeight - el.clientHeight / 2;
    };
  });

  // Drag moves round a zoomed photo; a click zooms in there, or back out.
  /** Dragging a zoomed photo: the hand closes. */
  const [panning, setPanning] = useState(false);
  /** Space held while masking or removing: the brush steps aside, a drag moves the photo and a click zooms (Lightroom's hand). */
  const [hand, setHand] = useState(false);
  useEffect(() => {
    if (!masking) return setHand(false);
    // Typing in a field keeps its space; a slider or button just focused does not.
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement | null)?.closest('textarea, [contenteditable="true"], input:not([type=range]):not([type=checkbox]):not([type=radio])');
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e)) return;
      e.preventDefault();
      setHand(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e)) return;
      e.preventDefault();
      setHand(false);
    };
    const blur = () => setHand(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [masking]);
  const press = (e: React.PointerEvent) => {
    if (picking || !zoomable || (masking && !hand) || e.button !== 0) return;
    const el = scroller.current!;
    if (zoomed) setPanning(true);
    const start = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 4) moved = true;
      if (!zoomed) return;
      el.scrollLeft = start.l - (ev.clientX - start.x);
      el.scrollTop = start.t - (ev.clientY - start.y);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPanning(false);
      if (moved) return;
      glide(zoomed ? 1 : oneToOne(), ev.clientX, ev.clientY);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const pick = (e: React.MouseEvent) => {
    const img = pic;
    if (!picking || !img || !fit) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // The photo as it came, turned and cropped as shown, around the pointer.
    const c = document.createElement('canvas');
    c.width = fit.w;
    c.height = fit.h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    drawGeometry(ctx, img, iw, ih, g, c.width, c.height, cropping);
    const x = Math.round(e.clientX - r.left);
    const y = Math.round(e.clientY - r.top);
    const d = ctx.getImageData(Math.max(0, x - 2), Math.max(0, y - 2), 5, 5).data;
    const sum = [0, 0, 0];
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k]! += d[i + k]!;
    onPicked([sum[0]! / n, sum[1]! / n, sum[2]! / n]);
  };

  const dragLine = (e: React.PointerEvent) => {
    e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).parentElement!.parentElement!;
    const r = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => setSplit(Math.min(0.98, Math.max(0.02, (ev.clientX - r.left) / r.width)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const label = 'pointer-events-none absolute top-3 rounded bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white';
  return (
    <div ref={boxRef} className="relative flex min-h-0 flex-1 overflow-hidden">
      <div
        ref={scroller}
        onPointerDown={press}
        onPointerMove={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
        onPointerLeave={() => (pointer.current = null)}
        // The browser's own scroll anchoring would move the zoom's anchor point again.
        style={{ overflowAnchor: 'none' }}
        className={cx('no-scrollbar flex size-full', zoomed ? 'overflow-auto' : 'items-center justify-center overflow-hidden', zoomable && !picking && !masking && (zoomed ? (panning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'))}
      >
      {failed && <p className="m-auto text-sm text-faint">{t('Foto tidak bisa dibuka.')}</p>}
      {!drawn && !failed && (
        // Until the photo is drawn: its thumbnail where it will be, and a spinner.
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
          {placeholder && <img src={placeholder} alt="" className="max-h-full max-w-full object-contain opacity-60 blur-[2px]" />}
          <span className="absolute flex items-center gap-2.5 rounded-full bg-black/70 px-4 py-2 text-[13px] text-white shadow-2xl backdrop-blur">
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            {t('Memuat foto…')}
          </span>
        </div>
      )}
      {pic && fit && (
        <div ref={photoBox} className="relative m-auto shrink-0" style={{ width: fit.w, height: fit.h }} onClick={pick}>
          <canvas
            ref={canvas}
            className={cx('block shadow-2xl', cropping ? 'absolute shadow-none' : 'size-full')}
            style={
              cropping ? { inset: -CROP_ROOM, width: fit.w + 2 * CROP_ROOM, height: fit.h + 2 * CROP_ROOM } : picking ? { cursor: EYEDROPPER } : undefined
            }
          />
          {masking && layer}
          {/* Over the brush while Space is held: the press reaches the scroller and drags the photo. */}
          {hand && <div className={cx('absolute inset-0 z-20', !zoomed ? 'cursor-zoom-in' : panning ? 'cursor-grabbing' : 'cursor-grab')} />}
          {cropping && leveling && <LevelLine onLevel={onLevel} />}
          {cropping && !leveling && (
            <CropBox
              crop={g.crop ?? { x: 0, y: 0, w: 1, h: 1 }}
              scale={coverScale(shown.w, shown.h, g.angle)}
              ratio={ratio == null ? null : ratio / (shown.w / shown.h)}
              angle={g.angle}
              px={shown}
              onCrop={onCrop}
              onAngle={(deg) => onAngle?.(deg)}
              onDone={onCropDone}
              onCommit={() => onCropCommit?.()}
            />
          )}
          {!cropping && !masking && mode === 'split' && (
            <>
              <span className={cx(label, 'left-3')}>{t('Sebelum')}</span>
              <span className={cx(label, 'right-3')}>{t('Sesudah')}</span>
              <div className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-white" style={{ left: `${split * 100}%` }}>
                <button
                  type="button"
                  onPointerDown={dragLine}
                  aria-label={t('Geser pembatas sebelum dan sesudah')}
                  className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full bg-white text-xs font-bold text-black shadow-lg"
                >
                  ‹›
                </button>
              </div>
            </>
          )}
          {!cropping && mode === 'before' && <span className={cx(label, 'left-3')}>{t('Sebelum')}</span>}
        </div>
      )}
      </div>
      {needFull && !full && <span className={cx(label, 'left-3 animate-pulse')}>{t('Membaca foto ukuran penuh…')}</span>}
      {zoomed && pic === full && fit && <span className={cx(label, 'right-3')}>{Math.round((fit.w * dpr * 100) / shown.w)}%</span>}
    </div>
  );
}

/** Drawn along what should be level (or upright): how far it leans. */
function LevelLine({ onLevel }: { onLevel: (degrees: number) => void }) {
  const [line, setLine] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x0 = e.clientX - r.left;
    const y0 = e.clientY - r.top;
    let cur = { x0, y0, x1: x0, y1: y0 };
    setLine(cur);
    const move = (ev: PointerEvent) => {
      cur = { x0, y0, x1: ev.clientX - r.left, y1: ev.clientY - r.top };
      setLine(cur);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setLine(null);
      const dx = cur.x1 - cur.x0;
      const dy = cur.y1 - cur.y0;
      if (Math.hypot(dx, dy) < 12) return;
      let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      // Nearer upright than level: straighten it upright.
      if (deg > 90) deg -= 180;
      if (deg < -90) deg += 180;
      if (Math.abs(deg) > 45) deg -= Math.sign(deg) * 90;
      onLevel(deg);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="absolute inset-0 cursor-crosshair" onPointerDown={down}>
      {line && (
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
          <line x1={line.x0} y1={line.y0} x2={line.x1} y2={line.y1} stroke="var(--color-gold)" strokeWidth={2} strokeDasharray="6 4" />
        </svg>
      )}
    </div>
  );
}

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const CURSOR: Record<Handle, string> = {
  move: 'move',
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};
const MIN = 0.04;

/**
 * The crop over the whole frame, as Lightroom's: the outside dimmed, L-shaped
 * corners and edge handles, the inside to drag, and outside it the photo to
 * turn. The grid shows only while dragging — thirds while cropping, a fine
 * one while turning — and the size in pixels. `ratio` (of the box in shares,
 * not pixels) keeps its shape while a corner is dragged. Double-click: done.
 */
function CropBox({
  crop: kept,
  scale: cover,
  ratio,
  angle,
  px,
  onCrop,
  onAngle,
  onDone,
  onCommit,
}: {
  crop: Crop;
  /** `coverScale` at this angle: the crop is drawn on the photo turned at its own size. */
  scale: number;
  ratio: number | null;
  angle: number;
  /** The frame's size in pixels of the photo (for the size shown while dragging). */
  px: { w: number; h: number };
  onCrop: (c: Crop) => void;
  onAngle: (deg: number) => void;
  onDone: () => void;
  onCommit: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<'crop' | 'turn' | null>(null);
  // In the view's shares; the crop stays inside the part the turned photo covers.
  const crop = cropToView(kept, cover);
  const lo = 0.5 - 0.5 / cover;
  const hi = 0.5 + 0.5 / cover;
  const put = (c: Crop) => onCrop(cropFromView(c, cover));
  /** Outside the crop, the corner the pointer is nearest (0 top left, then clockwise): the turning cursor bends round it. */
  const [hoverOut, setHoverOut] = useState<number | null>(null);
  const inside = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    return x >= crop.x && x <= crop.x + crop.w && y >= crop.y && y <= crop.y + crop.h;
  };
  const quarter = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    const right = (e.clientX - r.left) / r.width >= crop.x + crop.w / 2;
    const below = (e.clientY - r.top) / r.height >= crop.y + crop.h / 2;
    return below ? (right ? 2 : 3) : right ? 1 : 0;
  };
  /** Outside the crop: the photo turns round the crop's middle with the pointer. */
  const turn = (e: React.PointerEvent) => {
    if (inside(e)) return;
    e.preventDefault();
    const r = box.current!.getBoundingClientRect();
    const cx = r.left + (crop.x + crop.w / 2) * r.width;
    const cy = r.top + (crop.y + crop.h / 2) * r.height;
    const a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    const from = angle;
    setDragging('turn');
    const move = (ev: PointerEvent) => {
      const a = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      let d = ((a - a0) * 180) / Math.PI;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      onAngle(Math.round(Math.max(-45, Math.min(45, from + d)) * 100) / 100);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(null);
      onDone();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const start = (e: React.PointerEvent, h: Handle) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging('crop');
    const r = box.current!.getBoundingClientRect();
    const from = { x: e.clientX, y: e.clientY, c: crop };
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - from.x) / r.width;
      const dy = (ev.clientY - from.y) / r.height;
      const c = { ...from.c };
      if (h === 'move') {
        c.x = Math.min(hi - c.w, Math.max(lo, c.x + dx));
        c.y = Math.min(hi - c.h, Math.max(lo, c.y + dy));
        return put(c);
      }
      let [x0, y0, x1, y1] = [c.x, c.y, c.x + c.w, c.y + c.h];
      if (h.includes('w')) x0 = Math.min(x1 - MIN, Math.max(lo, x0 + dx));
      if (h.includes('e')) x1 = Math.max(x0 + MIN, Math.min(hi, x1 + dx));
      if (h.includes('n')) y0 = Math.min(y1 - MIN, Math.max(lo, y0 + dy));
      if (h.includes('s')) y1 = Math.max(y0 + MIN, Math.min(hi, y1 + dy));
      if (ratio) {
        // Keep the shape: the width leads, the height follows (from the fixed side).
        let w = x1 - x0;
        let hh = w / ratio;
        const room = h.includes('n') ? y1 - lo : hi - y0;
        if (hh > room) {
          hh = room;
          w = hh * ratio;
          if (h.includes('w')) x0 = x1 - w;
          else x1 = x0 + w;
        }
        if (h === 'n' || h === 's') {
          hh = y1 - y0;
          w = Math.min(hh * ratio, hi - lo);
          const mid = (c.x + c.x + c.w) / 2;
          x0 = Math.min(hi - w, Math.max(lo, mid - w / 2));
          x1 = x0 + w;
          hh = w / ratio;
        }
        if (h.includes('n')) y0 = y1 - hh;
        else y1 = y0 + hh;
      }
      put({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragging(null);
      onDone();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const pct = (v: number) => `${v * 100}%`;
  const edges: Handle[] = ['n', 'e', 's', 'w'];
  const corners: Handle[] = ['nw', 'ne', 'se', 'sw'];
  const at: Record<Handle, [number, number]> = {
    move: [0.5, 0.5],
    nw: [0, 0],
    n: [0.5, 0],
    ne: [1, 0],
    e: [1, 0.5],
    se: [1, 1],
    s: [0.5, 1],
    sw: [0, 1],
    w: [0, 0.5],
  };
  const lines = dragging === 'turn' ? 8 : dragging === 'crop' ? 3 : 0;
  return (
    // Turning reaches past the photo's edge (as Lightroom's, outside a corner):
    // the area round it catches the drag too.
    <div
      className="absolute -inset-16"
      onPointerDown={turn}
      onPointerMove={(e) => setHoverOut(inside(e) && dragging !== 'turn' ? null : quarter(e))}
      onPointerLeave={() => setHoverOut(null)}
      style={{ cursor: hoverOut != null ? ROTATE_CURSORS[hoverOut] : undefined }}
    >
    <div ref={box} className="pointer-events-none absolute inset-16">
      {/* The photo outside the crop dimmed, as Lightroom does; the ground around the photo keeps its own color in either theme. */}
      <div className="absolute inset-0 overflow-hidden">
        <span className="absolute" style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h), boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.6)' }} />
      </div>
      <div
        className="pointer-events-auto absolute border border-white/80"
        style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }}
      >
        <div className="absolute inset-0 cursor-move" onPointerDown={(e) => start(e, 'move')} onDoubleClick={onCommit}>
          {Array.from({ length: Math.max(0, lines - 1) }, (_, i) => (i + 1) / lines).map((f) => (
            <span key={f}>
              <span className="absolute inset-y-0 w-px bg-white/45" style={{ left: pct(f) }} />
              <span className="absolute inset-x-0 h-px bg-white/45" style={{ top: pct(f) }} />
            </span>
          ))}
        </div>
        {/* L-shaped corners, as Lightroom's: white edged in black, dark edged in white on the light theme (--handle in styles.css), so they show on the photo and on the ground. */}
        {corners.map((h) => {
          const [hx, hy] = at[h];
          return (
            <span
              key={h}
              onPointerDown={(e) => start(e, h)}
              className="absolute size-5 [filter:drop-shadow(0_0_1px_var(--handle-edge))_drop-shadow(0_0_1px_var(--handle-edge))]"
              style={{
                left: `calc(${pct(hx)} - ${hx ? 17 : 3}px)`,
                top: `calc(${pct(hy)} - ${hy ? 17 : 3}px)`,
                cursor: CURSOR[h],
                borderColor: 'var(--handle)',
                borderStyle: 'solid',
                borderWidth: `${hy ? 0 : 3}px ${hx ? 3 : 0}px ${hy ? 3 : 0}px ${hx ? 0 : 3}px`,
              }}
            />
          );
        })}
        {edges.map((h) => {
          const [hx, hy] = at[h];
          return (
            <span
              key={h}
              onPointerDown={(e) => start(e, h)}
              className={cx('absolute -translate-x-1/2 -translate-y-1/2 bg-[var(--handle)] [filter:drop-shadow(0_0_1px_var(--handle-edge))_drop-shadow(0_0_1px_var(--handle-edge))]', h === 'n' || h === 's' ? 'h-[3px] w-5' : 'h-5 w-[3px]')}
              style={{ left: pct(hx), top: pct(hy), cursor: CURSOR[h] }}
            />
          );
        })}
        {dragging && (
          <span className="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded bg-black/75 px-2 py-0.5 text-[11px] whitespace-nowrap text-white tabular-nums">
            {dragging === 'turn'
              ? `${angle.toFixed(2)}°`
              : `${Math.round(kept.w * px.w).toLocaleString()} × ${Math.round(kept.h * px.h).toLocaleString()} px`}
          </span>
        )}
      </div>
    </div>
    </div>
  );
}

/** Lightroom's turning cursor (outside the crop): one quarter arc with a solid arrowhead at each end, black edged in white. */
const ROTATE_ARC = '<path d="M6 16.5A11 11 0 0 1 16.5 6" fill="none" stroke-width="2"/><path d="M2.5 15h7l-3.5 5z M15 2.5v7l5-3.5z"/>';
/** The cursor for each corner: drawn for the top left, turned a quarter at a time clockwise. */
const ROTATE_CURSORS = [0, 1, 2, 3].map(
  (k) =>
    `url("data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g transform="rotate(${k * 90} 12 12)"><g stroke="white" stroke-width="3" stroke-linejoin="round" fill="white">${ROTATE_ARC.replace('stroke-width="2"', 'stroke-width="4"')}</g><g stroke="black" fill="black" stroke-linejoin="round">${ROTATE_ARC}</g></g></svg>`,
    )}") 12 12, alias`,
);

function histogramOf(c: HTMLCanvasElement): Histogram | null {
  const s = document.createElement('canvas');
  const k = Math.min(1, 200 / Math.max(c.width, c.height));
  s.width = Math.max(1, Math.round(c.width * k));
  s.height = Math.max(1, Math.round(c.height * k));
  const ctx = s.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(c, 0, 0, s.width, s.height);
  const d = ctx.getImageData(0, 0, s.width, s.height).data;
  const bins: Histogram = [new Float32Array(64), new Float32Array(64), new Float32Array(64)];
  for (let i = 0; i < d.length; i += 4) for (let k2 = 0; k2 < 3; k2++) bins[k2]![d[i + k2]! >> 2]! += 1;
  let peak = 1;
  for (const b of bins) for (let i = 1; i < 63; i++) peak = Math.max(peak, b[i]!);
  for (const b of bins) for (let i = 0; i < 64; i++) b[i] = Math.min(1, b[i]! / peak);
  return bins;
}

/** "1/200 sec", or "1.3 sec" for a long one, as Lightroom writes it. */
function shutter(s: number) {
  return s >= 0.5 ? `${Number(s.toFixed(1))} sec` : `1/${Math.round(1 / s)} sec`;
}

/**
 * The histogram as Lightroom shows it, with the shot's ISO, focal length,
 * aperture and shutter underneath. On the dark theme the channels are added
 * up like light on a dark ground (where all three meet: grey-white); on the
 * light theme they are laid over like ink on a light one (there: grey).
 * Colors in styles.css (--hist-*).
 */
const BLEND = 'mix-blend-screen in-data-[theme=light]:mix-blend-multiply';

export function HistogramView({ h, root, photoId }: { h: Histogram | null; root?: string; photoId?: number }) {
  const W = 256;
  const H = 64;
  const [shot, setShot] = useState<ShotLens | null>(null);
  useEffect(() => {
    setShot(null);
    if (root == null || photoId == null) return;
    let alive = true;
    shotLens(root, photoId).then((s) => alive && setShot(s), () => {});
    return () => void (alive = false);
  }, [root, photoId]);
  const path = (b: Float32Array) =>
    `M0,${H} ` + Array.from(b, (v, i) => `L${((i / 63) * W).toFixed(1)},${(H - v * H * 0.94).toFixed(1)}`).join(' ') + ` L${W},${H} Z`;
  const facts = shot && [
    shot.iso ? `ISO ${Math.round(shot.iso)}` : '',
    shot.focal ? `${Number(shot.focal.toFixed(1))} mm` : '',
    shot.aperture ? `f / ${Number(shot.aperture.toFixed(1))}` : '',
    shot.exposure ? shutter(shot.exposure) : '',
  ];
  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-md border border-[var(--hist-line)] bg-[var(--hist-foot)]">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-[84px] w-full bg-[var(--hist-ground)]">
        {h && (
          <g className="isolate">
            {(['--hist-r', '--hist-g', '--hist-b'] as const).map((c, i) => (
              <path key={c} d={path(h[i as 0 | 1 | 2])} fill={`var(${c})`} className={BLEND} />
            ))}
          </g>
        )}
      </svg>
      <span className="flex h-6 items-center justify-between px-2 text-[10px] text-[var(--hist-text)] tabular-nums">
        {facts?.some(Boolean) ? facts.map((f, i) => <span key={i}>{f}</span>) : <span>&nbsp;</span>}
      </span>
    </div>
  );
}
