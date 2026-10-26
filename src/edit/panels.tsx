/**
 * Edit foto's right-hand panels, in Lightroom Classic's order: Basic, Tone
 * Curve, Color Mixer, Detail, Effects. Each works on one photo's settings
 * (`PhotoAdjust`, see kreasi/engine/develop.ts for what each does).
 *
 * `onLive` is called while a control moves (the photo follows); `onDone`
 * once it is let go, which makes one undo step.
 */

import { ChevronDown, Eye, EyeOff, Pipette, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';

import { Segmented, cx } from '../components/ui';
import { t } from '../lib/i18n';
import { COLOR_BANDS, type AdjustGroup, type ColorBand, type CurvePoint, type GradeWheel, type HslShift, type PhotoAdjust, type ToneCurve } from '../kreasi/engine/document';
import { STRAIGHT, sampleCurve } from '../kreasi/engine/develop';

export interface PanelProps {
  a: PhotoAdjust;
  onLive: (patch: Partial<PhotoAdjust>) => void;
  onDone: () => void;
}

// ── Pieces ──

const TEMP = 'linear-gradient(90deg,#4a7bd1,#d8d0b8,#e2b23c)';
const TINT = 'linear-gradient(90deg,#4caf50,#d8d0b8,#c04fc4)';

export function Slider({
  label,
  value,
  min = -100,
  max = 100,
  step = 1,
  center = 0,
  track,
  show,
  onLive,
  onDone,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Double-click goes back to this. */
  center?: number;
  /** A gradient behind the track (white balance, color mixer). */
  track?: string;
  show?: (v: number) => string;
  onLive: (v: number) => void;
  onDone: () => void;
}) {
  const reset = () => {
    onLive(center);
    onDone();
  };
  const text = show ? show(value) : value > 0 && min < 0 ? `+${value}` : String(value);
  return (
    <label className="flex flex-col gap-1" onDoubleClick={reset}>
      <span className="flex items-center justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className={cx('tabular-nums', value === center ? 'text-faint' : 'text-fg')}>{text}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onLive(Number(e.target.value))}
        onPointerUp={onDone}
        onKeyUp={onDone}
        title={t('Klik dua kali untuk kembali ke awal')}
        className="edit-range h-1.5 w-full appearance-none rounded-full"
        style={{ background: track ?? 'var(--color-line)' }}
      />
    </label>
  );
}

function Label({ children }: { children: string }) {
  return <span className="pt-2 text-[10px] font-semibold tracking-wide text-faint uppercase">{children}</span>;
}

/** One panel: its title, an eye to switch it off and compare, a reset, and its controls. */
export function Section({
  title,
  group,
  a,
  open,
  onToggle,
  onLive,
  onDone,
  reset,
  children,
}: {
  title: string;
  group?: AdjustGroup;
  a: PhotoAdjust;
  open: boolean;
  onToggle: () => void;
  onLive: (patch: Partial<PhotoAdjust>) => void;
  onDone: () => void;
  /** The settings this panel puts back to how the photo came. */
  reset?: Partial<PhotoAdjust>;
  children: React.ReactNode;
}) {
  const off = group != null && (a.hidden ?? []).includes(group);
  const toggleEye = () => {
    if (!group) return;
    const hidden = off ? (a.hidden ?? []).filter((g) => g !== group) : [...(a.hidden ?? []), group];
    onLive({ hidden: hidden.length ? hidden : undefined });
    onDone();
  };
  return (
    <section className="border-b border-line-soft">
      <div className="flex items-center gap-1 py-2.5">
        <button type="button" onClick={onToggle} className="flex flex-1 items-center gap-2 text-left text-[13px] font-semibold">
          <ChevronDown size={14} className={cx('text-faint transition-transform', !open && '-rotate-90')} />
          <span className={cx(off && 'text-faint line-through')}>{title}</span>
        </button>
        {reset && open && (
          <button
            type="button"
            onClick={() => (onLive(reset), onDone())}
            title={t('Kembalikan panel ini')}
            className="flex size-6 items-center justify-center rounded text-faint hover:text-fg"
          >
            <RotateCcw size={13} />
          </button>
        )}
        {group && (
          <button
            type="button"
            onClick={toggleEye}
            title={off ? t('Nyalakan lagi') : t('Matikan sementara untuk membandingkan')}
            className="flex size-6 items-center justify-center rounded text-faint hover:text-fg"
          >
            {off ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        )}
      </div>
      {open && <div className={cx('flex flex-col gap-3 pb-4', off && 'opacity-50')}>{children}</div>}
    </section>
  );
}

// ── Basic ──

export function BasicPanel({ a, onLive, onDone, picking, onPick, onAuto }: PanelProps & { picking: boolean; onPick: () => void; onAuto: () => void }) {
  const n = (k: keyof PhotoAdjust) => (a[k] as number | undefined) ?? 0;
  const s = (k: keyof PhotoAdjust, label: string, extra?: Partial<Parameters<typeof Slider>[0]>) => (
    <Slider key={k} label={label} value={n(k)} onLive={(v) => onLive({ [k]: v })} onDone={onDone} {...extra} />
  );
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">{t('Perlakuan')}</span>
        <div>
          <Segmented<'warna' | 'bw'>
            value={a.mono ? 'bw' : 'warna'}
            onChange={(v) => (onLive({ mono: v === 'bw' }), onDone())}
            options={[
              { value: 'warna', label: t('Warna') },
              { value: 'bw', label: t('Hitam putih') },
            ]}
          />
        </div>
      </div>
      <div className="flex items-center justify-between">
        <Label>{t('White balance')}</Label>
        <span className="flex gap-1 pt-1.5">
          <button
            type="button"
            onClick={onPick}
            title={t('Klik bagian foto yang seharusnya putih atau abu-abu')}
            className={cx('flex size-7 items-center justify-center rounded-md', picking ? 'bg-gold text-white' : 'text-muted hover:bg-raised hover:text-fg')}
          >
            <Pipette size={14} />
          </button>
        </span>
      </div>
      {s('warmth', t('Temp'), { track: TEMP })}
      {s('tint', t('Tint'), { track: TINT })}
      <div className="flex items-center justify-between">
        <Label>{t('Tone')}</Label>
        <button type="button" onClick={onAuto} title={t('Atur cahaya otomatis')} className="mt-1.5 h-6 rounded-md px-2 text-xs font-medium text-muted hover:bg-raised hover:text-fg">
          {t('Auto')}
        </button>
      </div>
      {s('brightness', t('Exposure'))}
      {s('contrast', t('Contrast'))}
      {s('highlights', t('Highlights'))}
      {s('shadows', t('Shadows'))}
      {s('whites', t('Whites'))}
      {s('blacks', t('Blacks'))}
      <Label>{t('Presence')}</Label>
      {s('texture', t('Texture'))}
      {s('clarity', t('Clarity'))}
      {s('dehaze', t('Dehaze'))}
      {s('vibrance', t('Vibrance'))}
      {s('saturation', t('Saturation'))}
    </>
  );
}

export const BASIC_RESET: Partial<PhotoAdjust> = {
  mono: false,
  warmth: 0,
  tint: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  texture: 0,
  clarity: 0,
  dehaze: 0,
  vibrance: 0,
  saturation: 0,
};

// ── Tone Curve ──

type Channel = keyof ToneCurve;
const CHANNELS: { id: Channel; color: string }[] = [
  { id: 'rgb', color: '#f2f2f2' },
  { id: 'r', color: '#e5484d' },
  { id: 'g', color: '#46a758' },
  { id: 'b', color: '#3e63dd' },
];

export function CurvePanel({ a, onLive, onDone }: PanelProps) {
  const [ch, setCh] = useState<Channel>('rgb');
  const points: CurvePoint[] = a.curve?.[ch] ?? STRAIGHT;
  const box = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const [hover, setHover] = useState<CurvePoint | null>(null);
  const S = 240;

  const set = (next: CurvePoint[]) => {
    const curve = { ...a.curve, [ch]: next };
    const straight = (p?: CurvePoint[]) => !p || (p.length === 2 && p[0]![0] === 0 && p[0]![1] === 0 && p[1]![0] === 1 && p[1]![1] === 1);
    onLive({ curve: CHANNELS.every((c) => straight(curve[c.id])) ? undefined : curve });
  };
  const at = (e: React.PointerEvent): CurvePoint => {
    const r = box.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    return [x, y];
  };
  const down = (e: React.PointerEvent) => {
    const p = at(e);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    // Near a point: that one; else a new one on the curve.
    const near = points.findIndex(([x, y]) => Math.hypot((x - p[0]) * S, (y - p[1]) * S) < 9);
    if (near >= 0) {
      drag.current = near;
      return;
    }
    const next = [...points, p].sort((m, n) => m[0] - n[0]);
    drag.current = next.indexOf(p);
    set(next);
  };
  const move = (e: React.PointerEvent) => {
    const p = at(e);
    setHover(p);
    const i = drag.current;
    if (i == null) return;
    const next = points.slice();
    // Ends stay at the edges; the others between their neighbours.
    const lo = i === 0 ? 0 : next[i - 1]![0] + 0.01;
    const hi = i === next.length - 1 ? 1 : next[i + 1]![0] - 0.01;
    const x = i === 0 ? 0 : i === next.length - 1 ? 1 : Math.min(hi, Math.max(lo, p[0]));
    // Dragged far out of the box: the point goes.
    if (i > 0 && i < next.length - 1 && (e.clientY < box.current!.getBoundingClientRect().top - 24 || e.clientY > box.current!.getBoundingClientRect().bottom + 24)) {
      next.splice(i, 1);
      drag.current = null;
      set(next);
      return;
    }
    next[i] = [x, p[1]];
    set(next);
  };
  const up = () => {
    if (drag.current != null) onDone();
    drag.current = null;
  };
  const remove = (i: number) => {
    if (i === 0 || i === points.length - 1) return;
    set(points.filter((_, j) => j !== i));
    onDone();
  };

  const samples = sampleCurve(points, 96);
  const path = Array.from(samples, (v, i) => `${i ? 'L' : 'M'}${((i / (samples.length - 1)) * S).toFixed(1)},${((1 - v) * S).toFixed(1)}`).join(' ');
  const color = CHANNELS.find((c) => c.id === ch)!.color;
  return (
    <>
      <div className="flex items-center gap-2">
        {CHANNELS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setCh(c.id)}
            aria-label={c.id.toUpperCase()}
            className={cx('size-5 rounded-full ring-offset-2 ring-offset-panel', ch === c.id ? 'ring-2 ring-fg' : '')}
            style={{ background: c.color }}
          />
        ))}
        <span className="ml-auto text-[11px] text-faint">{t('Klik untuk titik baru, klik dua kali untuk menghapus')}</span>
      </div>
      <svg
        ref={box}
        viewBox={`0 0 ${S} ${S}`}
        className="aspect-square w-full touch-none overflow-visible rounded-md border border-line-soft bg-bg"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={() => setHover(null)}
      >
        {[1, 2, 3].map((k) => (
          <g key={k} stroke="var(--color-line-soft)" strokeWidth={1}>
            <line x1={(k * S) / 4} y1={0} x2={(k * S) / 4} y2={S} />
            <line x1={0} y1={(k * S) / 4} x2={S} y2={(k * S) / 4} />
          </g>
        ))}
        <line x1={0} y1={S} x2={S} y2={0} stroke="var(--color-line)" strokeDasharray="3 4" />
        <path d={path} fill="none" stroke={color} strokeWidth={2} />
        {points.map(([x, y], i) => (
          <circle
            key={i}
            cx={x * S}
            cy={(1 - y) * S}
            r={5}
            fill="var(--color-panel)"
            stroke={color}
            strokeWidth={2}
            onDoubleClick={(e) => (e.stopPropagation(), remove(i))}
          />
        ))}
      </svg>
      <span className="flex justify-between text-[11px] text-faint tabular-nums">
        <span>
          {t('Input')} {hover ? Math.round(hover[0] * 255) : '–'}
        </span>
        <span>
          {t('Output')} {hover ? Math.round(sampleCurve(points, 256)[Math.round(hover[0] * 255)]! * 255) : '–'}
        </span>
      </span>
    </>
  );
}

