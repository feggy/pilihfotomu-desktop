/**
 * Crop & luruskan, as Lightroom Classic's Crop & Straighten panel: the
 * aspect (a list, with a lock), straightening (the level tool, Auto, the
 * Angle slider), quarter turns and mirroring, and the same crop for the
 * other photos ticked. On the photo: drag the frame's edges and corners,
 * drag inside to move it, drag outside it to turn the photo.
 */

import { Check, FlipHorizontal2, FlipVertical2, Lock, LockOpen, RotateCcw, RotateCw, Ruler, Wand2 } from 'lucide-react';

import { Button, cx } from '../components/ui';
import { num } from '../lib/format';
import { t } from '../lib/i18n';
import { Slider } from './panels';
import { NO_GEOMETRY, cropForRatio, drawGeometry, squareToQuad, uprightQuad, type Geometry } from './geometry';

/** Lightroom's aspects (the longer side first; X turns them to stand), the photo's own, and free. */
export const RATIOS: { id: string; label: string; value: number | 'asli' | null }[] = [
  { id: 'asli', label: 'Seperti dipotret', value: 'asli' },
  { id: '1:1', label: '1 × 1', value: 1 },
  { id: '5:4', label: '4 × 5 / 8 × 10', value: 5 / 4 },
  { id: '7:5', label: '5 × 7', value: 7 / 5 },
  { id: '3:2', label: '2 × 3 / 4 × 6', value: 3 / 2 },
  { id: '4:3', label: '4 × 3', value: 4 / 3 },
  { id: '16:10', label: '16 × 10', value: 16 / 10 },
  { id: '16:9', label: '16 × 9', value: 16 / 9 },
  { id: '9:16', label: 'Story 9 × 16', value: 16 / 9 },
  { id: 'bebas', label: 'Bebas', value: null },
];

