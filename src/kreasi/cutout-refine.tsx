/**
 * Rapikan potongan: touching up a Hapus latar cut-out with a brush. "Hapus"
 * takes away what the model kept by mistake; "Kembalikan" paints the photo
 * back where it cut too much. Works on the cut-out at the size of the
 * photo's place (its `-penuh` file), so even a lost arm comes back.
 */

import { Eraser, Paintbrush, RotateCcw, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button, Segmented, cx } from '../components/ui';
import { t } from '../lib/i18n';
import { cutoutParts, saveCutout } from './assets';
import { trimCutout } from './engine/cutout';
import type { CollageDoc, StickerLayer } from './engine/document';
import { frameOf } from './engine/render';

type Tool = 'hapus' | 'kembalikan';

/** Largest the picture is shown in the dialog (CSS px). */
const VIEW = { w: 640, h: 520 };
const UNDO = 30;

const canvasOf = (img: CanvasImageSource & { width: number; height: number }) => {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return c;
};

export function CutoutRefine({
  layer,
  doc,
  onSave,
  onClose,
}: {
  layer: StickerLayer;
  doc: CollageDoc;
  /** The element's new picture and where it sits now. */
  onSave: (patch: Pick<StickerLayer, 'sticker' | 'size' | 'x' | 'y' | 'ratio'>) => void;
  onClose: () => void;
}) {
  const view = useRef<HTMLCanvasElement>(null);
  const work = useRef<HTMLCanvasElement | null>(null);
  const start = useRef<HTMLCanvasElement | null>(null);
  const original = useRef<HTMLCanvasElement | null>(null);
  const undo = useRef<ImageData[]>([]);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [tool, setTool] = useState<Tool>('hapus');
  const [size, setSize] = useState(36);
  const [showPhoto, setShowPhoto] = useState(true);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [steps, setSteps] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    cutoutParts(layer.sticker).then((parts) => {
      if (!alive) return;
      if (!parts) return setReady('missing');
      original.current = canvasOf(parts.original);
      start.current = canvasOf(parts.full);
      work.current = canvasOf(parts.full);
      setReady('ok');
    });
    return () => {
      alive = false;
    };
  }, [layer.sticker]);

  const W = work.current?.width ?? 1;
  const H = work.current?.height ?? 1;
  const k = Math.min(VIEW.w / W, VIEW.h / H, 1);

  /** Draws the view: the photo faintly under, the cut-out on top. */
  const paint = () => {
    const c = view.current;
    if (!c || !work.current || !original.current) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(W * k * dpr);
    c.height = Math.round(H * k * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (showPhoto) {
      ctx.globalAlpha = 0.25;
      ctx.drawImage(original.current, 0, 0);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(work.current, 0, 0);
  };
  useEffect(paint, [ready, showPhoto, steps, k]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        back();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const toImage = (e: React.PointerEvent) => {
    const r = view.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  /** One brush stroke from `a` to `b` (image px). */
  const stroke = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const w = work.current!;
    const ctx = w.getContext('2d')!;
    const r = size / k / 2;
    const line = (c: CanvasRenderingContext2D) => {
      c.lineCap = 'round';
      c.lineJoin = 'round';
      c.lineWidth = r * 2;
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.lineTo(b.x + 0.01, b.y);
      c.stroke();
    };
    if (tool === 'hapus') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      line(ctx);
      ctx.restore();
      return;
    }
    // The photo, only under the brush, painted back over the cut-out.
    const x0 = Math.max(0, Math.floor(Math.min(a.x, b.x) - r - 1));
    const y0 = Math.max(0, Math.floor(Math.min(a.y, b.y) - r - 1));
    const x1 = Math.min(W, Math.ceil(Math.max(a.x, b.x) + r + 1));
    const y1 = Math.min(H, Math.ceil(Math.max(a.y, b.y) + r + 1));
    if (x1 <= x0 || y1 <= y0) return;
    const tmp = document.createElement('canvas');
    tmp.width = x1 - x0;
    tmp.height = y1 - y0;
    const tc = tmp.getContext('2d')!;
    tc.translate(-x0, -y0);
    line(tc);
    tc.globalCompositeOperation = 'source-in';
    tc.drawImage(original.current!, 0, 0);
    ctx.drawImage(tmp, x0, y0);
  };

  const down = (e: React.PointerEvent) => {
    if (ready !== 'ok') return;
    (e.target as Element).setPointerCapture(e.pointerId);
    undo.current = [...undo.current, work.current!.getContext('2d')!.getImageData(0, 0, W, H)].slice(-UNDO);
    const p = toImage(e);
    last.current = p;
    stroke(p, p);
    setSteps((n) => n + 1);
  };
  const move = (e: React.PointerEvent) => {
    const p = toImage(e);
    setCursor({ x: p.x * k, y: p.y * k });
    if (!last.current) return;
    stroke(last.current, p);
    last.current = p;
    paint();
  };
  const up = () => {
    last.current = null;
    setSteps((n) => n + 1);
  };
  const back = () => {
    const prev = undo.current.pop();
    if (!prev || !work.current) return;
    work.current.getContext('2d')!.putImageData(prev, 0, 0);
    setSteps((n) => n + 1);
  };
  const reset = () => {
    if (!work.current || !start.current) return;
    undo.current = [...undo.current, work.current.getContext('2d')!.getImageData(0, 0, W, H)].slice(-UNDO);
    const ctx = work.current.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(start.current, 0, 0);
    setSteps((n) => n + 1);
  };

  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!work.current || !start.current || !original.current) return;
    const now = trimCutout(work.current);
    const was = trimCutout(start.current);
    if (!now || !was) {
      setError(t('Semuanya terhapus. Kembalikan sebagian subjek dulu.'));
      return;
    }
    setSaving(true);
    try {
      const sticker = await saveCutout(now.canvas, original.current, work.current);
      // Where the kept part moved within the photo's place, in canvas terms.
      const f = frameOf(doc, 1000 * doc.slides);
      const perPx = (layer.size * f.unit) / was.w;
      const dx = (now.x + now.w / 2 - (was.x + was.w / 2)) * perPx;
      const dy = (now.y + now.h / 2 - (was.y + was.h / 2)) * perPx;
      const a = (layer.rotate * Math.PI) / 180;
      onSave({
        sticker,
        size: (layer.size * now.w) / was.w,
        x: layer.x + (dx * Math.cos(a) - dy * Math.sin(a)) / f.width,
        y: layer.y + (dx * Math.sin(a) + dy * Math.cos(a)) / f.height,
        ratio: now.h / now.w,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => !saving && onClose()}>
      <div
        role="dialog"
        aria-label={t('Rapikan potongan')}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full max-w-full flex-col gap-4 overflow-y-auto rounded-[18px] border border-line bg-panel p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{t('Rapikan potongan')}</h2>
            <p className="text-xs text-faint">{t('Hapus bagian yang ikut terpotong, atau kembalikan bagian subjek yang hilang.')}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>

        {ready === 'missing' ? (
          <p className="max-w-[420px] text-[13px] text-muted">{t('Elemen ini dibuat sebelum fitur rapikan ada. Hapus latar foto aslinya lagi untuk bisa merapikannya.')}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-56">
                <Segmented<Tool>
                  value={tool}
                  onChange={setTool}
                  options={[
                    { value: 'hapus', label: <><Eraser size={13} /> {t('Hapus##kuas')}</> },
                    { value: 'kembalikan', label: <><Paintbrush size={13} /> {t('Kembalikan')}</> },
                  ]}
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted">
                {t('Ukuran kuas')}
                <input type="range" min={6} max={160} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-28" />
              </label>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <input type="checkbox" checked={showPhoto} onChange={(e) => setShowPhoto(e.target.checked)} className="accent-[var(--color-gold)]" />
                {t('Tampilkan foto asli')}
              </label>
              <span className="ml-auto flex gap-1.5">
                <Button variant="plain" icon={Undo2} onClick={back} disabled={!undo.current.length}>
                  {t('Urungkan')}
                </Button>
                <Button variant="plain" icon={RotateCcw} onClick={reset}>
                  {t('Ulang')}
                </Button>
              </span>
            </div>
            <div
              className="relative self-center overflow-hidden rounded-lg bg-[repeating-conic-gradient(#2a3a33_0_25%,#1a2622_0_50%)] bg-[length:16px_16px]"
              style={{ width: W * k, height: H * k }}
            >
              {ready === 'loading' && <span className="absolute inset-0 flex items-center justify-center text-xs text-faint">{t('Memuat…')}</span>}
              <canvas
                ref={view}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerLeave={() => setCursor(null)}
                className="block cursor-none touch-none"
                style={{ width: W * k, height: H * k }}
              />
              {cursor && (
                <span
                  className={cx('pointer-events-none absolute rounded-full border-2', tool === 'hapus' ? 'border-reject' : 'border-pick')}
                  style={{ left: cursor.x - size / 2, top: cursor.y - size / 2, width: size, height: size }}
                />
              )}
            </div>
            {error && <p className="text-xs text-reject">{error}</p>}
            <div className="flex justify-end gap-2.5">
              <Button variant="plain" onClick={onClose} disabled={saving}>
                {t('Batal')}
              </Button>
              <Button variant="primary" onClick={save} disabled={saving || ready !== 'ok'}>
                {saving ? t('Menyimpan…') : t('Simpan')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