// ── Color Mixer ──

type Mix = 'h' | 's' | 'l';
const HUE_TRACK = (hue: number) => `linear-gradient(90deg,hsl(${hue - 30} 70% 55%),hsl(${hue} 70% 55%),hsl(${hue + 30} 70% 55%))`;

export function MixerPanel({ a, onLive, onDone }: PanelProps) {
  const [mode, setMode] = useState<Mix>('h');
  const shift = (b: ColorBand): HslShift => ({ h: 0, s: 0, l: 0, ...a.hsl?.[b] });
  const set = (b: ColorBand, k: keyof HslShift, v: number) => {
    const next = { ...a.hsl, [b]: { ...shift(b), [k]: v } };
    const empty = Object.values(next).every((x) => !x || (!x.h && !x.s && !x.l));
    onLive({ hsl: empty ? undefined : next });
  };
  const track = (b: (typeof COLOR_BANDS)[number], k: keyof HslShift) =>
    k === 'h'
      ? HUE_TRACK(b.hue)
      : k === 's'
        ? `linear-gradient(90deg,hsl(${b.hue} 0% 55%),hsl(${b.hue} 85% 55%))`
        : `linear-gradient(90deg,hsl(${b.hue} 60% 22%),hsl(${b.hue} 60% 78%))`;
  return (
    <>
      <Segmented<Mix>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'h', label: t('Hue') },
          { value: 's', label: t('Saturation') },
          { value: 'l', label: t('Luminance') },
        ]}
      />
      {COLOR_BANDS.map((b) => (
        <Slider key={b.id} label={t(b.label)} value={shift(b.id)[mode]} track={track(b, mode)} onLive={(v) => set(b.id, mode, v)} onDone={onDone} />
      ))}
    </>
  );
}

