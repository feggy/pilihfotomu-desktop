/**
 * Edit foto › Hapus objek: what is painted over is filled in from around it
 * (kreasi/engine/inpaint.ts, PatchMatch — offline, no AI model), each sweep
 * on its own, in order. Kept as the sweeps (shares of the photo), so it
 * holds at any size: the preview and the full-size export fill the same
 * places. Good for small things — a passer-by, a sign, a cable, a spot.
 */

import { Eraser, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

import { num } from '../lib/format';
import { t } from '../lib/i18n';
import { inpaint } from '../kreasi/engine/inpaint';
import { newId } from '../kreasi/engine/document';
import { previewUrl } from '../kreasi/canvas';
import type { LocalAdjust } from '../kreasi/engine/document';
import { loadLocalImage } from '../kreasi/kit';
import { BrushRing } from './cursors';
import { landmarksOf, peopleMask, type FacePart } from './people-mask';
import { Slider } from './panels';
import { ToolBox, ToolRow } from './tool-box';
import type { EditSettings, HealSpot } from './geometry';


// ── Filling ──

const cache = new Map<string, HTMLCanvasElement>();
const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object) => {
  let id = ids.get(o);
  if (!id) ids.set(o, (id = nextId++));
  return id;
};

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
    mc.strokeStyle = mc.fillStyle = '#fff';
    mc.lineCap = mc.lineJoin = 'round';
    mc.lineWidth = Math.max(2, s.size * w);
    const [first, ...rest] = s.points;
    if (!first) continue;
    mc.beginPath();
    if (!rest.length) {
      mc.arc(first[0] * w, first[1] * h, mc.lineWidth / 2, 0, Math.PI * 2);
      mc.fill();
    } else {
      mc.moveTo(first[0] * w, first[1] * h);
      for (const [x, y] of rest) mc.lineTo(x * w, y * h);
      mc.stroke();
    }
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

/** The mask Retouch kulit makes: one soft oval per face found in the photo. */
const SKIN = 'kulit-wajah';

/** `a` with the faces' skin smoothed by `v` (0–100); 0 takes the mask away. */
export function withSkin(a: EditSettings, faces: { x: number; y: number; w: number; h: number }[], v: number): EditSettings {
  const masks = (a.masks ?? []).filter((m) => m.id !== SKIN);
  if (!v || !faces.length) return { ...a, masks: masks.length ? masks : undefined };
  const parts = faces.slice(0, 8).map((f, i) => ({
    id: `${SKIN}-${i}`,
    kind: 'radial' as const,
    cx: f.x + f.w / 2,
    cy: f.y + f.h * 0.55,
    rx: f.w * 0.55,
    ry: f.h * 0.62,
    feather: 70,
  }));
  return { ...a, masks: [...masks, { id: SKIN, parts, adjust: { texture: -v, clarity: -Math.round(v * 0.4), noise: Math.round(v * 0.3) } }] };
}
export const skinOf = (a: EditSettings) => -((a.masks ?? []).find((m) => m.id === SKIN)?.adjust.texture ?? 0);

/**
 * Cerahkan mata and Putihkan gigi: a mask of every face's eyes (whites and
 * irises) or teeth, from the face's points, and what each slider does to it.
 * `of` reads the slider back from the mask's sliders.
 */
const RETOUCH = {
  'retouch-mata': {
    parts: ['sklera', 'iris'] as FacePart[],
    adjust: (v: number): LocalAdjust => ({ exposure: Math.round(v * 0.3), clarity: Math.round(v * 0.4), saturation: Math.round(v * 0.1) }),
    of: (l: LocalAdjust) => Math.round((l.clarity ?? 0) / 0.4),
  },
  'retouch-gigi': {
    parts: ['gigi'] as FacePart[],
    adjust: (v: number): LocalAdjust => ({ exposure: Math.round(v * 0.3), saturation: -Math.round(v * 0.6), temp: -Math.round(v * 0.15) }),
    of: (l: LocalAdjust) => Math.round(-(l.saturation ?? 0) / 0.6),
  },
};
type RetouchId = keyof typeof RETOUCH;
export const retouchOf = (a: EditSettings, id: RetouchId) => {
  const m = (a.masks ?? []).find((x) => x.id === id);
  return m ? RETOUCH[id].of(m.adjust) : 0;
};
/** The mask's own picture (all faces' parts), made once a photo. */
async function retouchMask(root: string, photoId: number, id: RetouchId): Promise<string | null> {
  const points = await landmarksOf(root, photoId).catch(() => []);
  if (!points.length) return null;
  const img = await loadLocalImage(await previewUrl(root, photoId));
  return peopleMask(root, photoId, img, points, points.map((_, i) => i), RETOUCH[id].parts);
}
function withRetouch(a: EditSettings, id: RetouchId, subject: string, v: number): Partial<EditSettings> {
  const masks = (a.masks ?? []).filter((m) => m.id !== id);
  if (!v) return { masks: masks.length ? masks : undefined };
  return { masks: [...masks, { id, parts: [{ id: `${id}-0`, kind: 'subject', subject }], adjust: RETOUCH[id].adjust(v) }] };
}

