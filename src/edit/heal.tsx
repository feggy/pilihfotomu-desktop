/**
 * Edit foto › Hapus objek: what is painted over is filled in from around it
 * (kreasi/engine/inpaint.ts, PatchMatch — offline, no AI model), each sweep
 * on its own, in order. Kept as the sweeps (shares of the photo), so it
 * holds at any size: the preview and the full-size export fill the same
 * places. Good for small things — a passer-by, a sign, a cable, a spot.
 */

import { Eraser, Minus, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button, cx } from '../components/ui';
import { num } from '../lib/format';
import { t } from '../lib/i18n';
import { inpaint } from '../kreasi/engine/inpaint';
import { newId } from '../kreasi/engine/document';
import { BrushRing, usePointerAt } from './cursors';
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

/** `src` (`w` × `h`) with its spots filled; the same canvas while nothing changes. */
export function healed(src: CanvasImageSource, w: number, h: number, spots: HealSpot[]): HTMLCanvasElement {
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
        <p className="text-[11px] leading-relaxed text-faint">
          {painted
            ? t('Tambah atau kurangi bagian yang ditandai merah, lalu Hapus. Tahan Alt sambil menyapu untuk sebaliknya.')
            : t('Tandai yang mau dihapus: orang di latar, papan, kabel, noda. Bagian itu diisi dari sekitarnya, di komputer ini.')}
        </p>
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
        {!painted && <p className="text-[11px] text-faint">{t('[ dan ] mengubah ukuran kuas. Cocok untuk benda kecil; area besar di atas detail hasilnya bisa kurang rapi.')}</p>}
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
      {pointer.at && <BrushRing x={pointer.at.x} y={pointer.at.y} size={size * w} feather={0} />}
    </div>
  );
}
