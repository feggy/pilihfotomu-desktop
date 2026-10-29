/**
 * Edit foto › Hapus objek: what is painted over is filled in, each part on
 * its own, in order. Kept as the sweeps (shares of the photo), so it holds at
 * any size: the preview and the full-size export fill the same places.
 *
 * The fill is MI-GAN's (Rust, `inpaint_ai.rs`, on this computer): the part
 * round the marks is cut to 512 × 512, filled, and blended back. It takes a
 * moment a part (the view shows a spinner); PatchMatch
 * (kreasi/engine/inpaint.ts) fills instead if the model cannot run.
 */

import { Eraser, Minus, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button, cx } from '../components/ui';
import { num } from '../lib/format';
import { t } from '../lib/i18n';
import { api } from '../lib/api';
import { inpaint } from '../kreasi/engine/inpaint';
import { newId } from '../kreasi/engine/document';
import { ScreenRing, usePointerAt } from './cursors';
import { Slider } from './panels';
import { ToolBox, ToolRow } from './tool-box';
import type { EditSettings, HealSpot, HealStroke } from './geometry';


// ── Filling ──

const cache = new Map<string, HTMLCanvasElement>();
const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object) => {
  let id = ids.get(o);
  if (!id) ids.set(o, (id = nextId++));
  return id;
};

/** The sweeps as one shape (white), the erasing ones cut out of what came before. */
function drawStrokes(mc: CanvasRenderingContext2D, strokes: HealStroke[], w: number, h: number) {
  mc.save();
  mc.strokeStyle = mc.fillStyle = '#fff';
  mc.lineCap = mc.lineJoin = 'round';
  for (const s of strokes) {
    const [first, ...rest] = s.points;
    if (!first) continue;
    mc.globalCompositeOperation = s.erase ? 'destination-out' : 'source-over';
    mc.lineWidth = Math.max(2, s.size * w);
    mc.beginPath();
    if (!rest.length) {
      mc.arc(first[0] * w, first[1] * h, mc.lineWidth / 2, 0, Math.PI * 2);
      mc.fill();
    } else {
      mc.moveTo(first[0] * w, first[1] * h);
      for (const [x, y] of rest) mc.lineTo(x * w, y * h);
      mc.stroke();
    }
  }
  mc.restore();
}