// ── Detail ──

export function DetailPanel({ a, onLive, onDone }: PanelProps) {
  const s = (k: keyof PhotoAdjust, label: string, fallback = 0) => (
    <Slider
      key={k}
      label={label}
      value={(a[k] as number | undefined) ?? fallback}
      min={0}
      center={fallback}
      onLive={(v) => onLive({ [k]: v })}
      onDone={onDone}
    />
  );
  return (
    <>
      <Label>{t('Sharpening')}</Label>
      {s('sharpen', t('Amount'))}
      {s('sharpenRadius', t('Radius'), 30)}
      {s('sharpenDetail', t('Detail'), 25)}
      {s('sharpenMasking', t('Masking'))}
      <Label>{t('Noise reduction')}</Label>
      {s('noise', t('Luminance'))}
      {s('noiseDetail', t('Detail'), 50)}
      {s('noiseContrast', t('Contrast'))}
      {s('colorNoise', t('Color'))}
      {s('colorNoiseDetail', t('Detail##warna'), 50)}
      {s('colorNoiseSmooth', t('Smoothness'), 50)}
    </>
  );
}

export const DETAIL_RESET: Partial<PhotoAdjust> = {
  sharpen: undefined,
  sharpenRadius: undefined,
  sharpenDetail: undefined,
  sharpenMasking: undefined,
  noise: undefined,
  noiseDetail: undefined,
  noiseContrast: undefined,
  colorNoise: undefined,
  colorNoiseDetail: undefined,
  colorNoiseSmooth: undefined,
};