/** A Retouch slider: its mask worked out on first use (a moment), then live. */
function RetouchSlider({ root, photoId, a, id, label, onLive, onDone }: { root: string; photoId: number; a: EditSettings; id: RetouchId; label: string; onLive: (p: Partial<EditSettings>) => void; onDone: () => void }) {
  const [subject, setSubject] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [none, setNone] = useState(false);
  const existing = (a.masks ?? []).find((m) => m.id === id)?.parts?.[0]?.subject ?? null;
  const ready = existing ?? subject;
  const value = retouchOf(a, id);
  const live = async (v: number) => {
    if (ready) return onLive(withRetouch(a, id, ready, v));
    if (busy || none) return;
    setBusy(true);
    const made = await retouchMask(root, photoId, id).catch(() => null);
    setBusy(false);
    if (!made) return setNone(true);
    setSubject(made);
    onLive(withRetouch(a, id, made, v));
    onDone();
  };
  return (
    <div className="flex flex-col gap-1">
      <Slider label={label} value={value} min={0} max={100} center={0} onLive={live} onDone={onDone} />
      {busy && <p className="animate-pulse text-[11px] text-faint">{t('Membaca wajah…')}</p>}
      {none && <p className="text-[11px] text-faint">{t('Tidak ada wajah yang terbaca jelas.')}</p>}
    </div>
  );
}

export function HealPanel({
  root,
  photoId,
  a,
  faces,
  size,
  onSize,
  onLive,
  onDone,
  onClose,
}: {
  root: string;
  photoId: number;
  a: EditSettings;
  /** The faces found in this photo (shares of it). */
  faces: { x: number; y: number; w: number; h: number }[];
  size: number;
  onSize: (v: number) => void;
  onLive: (patch: Partial<EditSettings>) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const spots = a.heal ?? [];
  const skin = skinOf(a);
  return (
    <ToolBox title={t('Hapus objek')} onClose={onClose}>
      <ToolRow>
      <p className="text-xs leading-relaxed text-muted">
        {t('Sapukan di atas yang mau dihapus: orang di latar, papan, kabel, noda. Bagian itu diisi dari sekitarnya, di komputer ini.')}
      </p>
      <Slider label={t('Ukuran kuas')} value={Math.round(size * 100)} min={1} max={30} center={4} onLive={(v) => onSize(v / 100)} onDone={() => {}} />
      <p className="text-[11px] text-faint">{t('[ dan ] mengubah ukuran kuas. Cocok untuk benda kecil; area besar di atas detail hasilnya bisa kurang rapi.')}</p>
      </ToolRow>
      <ToolRow className="gap-3">
        <span className="text-xs font-semibold">{t('Retouch kulit cepat')}</span>
        {faces.length ? (
          <>
            <Slider
              label={t('Haluskan kulit')}
              value={skin}
              min={0}
              max={100}
              center={0}
              onLive={(v) => onLive({ masks: withSkin(a, faces, v).masks })}
              onDone={onDone}
            />
            <p className="text-[11px] text-faint">
              {t('Hanya di {count} wajah yang ditemukan di foto ini. Tekstur kulit tetap ada, tidak seperti filter.', { n: faces.length, count: num(faces.length) })}
            </p>
            <RetouchSlider root={root} photoId={photoId} a={a} id="retouch-mata" label={t('Cerahkan mata')} onLive={onLive} onDone={onDone} />
            <RetouchSlider root={root} photoId={photoId} a={a} id="retouch-gigi" label={t('Putihkan gigi')} onLive={onLive} onDone={onDone} />
          </>
        ) : (
          <p className="text-[11px] text-faint">{t('Tidak ada wajah yang ditemukan di foto ini.')}</p>
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

/** Over the photo: the brush, and the sweep in red until it is let go (then it is filled). */
export function HealLayer({ a, size, onSize, onLive, onDone }: { a: EditSettings; size: number; onSize: (v: number) => void; onLive: (patch: Partial<EditSettings>) => void; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [sweep, setSweep] = useState<[number, number][] | null>(null);
  const at = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    let pts: [number, number][] = [at(e)];
    setSweep(pts);
    const move = (ev: PointerEvent) => {
      pts = [...pts, at(ev)];
      setSweep(pts);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setSweep(null);
      onLive({ heal: [...(a.heal ?? []), { id: newId(), size, points: pts }] });
      onDone();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const w = box.current?.clientWidth ?? 1;
  const h = box.current?.clientHeight ?? 1;
  return (
    <div
      ref={box}
      tabIndex={-1}
      onKeyDown={(e) => (e.key === '[' || e.key === ']') && onSize(Math.min(0.3, Math.max(0.01, size * (e.key === ']' ? 1.2 : 1 / 1.2))))}
      className="absolute inset-0 cursor-none outline-none"
      onPointerDown={down}
      onPointerMove={(e) => setCursor({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
      onPointerLeave={() => setCursor(null)}
    >
      {sweep && (
        <svg className="pointer-events-none absolute inset-0 size-full">
          <polyline
            points={sweep.map(([x, y]) => `${x * w},${y * h}`).join(' ')}
            fill="none"
            stroke="rgb(255 45 85 / 0.55)"
            strokeWidth={size * w}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {cursor && (
        <BrushRing x={cursor.x} y={cursor.y} size={size * w} feather={0} />
      )}
    </div>
  );
}