/** `src` (`w` × `h`) with its spots filled by PatchMatch; the same canvas while nothing changes. */
function patched(src: CanvasImageSource, w: number, h: number, spots: HealSpot[]): HTMLCanvasElement {
  const key = `${idOf(src as object)}|${w}x${h}|${JSON.stringify(spots)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  // Each sweep's own hole, drawn at this size.
  const m = document.createElement('canvas');
  m.width = w;
  m.height = h;
  const mc = m.getContext('2d', { willReadFrequently: true })!;
  for (const s of spots) {
    mc.clearRect(0, 0, w, h);
    drawStrokes(mc, [s, ...(s.more ?? [])], w, h);
    const a = mc.getImageData(0, 0, w, h).data;
    const hole = new Uint8Array(w * h);
    for (let i = 0; i < hole.length; i++) hole[i] = a[i * 4 + 3]! > 32 ? 1 : 0;
    inpaint(img, hole);
  }
  ctx.putImageData(img, 0, 0);
  cache.set(key, c);
  // A few kept: the photo shown and the one before.
  if (cache.size > 4) cache.delete(cache.keys().next().value!);
  return c;
}

// ── Filled by AI ──

/** The AI's fills, by photo, size and the parts so far (each part builds on the ones before). */
const ai = new Map<string, HTMLCanvasElement>();
/** Fills under way, by the same key as the finished one. */
const working = new Map<string, Promise<HTMLCanvasElement>>();
/** Photos the model could not fill: PatchMatch's stays. */
const failed = new Set<string>();
const listeners = new Set<() => void>();
const keyOf = (src: object, w: number, h: number, spots: HealSpot[]) => `${idOf(src)}|${w}x${h}|${JSON.stringify(spots)}`;

/** Told when a fill is done or starts, to draw again (and show that it works). */
export function onHealing(f: () => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}
/** Fills under way. */
export const healingNow = () => working.size;

/** The part of the photo the model gets for `hole` (`w` × `h`): its marks with room round them, as square as fits. */
function regionOf(hole: Uint8ClampedArray, w: number, h: number) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (hole[(y * w + x) * 4 + 3]! > 32) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  // The marks about two fifths of the side: enough round them to fill from.
  const side = Math.min(Math.max(w, h), Math.max(96, Math.round(Math.max(x1 - x0, y1 - y0) * 2.4)));
  const rw = Math.min(w, side);
  const rh = Math.min(h, side);
  const rx = Math.min(w - rw, Math.max(0, Math.round((x0 + x1) / 2 - rw / 2)));
  const ry = Math.min(h - rh, Math.max(0, Math.round((y0 + y1) / 2 - rh / 2)));
  return { x: rx, y: ry, w: rw, h: rh };
}

const SIDE = 512;

/** `base` with one part (its sweeps) filled by the model, in place. */
async function fillPart(base: HTMLCanvasElement, spot: HealSpot) {
  const { width: w, height: h } = base;
  const m = document.createElement('canvas');
  m.width = w;
  m.height = h;
  const mc = m.getContext('2d', { willReadFrequently: true })!;
  drawStrokes(mc, [spot, ...(spot.more ?? [])], w, h);
  const r = regionOf(mc.getImageData(0, 0, w, h).data, w, h);
  if (!r) return;
  // The part, and its marks a little wider (a fill reaching past the edge hides it), at 512.
  const grow = Math.max(2, Math.round((3 * r.w) / SIDE));
  const at512 = (src: CanvasImageSource, spread = 0) => {
    const c = document.createElement('canvas');
    c.width = c.height = SIDE;
    const x = c.getContext('2d', { willReadFrequently: true })!;
    if (spread) x.filter = `blur(${spread}px)`;
    x.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, SIDE, SIDE);
    return x.getImageData(0, 0, SIDE, SIDE).data;
  };
  const px = at512(base);
  const mk = at512(m, 2);
  const body = new Uint8Array(SIDE * SIDE * 4);
  for (let i = 0; i < SIDE * SIDE; i++) {
    body[i * 3] = px[i * 4]!;
    body[i * 3 + 1] = px[i * 4 + 1]!;
    body[i * 3 + 2] = px[i * 4 + 2]!;
    body[SIDE * SIDE * 3 + i] = mk[i * 4 + 3]! > 8 ? 1 : 0;
  }
  const out = new Uint8Array(await api.inpaintAi(body));
  if (out.length !== SIDE * SIDE * 3) throw new Error('inpaint_ai');
  const patch = document.createElement('canvas');
  patch.width = patch.height = SIDE;
  const pd = new ImageData(SIDE, SIDE);
  for (let i = 0; i < SIDE * SIDE; i++) {
    pd.data[i * 4] = out[i * 3]!;
    pd.data[i * 4 + 1] = out[i * 3 + 1]!;
    pd.data[i * 4 + 2] = out[i * 3 + 2]!;
    pd.data[i * 4 + 3] = 255;
  }
  patch.getContext('2d')!.putImageData(pd, 0, 0);
  // Back at the part's size, kept only where the marks were (widened, then softened at the edge).
  const piece = document.createElement('canvas');
  piece.width = r.w;
  piece.height = r.h;
  const pc = piece.getContext('2d')!;
  pc.imageSmoothingQuality = 'high';
  pc.drawImage(patch, 0, 0, r.w, r.h);
  const soft = document.createElement('canvas');
  soft.width = r.w;
  soft.height = r.h;
  const sc = soft.getContext('2d')!;
  sc.filter = `blur(${grow}px)`;
  for (const [dx, dy] of [[0, 0], [grow, 0], [-grow, 0], [0, grow], [0, -grow]]) sc.drawImage(m, r.x + dx!, r.y + dy!, r.w, r.h, 0, 0, r.w, r.h);
  pc.globalCompositeOperation = 'destination-in';
  pc.drawImage(soft, 0, 0);
  base.getContext('2d')!.drawImage(piece, r.x, r.y);
}

/** The photo with every part filled by the model: built on the longest run of parts already filled. */
async function filledByAi(src: CanvasImageSource, w: number, h: number, spots: HealSpot[]): Promise<HTMLCanvasElement> {
  let from = 0;
  let start: HTMLCanvasElement | null = null;
  for (let i = spots.length; i > 0; i--) {
    const hit = ai.get(keyOf(src as object, w, h, spots.slice(0, i)));
    if (hit) [from, start] = [i, hit];
    if (hit) break;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d', { willReadFrequently: true })!.drawImage(start ?? src, 0, 0, w, h);
  for (let i = from; i < spots.length; i++) {
    await fillPart(c, spots[i]!);
    const done = document.createElement('canvas');
    done.width = w;
    done.height = h;
    done.getContext('2d')!.drawImage(c, 0, 0);
    ai.set(keyOf(src as object, w, h, spots.slice(0, i + 1)), done);
    // The photos shown lately, a few parts each.
    while (ai.size > 12) ai.delete(ai.keys().next().value!);
  }
  return c;
}

/** The photo with its parts filled by the model, once (the same promise while it works); PatchMatch's if it cannot. */
export function healReady(src: CanvasImageSource, w: number, h: number, spots: HealSpot[]): Promise<HTMLCanvasElement> {
  const key = keyOf(src as object, w, h, spots);
  const done = ai.get(key);
  if (done) return Promise.resolve(done);
  if (failed.has(`${idOf(src as object)}|${w}x${h}`)) return Promise.resolve(patched(src, w, h, spots));
  let p = working.get(key);
  if (!p) {
    p = filledByAi(src, w, h, spots)
      .catch(() => {
        failed.add(`${idOf(src as object)}|${w}x${h}`);
        return patched(src, w, h, spots);
      })
      .finally(() => {
        working.delete(key);
        listeners.forEach((f) => f());
      });
    working.set(key, p);
    listeners.forEach((f) => f());
  }
  return p;
}

/**
 * For drawing now: the model's fill when it is done. While it works, the
 * parts it has already filled (the newest still as it was, under the
 * spinner the view shows) — not PatchMatch's quick fill, which would hold
 * the page still for a moment and then change again. PatchMatch only when
 * the model cannot run.
 */
export function healed(src: HTMLImageElement | HTMLCanvasElement, w: number, h: number, spots: HealSpot[]): HTMLImageElement | HTMLCanvasElement {
  const done = ai.get(keyOf(src, w, h, spots));
  if (done) return done;
  if (failed.has(`${idOf(src)}|${w}x${h}`)) return patched(src, w, h, spots);
  void healReady(src, w, h, spots);
  for (let i = spots.length - 1; i > 0; i--) {
    const part = ai.get(keyOf(src, w, h, spots.slice(0, i)));
    if (part) return part;
  }
  return src;
}

// ── The panel ──

/** The selection being painted, not removed yet: Tambah adds to it, Kurangi takes away (Alt while painting does the other). */
export interface HealSelection {
  strokes: HealStroke[];
  erase: boolean;
}

/** The selection, removed as one part: what was taken away first is dropped (nothing to take it from). */
export function spotOf(sel: HealStroke[]): HealSpot | null {
  const from = sel.findIndex((s) => !s.erase);
  if (from < 0) return null;
  const [first, ...more] = sel.slice(from);
  return { id: newId(), size: first!.size, points: first!.points, ...(more.length ? { more } : {}) };
}

export function HealPanel({
  a,
  size,
  sel,
  onSel,
  onRemove,
  onSize,
  onLive,
  onDone,
  onClose,
}: {
  a: EditSettings;
  size: number;
  sel: HealSelection;
  onSel: (s: HealSelection) => void;
  /** Hapus: the selection filled in. */
  onRemove: () => void;
  onSize: (v: number) => void;
  onLive: (patch: Partial<EditSettings>) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const spots = a.heal ?? [];
  const painted = sel.strokes.some((s) => !s.erase);
  const mode = (erase: boolean, Icon: typeof Plus, label: string) => (
    <button
      type="button"
      onClick={() => onSel({ ...sel, erase })}
      title={t('Tahan Alt sambil menyapu untuk sebaliknya')}
      aria-pressed={sel.erase === erase}
      className={cx('flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md border text-xs', sel.erase === erase ? 'border-fg/70 font-semibold text-fg' : 'border-line text-muted hover:text-fg')}
    >
      <Icon size={13} /> {label}
    </button>
  );
  return (
    <ToolBox title={t('Hapus objek')} onClose={onClose}>
      <ToolRow>
        <span className="text-xs font-semibold">{painted ? t('Dipilih##heal') : t('Sapukan di foto')}</span>
        <div className="flex items-center gap-2">
          <span className="w-11 shrink-0 text-xs text-muted">{t('Mask:')}</span>
          {mode(false, Plus, t('Tambah'))}
          {mode(true, Minus, t('Kurangi'))}
        </div>
        <Slider label={t('Ukuran kuas')} value={Math.round(size * 100)} min={1} max={30} center={4} onLive={(v) => onSize(v / 100)} onDone={() => {}} />
        {painted && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="plain" onClick={() => onSel({ strokes: [], erase: false })} title="Esc">
              {t('Batal')}
            </Button>
            <Button variant="primary" onClick={onRemove} title="Enter">
              {t('Hapus##heal')}
            </Button>
          </div>
        )}
      </ToolRow>
      {spots.length > 0 && (
        <ToolRow className="gap-1">
          <span className="pb-1 text-xs font-semibold">{t('{count} bagian dihapus', { n: spots.length, count: num(spots.length) })}</span>
          {spots.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-panel-2">
              <Eraser size={13} className="text-faint" />
              <span className="flex-1">{t('Hapus {n}', { n: i + 1 })}</span>
              <button
                type="button"
                onClick={() => (onLive({ heal: spots.length > 1 ? spots.filter((x) => x.id !== s.id) : undefined }), onDone())}
                title={t('Kembalikan bagian ini')}
                className="text-faint hover:text-reject"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </ToolRow>
      )}
    </ToolBox>
  );
}

// ── On the photo ──

/** Over the photo: the brush, and the selection in red (taken-away sweeps cut out of it) until Hapus. */
export function HealLayer({ sel, size, onSize, onSel }: { sel: HealSelection; size: number; onSize: (v: number) => void; onSel: (s: HealSelection) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const pointer = usePointerAt(box);
  const [sweep, setSweep] = useState<HealStroke | null>(null);
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const erase = sel.erase !== e.altKey;
    let stroke: HealStroke = { size, points: [at(e)], ...(erase ? { erase } : {}) };
    setSweep(stroke);
    const move = (ev: PointerEvent) => {
      stroke = { ...stroke, points: [...stroke.points, at(ev)] };
      setSweep(stroke);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSweep(null);
      onSel({ ...sel, strokes: [...sel.strokes, stroke] });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const w = box.current?.clientWidth ?? 1;
  const h = box.current?.clientHeight ?? 1;
  const strokes = sweep ? [...sel.strokes, sweep] : sel.strokes;
  const line = (s: HealStroke, i: number, color: string) =>
    s.points.length === 1 ? (
      <circle key={i} cx={s.points[0]![0] * w} cy={s.points[0]![1] * h} r={(s.size * w) / 2} fill={color} />
    ) : (
      <polyline key={i} points={s.points.map(([x, y]) => `${x * w},${y * h}`).join(' ')} fill="none" stroke={color} strokeWidth={s.size * w} strokeLinecap="round" strokeLinejoin="round" />
    );
  return (
    <div
      ref={box}
      tabIndex={-1}
      onKeyDown={(e) => (e.key === '[' || e.key === ']') && onSize(Math.min(0.3, Math.max(0.01, size * (e.key === ']' ? 1.2 : 1 / 1.2))))}
      className="absolute inset-0 cursor-none outline-none"
      onPointerDown={down}
      onPointerMove={pointer.move}
      onPointerLeave={pointer.leave}
    >
      {strokes.length > 0 && (
        <svg className="pointer-events-none absolute inset-0 size-full">
          <defs>
            <mask id="heal-sel" maskUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
              {strokes.map((s, i) => line(s, i, s.erase ? 'black' : 'white'))}
            </mask>
          </defs>
          <rect width={w} height={h} fill="rgb(255 45 85 / 0.55)" mask="url(#heal-sel)" />
        </svg>
      )}
      <ScreenRing at={pointer.screen} share={size} feather={0} />
    </div>
  );
}