export function CropPanel({
  g,
  ratioId,
  portrait,
  leveling,
  onRatio,
  onSwap,
  onChange,
  onDone,
  onLevel,
  onAuto,
  onUpright,
  others,
  applyAll,
  onApplyAll,
  onReset,
  onClose,
}: {
  g: Geometry;
  ratioId: string;
  /** The chosen shape is turned to stand (portrait) rather than lie. */
  portrait: boolean;
  /** The level tool is on: a line drawn on the photo levels it. */
  leveling: boolean;
  onRatio: (id: string) => void;
  onSwap: () => void;
  onChange: (g: Geometry) => void;
  onDone: () => void;
  onLevel: () => void;
  /** Auto: levelled by the lines found in the photo. */
  onAuto: () => void;
  /** Upright's Auto: leaning lines put straight. */
  onUpright: () => void;
  others: number;
  applyAll: boolean;
  onApplyAll: (v: boolean) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const turn = (by: number) => {
    // A quarter turn changes the frame's shape: the crop starts again.
    onChange({ ...g, rot: (g.rot + by + 4) % 4, crop: undefined });
    onDone();
  };
  const locked = ratioId !== 'bebas';
  const icon = 'flex h-8 items-center justify-center rounded-md border border-line text-muted hover:text-fg';
  const edited = !!(g.crop || g.angle || g.rot || g.flipH || g.flipV || g.vertical || g.horizontal);
  return (
    <div className="flex h-full flex-col gap-4">
      <h2 className="text-[15px] font-semibold">{t('Crop & luruskan')}</h2>

      <div className="flex flex-col gap-2">
        <span className="flex items-center justify-between text-xs text-muted">
          {t('Rasio')}
          <button
            type="button"
            onClick={() => onRatio(locked ? 'bebas' : 'asli')}
            title={locked ? t('Lepas kunci rasio') : t('Kunci rasio')}
            className={cx('flex size-7 items-center justify-center rounded-md', locked ? 'text-gold-text' : 'text-faint hover:text-fg')}
          >
            {locked ? <Lock size={14} /> : <LockOpen size={14} />}
          </button>
        </span>
        <select
          value={ratioId}
          onChange={(e) => onRatio(e.target.value)}
          className="h-8 rounded-md border border-line bg-bg px-2 text-[13px] text-fg outline-none"
        >
          {RATIOS.map((r) => (
            <option key={r.id} value={r.id}>
              {t(r.label)}
            </option>
          ))}
        </select>
        <button type="button" onClick={onSwap} disabled={!locked || ratioId === '1:1'} className="self-start text-[11px] text-faint hover:text-fg disabled:opacity-40">
          {portrait ? t('Tegak') : t('Datar')} · {t('tekan X untuk tukar tegak/datar')}
        </button>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-line-soft pt-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onLevel}
            title={t('Alat luruskan: tarik garis di sepanjang yang harusnya lurus')}
            aria-pressed={leveling}
            className={cx('flex size-8 items-center justify-center rounded-md', leveling ? 'bg-gold/15 text-gold-text ring-1 ring-gold' : 'text-muted hover:bg-raised hover:text-fg')}
          >
            <Ruler size={15} />
          </button>
          <span className="flex-1 text-xs text-muted">{t('Luruskan')}</span>
          <Button icon={Wand2} onClick={onAuto} title={t('Luruskan otomatis dari garis cakrawala atau bangunan')}>
            {t('Auto')}
          </Button>
        </div>
        <Slider
          label={t('Sudut')}
          value={Math.round(g.angle * 100) / 100}
          min={-45}
          max={45}
          step={0.01}
          show={(v) => `${v.toFixed(2)}°`}
          onLive={(v) => onChange({ ...g, angle: v })}
          onDone={onDone}
        />
        <p className="text-[11px] leading-snug text-faint">
          {leveling
            ? t('Tarik garis di sepanjang cakrawala atau dinding yang harusnya lurus.')
            : t('Atau seret di luar kotak crop untuk memutar foto.')}
        </p>
      </div>

      <div className="flex flex-col gap-2.5 border-t border-line-soft pt-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">{t('Upright')}</span>
          <Button icon={Wand2} onClick={onUpright} title={t('Luruskan garis bangunan yang menguncup ke atas atau ke samping')}>
            {t('Auto')}
          </Button>
        </div>
        <Slider label={t('Vertikal')} value={g.vertical ?? 0} onLive={(v) => onChange({ ...g, vertical: v || undefined })} onDone={onDone} />
        <Slider label={t('Horizontal')} value={g.horizontal ?? 0} onLive={(v) => onChange({ ...g, horizontal: v || undefined })} onDone={onDone} />
      </div>

      <div className="flex flex-col gap-2 border-t border-line-soft pt-4">
        <span className="text-xs text-muted">{t('Putar & balik')}</span>
        <div className="grid grid-cols-4 gap-1.5">
          <button type="button" onClick={() => turn(-1)} title={t('Putar ke kiri')} className={icon}>
            <RotateCcw size={15} />
          </button>
          <button type="button" onClick={() => turn(1)} title={t('Putar ke kanan')} className={icon}>
            <RotateCw size={15} />
          </button>
          <button type="button" onClick={() => (onChange({ ...g, flipH: !g.flipH }), onDone())} title={t('Balik kiri-kanan')} className={cx(icon, g.flipH && 'border-gold text-fg')}>
            <FlipHorizontal2 size={15} />
          </button>
          <button type="button" onClick={() => (onChange({ ...g, flipV: !g.flipV }), onDone())} title={t('Balik atas-bawah')} className={cx(icon, g.flipV && 'border-gold text-fg')}>
            <FlipVertical2 size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1" />
      {others > 0 && (
        <label className={cx('flex items-start gap-2.5 rounded-xl border p-3 text-xs', applyAll ? 'border-gold/70 bg-gold/[0.05]' : 'border-line-soft')}>
          <input type="checkbox" checked={applyAll} onChange={(e) => onApplyAll(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-gold)]" />
          {t('Pakai crop yang sama untuk {count} foto terpilih', { n: others, count: num(others) })}
        </label>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button onClick={onReset} disabled={g === NO_GEOMETRY || !edited}>
          {t('Reset')}
        </Button>
        <Button variant="primary" icon={Check} onClick={onClose} title="Enter">
          {t('Selesai')}
        </Button>
      </div>
    </div>
  );
}

/** The width ÷ height (pixels) a shape keeps while dragging; null for free. */
export function ratioValue(ratioId: string, portrait: boolean, frame: { w: number; h: number }): number | null {
  const r = RATIOS.find((x) => x.id === ratioId)?.value;
  if (r == null) return null;
  let v = r === 'asli' ? frame.w / frame.h : r;
  if ((v > 1 && portrait) || (v < 1 && !portrait)) v = 1 / v;
  return v;
}

/** The crop a shape asks for in this frame (pixels), as large as fits; none when that is the whole frame. */
export function cropFor(ratioId: string, portrait: boolean, frame: { w: number; h: number }) {
  const v = ratioValue(ratioId, portrait, frame);
  if (v == null || Math.abs(v - frame.w / frame.h) < 1e-3) return undefined;
  return cropForRatio(frame.w, frame.h, v);
}

/**
 * Auto: the angle that levels the photo, from its edges — the strongest lean
 * of the lines within 12° of level or upright (horizons, walls, doors),
 * weighted by how strong each edge is. 0 when nothing leans clearly.
 */
export function autoAngle(img: HTMLImageElement | HTMLCanvasElement, g: Geometry): number {
  const iw = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const ih = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const k = Math.min(1, 1024 / Math.max(iw, ih));
  const upright = { ...g, angle: 0, crop: undefined };
  const turned = g.rot % 2 === 1;
  const W = Math.max(16, Math.round((turned ? ih : iw) * k));
  const H = Math.max(16, Math.round((turned ? iw : ih) * k));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  drawGeometry(ctx, img, iw, ih, upright, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!;
  // Lean of each strong edge, in bins of 0.1° from −12° to 12°.
  const BINS = 241;
  const hist = new Float32Array(BINS);
  // The strong edges, kept for the refinement below.
  const ex: number[] = [];
  const ey: number[] = [];
  const ew: number[] = [];
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const at = (dx: number, dy: number) => lum[(y + dy) * W + x + dx]!;
      // Scharr: truer angles than Sobel for lines leaning a little.
      const gx = 3 * (at(1, -1) + at(1, 1) - at(-1, -1) - at(-1, 1)) + 10 * (at(1, 0) - at(-1, 0));
      const gy = 3 * (at(-1, 1) + at(1, 1) - at(-1, -1) - at(1, -1)) + 10 * (at(0, 1) - at(0, -1));
      const m = Math.hypot(gx, gy);
      if (m < 320) continue;
      // The edge runs across its gradient; folded so level and upright meet at 0.
      let a = (Math.atan2(gy, gx) * 180) / Math.PI + 90;
      a = ((a % 90) + 90) % 90;
      if (a > 45) a -= 90;
      if (Math.abs(a) > 12) continue;
      hist[Math.round((a + 12) * 10)]! += m;
      ex.push(x);
      ey.push(y);
      ew.push(m);
    }
  }
  // Smoothed over ±0.5°, the strongest lean.
  let best = 0;
  let at = 120;
  let total = 0;
  for (let i = 0; i < BINS; i++) {
    total += hist[i]!;
    let s = 0;
    for (let j = -5; j <= 5; j++) s += hist[i + j] ?? 0;
    if (s > best) [best, at] = [s, i];
  }
  // The middle of the peak, weighted: finer than its bin.
  let sum = 0;
  let wsum = 0;
  for (let j = -10; j <= 10; j++) {
    const v = hist[at + j] ?? 0;
    sum += v * ((at + j) / 10 - 12);
    wsum += v;
  }
  const rough = wsum ? sum / wsum : at / 10 - 12;
  // Too little, or lines everywhere (no clear lean): leave it.
  if (!total || best / total < 0.08) return g.angle;
  // Refined as deskewing does: the angle that stacks the edges into the
  // fewest rows (level lines) or columns (upright ones).
  const score = (deg: number) => {
    const r = (deg * Math.PI) / 180;
    const sn = Math.sin(r);
    const cs = Math.cos(r);
    const rows = new Float32Array(H + W);
    const cols = new Float32Array(W + H);
    for (let i = 0; i < ex.length; i++) {
      const x = ex[i]!;
      const y = ey[i]!;
      rows[Math.round(y * cs - x * sn + W)]! += ew[i]!;
      cols[Math.round(x * cs + y * sn + H)]! += ew[i]!;
    }
    let q = 0;
    for (let i = 0; i < rows.length; i++) q += rows[i]! * rows[i]! + cols[i]! * cols[i]!;
    return q;
  };
  let lean = rough;
  let top = score(rough);
  for (let d = rough - 1.5; d <= rough + 1.5; d += 0.05) {
    const q = score(d);
    if (q > top) [top, lean] = [q, d];
  }
  if (Math.abs(lean) < 0.15) return g.angle;
  return Math.round(-lean * 100) / 100;
}

/**
 * Upright's Auto: how much Vertical and Horizontal put the photo's lines
 * straight. Near-upright edges (walls, poles, door frames) lean more the
 * further they are from the middle when the camera was tipped; how fast that
 * lean changes across the photo is matched with what each Vertical value
 * would undo (and the same, turned, for near-level edges and Horizontal).
 * The photo's overall lean is the Angle's to fix, not this.
 */
export function autoUpright(img: HTMLImageElement | HTMLCanvasElement, g: Geometry): { vertical: number; horizontal: number } {
  const iw = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const ih = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const k = Math.min(1, 900 / Math.max(iw, ih));
  const plain = { ...g, crop: undefined, vertical: 0, horizontal: 0 };
  const turned = g.rot % 2 === 1;
  const W = Math.max(16, Math.round((turned ? ih : iw) * k));
  const H = Math.max(16, Math.round((turned ? iw : ih) * k));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  drawGeometry(ctx, img, iw, ih, plain, W, H);
  const px = ctx.getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < lum.length; i++) lum[i] = 0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!;
  // Each strong edge: where it is, and its lean from upright (or tilt from level), degrees.
  const ups: [number, number, number][] = [];
  const levels: [number, number, number][] = [];
  for (let y = 2; y < H - 2; y++) {
    for (let x = 2; x < W - 2; x++) {
      const at = (dx: number, dy: number) => lum[(y + dy) * W + x + dx]!;
      const gx = 3 * (at(1, -1) + at(1, 1) - at(-1, -1) - at(-1, 1)) + 10 * (at(1, 0) - at(-1, 0));
      const gy = 3 * (at(-1, 1) + at(1, 1) - at(-1, -1) - at(1, -1)) + 10 * (at(0, 1) - at(0, -1));
      const m = Math.hypot(gx, gy);
      if (m < 400) continue;
      // The edge runs across its gradient.
      let dx = -gy;
      let dy = gx;
      if (Math.abs(gx) > Math.abs(gy)) {
        if (dy > 0) [dx, dy] = [-dx, -dy];
        const lean = (Math.atan2(dx, -dy) * 180) / Math.PI;
        if (Math.abs(lean) < 20) ups.push([x / W, lean, m]);
      } else {
        if (dx < 0) [dx, dy] = [-dx, -dy];
        const tilt = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (Math.abs(tilt) < 20) levels.push([y / H, tilt, m]);
      }
    }
  }
  /** How fast the lean changes across the photo (degrees per photo width), robustly; null with too little to go on. */
  const slope = (pts: [number, number, number][]) => {
    let keep = pts;
    let fit: [number, number] | null = null;
    for (let pass = 0; pass < 3; pass++) {
      let sw = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let sxy = 0;
      for (const [x, v, w] of keep) {
        sw += w;
        sx += w * x;
        sy += w * v;
        sxx += w * x * x;
        sxy += w * x * v;
      }
      const den = sw * sxx - sx * sx;
      if (keep.length < 200 || Math.abs(den) < 1e-9) return null;
      const s = (sw * sxy - sx * sy) / den;
      const a = (sy - s * sx) / sw;
      fit = [a, s];
      keep = keep.filter(([x, v]) => Math.abs(v - (a + s * x)) < 3);
    }
    return fit ? fit[1] : null;
  };
  /** The lean change a Vertical (or Horizontal) value would undo: what the photo would show. */
  const predicted = (vertical: number, horizontal: number) => {
    const from = squareToQuad(uprightQuad({ vertical, horizontal }));
    const deg = (a: number) => (a * 180) / Math.PI;
    const lean = (x: number) => {
      const [tx, ty] = from(x, 0);
      const [bx, by] = from(x, 1);
      return deg(Math.atan2((tx - bx) * W, (by - ty) * H));
    };
    const tilt = (y: number) => {
      const [lx, ly] = from(0, y);
      const [rx, ry] = from(1, y);
      return deg(Math.atan2((ry - ly) * H, (rx - lx) * W));
    };
    return { v: (lean(0.8) - lean(0.2)) / 0.6, h: (tilt(0.8) - tilt(0.2)) / 0.6 };
  };
  const best = (want: number | null, which: 'v' | 'h') => {
    if (want == null || Math.abs(want) < 0.8) return 0;
    let pick = 0;
    let err = Infinity;
    for (let s = -100; s <= 100; s++) {
      const p = predicted(which === 'v' ? s : 0, which === 'h' ? s : 0)[which];
      if (Math.abs(p - want) < err) [err, pick] = [Math.abs(p - want), s];
    }
    return pick;
  };
  return { vertical: best(slope(ups), 'v'), horizontal: best(slope(levels), 'h') };
}