// ── Effects ──

export function EffectsPanel({ a, onLive, onDone }: PanelProps) {
  const v = { amount: 0, ...a.vignette };
  const setV = (patch: Partial<typeof v>) => {
    const next = { ...v, ...patch };
    onLive({ vignette: next.amount ? next : undefined });
  };
  const n = (k: keyof PhotoAdjust, fallback = 0) => (a[k] as number | undefined) ?? fallback;
  return (
    <>
      <Label>{t('Vignette')}</Label>
      <Slider label={t('Amount')} value={v.amount} onLive={(x) => setV({ amount: x })} onDone={onDone} />
      <Slider label={t('Midpoint')} value={v.midpoint ?? 50} min={0} center={50} onLive={(x) => setV({ midpoint: x })} onDone={onDone} />
      <Slider label={t('Roundness')} value={v.roundness ?? 0} onLive={(x) => setV({ roundness: x })} onDone={onDone} />
      <Slider label={t('Feather')} value={v.feather ?? 50} min={0} center={50} onLive={(x) => setV({ feather: x })} onDone={onDone} />
      <Label>{t('Grain')}</Label>
      <Slider label={t('Amount')} value={n('grain')} min={0} onLive={(x) => onLive({ grain: x || undefined })} onDone={onDone} />
      <Slider label={t('Size')} value={n('grainSize', 25)} min={0} center={25} onLive={(x) => onLive({ grainSize: x })} onDone={onDone} />
      <Slider label={t('Roughness')} value={n('grainRough', 50)} min={0} center={50} onLive={(x) => onLive({ grainRough: x })} onDone={onDone} />
      <Label>{t('Matte')}</Label>
      <Slider label={t('Fade')} value={n('fade')} min={0} onLive={(x) => onLive({ fade: x })} onDone={onDone} />
    </>
  );
}

export const EFFECTS_RESET: Partial<PhotoAdjust> = {
  vignette: undefined,
  grain: undefined,
  grainSize: undefined,
  grainRough: undefined,
  fade: 0,
};

// ── Color Grading ──

type Range = 'shadows' | 'midtones' | 'highlights' | 'global';
const RANGES: { id: Range; label: string }[] = [
  { id: 'shadows', label: 'Shadows' },
  { id: 'midtones', label: 'Midtones' },
  { id: 'highlights', label: 'Highlights' },
  { id: 'global', label: 'Global' },
];
// Hue 0 (red) at the right, going round counter-clockwise, as a color wheel.
const WHEEL = `conic-gradient(from 90deg, ${Array.from({ length: 13 }, (_, i) => `hsl(${360 - i * 30} 80% 55%)`).join(', ')})`;

export function GradePanel({ a, onLive, onDone }: PanelProps) {
  const [range, setRange] = useState<Range>('midtones');
  const wheel: GradeWheel = { hue: 0, sat: 0, lum: 0, ...a.grade?.[range] };
  const set = (patch: Partial<GradeWheel> & Partial<{ blending: number; balance: number }>) => {
    const { blending, balance, ...w } = patch;
    const grade = { ...a.grade };
    if (Object.keys(w).length) grade[range] = { ...wheel, ...w };
    if (blending != null) grade.blending = blending;
    if (balance != null) grade.balance = balance;
    const empty = RANGES.every((r) => !grade[r.id] || (!grade[r.id]!.sat && !grade[r.id]!.lum));
    onLive({ grade: empty ? undefined : grade });
  };
  const ref = useRef<HTMLDivElement>(null);
  const drag = (e: React.PointerEvent) => {
    const el = ref.current!;
    el.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      const x = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const y = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const hue = ((Math.atan2(-y, x) * 180) / Math.PI + 360) % 360;
      set({ hue: Math.round(hue), sat: Math.round(Math.min(1, Math.hypot(x, y)) * 100) });
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      onDone();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const rad = (wheel.hue * Math.PI) / 180;
  const px = 50 + Math.cos(rad) * (wheel.sat / 100) * 50;
  const py = 50 - Math.sin(rad) * (wheel.sat / 100) * 50;
  return (
    <>
      <div className="grid grid-cols-4 gap-1 rounded-[10px] bg-panel-2 p-[3px]">
        {RANGES.map((r) => {
          const used = !!(a.grade?.[r.id]?.sat || a.grade?.[r.id]?.lum);
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              className={cx('relative h-7 rounded-lg text-[11px]', range === r.id ? 'bg-raised font-semibold text-fg' : 'text-muted hover:text-fg')}
            >
              {t(r.label)}
              {used && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-gold" />}
            </button>
          );
        })}
      </div>
      <div className="flex justify-center py-1">
        <div
          ref={ref}
          onPointerDown={drag}
          onDoubleClick={() => (set({ hue: 0, sat: 0 }), onDone())}
          title={t('Seret untuk memilih warna, klik dua kali untuk menghapus')}
          className="relative size-40 touch-none rounded-full"
          style={{ background: WHEEL }}
        >
          <span className="pointer-events-none absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle, rgb(128 128 128) 0%, rgb(128 128 128 / 0) 70%)' }} />
          <span
            className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
            style={{ left: `${px}%`, top: `${py}%`, background: `hsl(${wheel.hue} ${wheel.sat}% 50%)` }}
          />
        </div>
      </div>
      <span className="flex justify-between text-[11px] text-faint tabular-nums">
        <span>
          {t('Hue')} {wheel.hue}°
        </span>
        <span>
          {t('Saturation')} {wheel.sat}
        </span>
      </span>
      <Slider label={t('Luminance')} value={wheel.lum} onLive={(v) => set({ lum: v })} onDone={onDone} />
      <Slider label={t('Blending')} value={a.grade?.blending ?? 50} min={0} center={50} onLive={(v) => set({ blending: v })} onDone={onDone} />
      <Slider label={t('Balance')} value={a.grade?.balance ?? 0} onLive={(v) => set({ balance: v })} onDone={onDone} />
    </>
  );
}
