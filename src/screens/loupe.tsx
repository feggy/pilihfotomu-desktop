/**
 * Loupe: one photo large, with the neighbours in a filmstrip, the verdict
 * and its reasons, stars, and the file's details — what the grid can only
 * hint at. Opened with Space or a double-click from the review grid.
 */

import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Eye,
  LoaderCircle,
  FolderSearch,
  Info,
  Layers,
  Minus,
  Plus,
  ScanFace,
  Sparkles,
  Star,
  SunMedium,
  X,
  type LucideIcon,
  Smile,
} from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { Button, Chip, Dot, Kbd, StatusBadge, STATUS_ICON, cx } from '../components/ui';
import { api, eyesClosed, thumbUrl, type PhotoEntry, type Status } from '../lib/api';
import { clock, eyeSummary,
  smileSummary as smileOf, num, REASON, shotDate, STATUS, toneColor } from '../lib/format';
import { actionFor, useKey, type Action } from '../lib/keys';
import { useApp } from '../store';

const STATUS_OF: Partial<Record<Action, Status>> = { pick: 'pick', maybe: 'maybe', reject: 'reject' };
const MAX_ZOOM = 8;

/** Zoom/pan of the photo: `s` × fitted size, shifted by (x, y) screen px. */
interface View {
  s: number;
  x: number;
  y: number;
}
const FIT: View = { s: 1, x: 0, y: 0 };

/** Filmstrip items rendered on each side of the current photo. */
const STRIP_SPAN = 30;
const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function Loupe({
  photos,
  root,
  onClose,
  onCompare,
}: {
  /** The photos the grid shows right now (its filters apply here too). */
  photos: PhotoEntry[];
  root: string;
  onClose: () => void;
  onCompare: (group: number) => void;
}) {
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const setStatus = useApp((s) => s.setStatus);
  const setRating = useApp((s) => s.setRating);
  const [info, setInfo] = useState(true);
  const kPick = useKey('pick');
  const kMaybe = useKey('maybe');
  const kReject = useKey('reject');
  const kZoom = useKey('zoom');
  const [showFaces, setShowFaces] = useState(true);
  const [previews, setPreviews] = useState<Record<number, string>>({});
  const asked = useRef(new Set<number>());
  // Full resolution, decoded from the RAW on request (or when zooming past
  // what the preview holds). Cached on disk by the backend.
  const [full, setFull] = useState<Record<number, string>>({});
  const [loadingFull, setLoadingFull] = useState<Set<number>>(new Set());
  const [fullError, setFullError] = useState<Record<number, string>>({});
  const [canFull, setCanFull] = useState(false);
  // Photos switched back to the camera preview after full quality was loaded.
  const [usePreview, setUsePreview] = useState<Set<number>>(new Set());
  const togglePreview = (id: number, on: boolean) =>
    setUsePreview((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  useEffect(() => {
    api.fullResSupported().then(setCanFull, () => setCanFull(false));
  }, []);

  const index = Math.max(0, photos.findIndex((p) => p.id === selectedId));
  const photo = photos[index];

  // ── Zoom & pan ────────────────────────────────────────────────
  const area = useRef<HTMLDivElement>(null);
  const pic = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>(FIT);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  useEffect(() => setView(FIT), [photo?.id]);

  /** Keeps the picture from being dragged out of sight. */
  const clamp = (v: View): View => {
    if (v.s <= 1.001) return FIT;
    const w = pic.current?.offsetWidth ?? 0;
    const h = pic.current?.offsetHeight ?? 0;
    const mx = ((v.s - 1) * w) / 2;
    const my = ((v.s - 1) * h) / 2;
    return { s: v.s, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
  };

  /** Zooms to `s`, keeping the point under (clientX, clientY) still. */
  const zoomAt = (s: number, clientX?: number, clientY?: number) =>
    setView((v) => {
      const next = Math.max(1, Math.min(MAX_ZOOM, s));
      const r = area.current?.getBoundingClientRect();
      if (!r) return v;
      const cx = (clientX ?? r.left + r.width / 2) - (r.left + r.width / 2);
      const cy = (clientY ?? r.top + r.height / 2) - (r.top + r.height / 2);
      const qx = (cx - v.x) / v.s;
      const qy = (cy - v.y) / v.s;
      return clamp({ s: next, x: cx - next * qx, y: cy - next * qy });
    });

  /** Fills ~60 % of the view with one face. */
  const zoomToFace = (f: { x: number; y: number; w: number; h: number }) => {
    const w = pic.current?.offsetWidth ?? 1;
    const h = pic.current?.offsetHeight ?? 1;
    const r = area.current?.getBoundingClientRect();
    const s = Math.max(1.5, Math.min(MAX_ZOOM, ((r?.height ?? h) * 0.6) / (f.h * h)));
    const qx = (f.x + f.w / 2 - 0.5) * w;
    const qy = (f.y + f.h / 2 - 0.5) * h;
    setView(clamp({ s, x: -s * qx, y: -s * qy }));
  };

  // Wheel / trackpad pinch: needs a non-passive listener to stop page scroll.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      setView((v) => {
        const next = Math.max(1, Math.min(MAX_ZOOM, v.s * factor));
        const r = el.getBoundingClientRect();
        const cx = e.clientX - (r.left + r.width / 2);
        const cy = e.clientY - (r.top + r.height / 2);
        const qx = (cx - v.x) / v.s;
        const qy = (cy - v.y) / v.s;
        return clamp({ s: next, x: cx - next * qx, y: cy - next * qy });
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || view.s <= 1) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.moved) setView(clamp({ s: view.s, x: d.vx + dx, y: d.vy + dy }));
  };
  /** A click (not the end of a drag) on the picture: zoom in there, or back to fit. */
  const onPictureClick = (e: React.MouseEvent) => {
    const moved = drag.current?.moved;
    drag.current = null;
    if (moved) return;
    if (view.s > 1) setView(FIT);
    else zoomAt(3, e.clientX, e.clientY);
  };

  const go = (i: number) => {
    if (i >= 0 && i < photos.length) select(photos[i].id);
  };

  // Large previews: this photo, then its neighbours so stepping is instant.
  useEffect(() => {
    for (const p of [photos[index], photos[index + 1], photos[index - 1]]) {
      if (!p || asked.current.has(p.id)) continue;
      asked.current.add(p.id);
      api.previewImage(root, p.id).then(
        (path) => setPreviews((m) => ({ ...m, [p.id]: path })),
        () => {}, // keep showing the thumbnail
      );
    }
  }, [index, photos, root]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || !photo) return;
      if (useApp.getState().screen.name !== 'review') return;
      const k = e.key.toLowerCase();
      const action = actionFor(k);
      const mark = action && STATUS_OF[action];
      if (mark) {
        e.preventDefault();
        setStatus([photo.id], mark);
        go(index + 1);
      } else if (/^[0-5]$/.test(k)) {
        e.preventDefault();
        setRating([photo.id], Number(k));
      } else if (k === 'arrowright' || k === 'arrowdown') {
        e.preventDefault();
        go(index + 1);
      } else if (k === 'arrowleft' || k === 'arrowup') {
        e.preventDefault();
        go(index - 1);
      } else if (action === 'info') {
        setInfo((v) => !v);
      } else if (action === 'faces') {
        setShowFaces((v) => !v);
      } else if (action === 'compare' && photo.group != null) {
        onCompare(photo.group);
      } else if (action === 'zoom') {
        if (view.s > 1) setView(FIT);
        else zoomAt(3);
      } else if (k === '=' || k === '+') {
        zoomAt(view.s * 1.5);
      } else if (k === '-') {
        zoomAt(view.s / 1.5);
      } else if (k === 'escape' && view.s > 1) {
        setView(FIT);
      } else if (k === 'escape' || k === ' ') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Keep the current photo in view in the filmstrip.
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    strip.current?.querySelector('[data-current]')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
  }, [index]);

  const loadFull = (id: number) => {
    togglePreview(id, false);
    if (!canFull || full[id] || loadingFull.has(id) || fullError[id]) return;
    setLoadingFull((s) => new Set(s).add(id));
    api.fullResImage(root, id).then(
      (r) => setFull((m) => ({ ...m, [id]: r.path })),
      (e) => setFullError((m) => ({ ...m, [id]: String(e) })),
    ).finally(() =>
      setLoadingFull((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      }),
    );
  };

  // Zoomed past the preview's own pixels: it would look soft, so fetch the real thing.
  useEffect(() => {
    const img = pic.current;
    // …unless the photographer chose the preview for this photo.
    if (!photo || !img || view.s <= 1 || full[photo.id] || usePreview.has(photo.id)) return;
    if (img.offsetWidth * view.s > img.naturalWidth * 1.05) loadFull(photo.id);
  });

  if (!photo) return null;
  const showFull = full[photo.id] && !usePreview.has(photo.id);
  const src = (showFull ? full[photo.id] : null) ?? previews[photo.id] ?? photo.thumb;
  const quality: 'full' | 'loading' | 'preview' = showFull
    ? 'full'
    : loadingFull.has(photo.id)
      ? 'loading'
      : 'preview';
  const from = Math.max(0, index - STRIP_SPAN);
  const around = photos.slice(from, index + STRIP_SPAN + 1);

  return (
    // Starts under the title bar so the macOS window buttons stay clear.
    <div className="fixed inset-x-0 top-10 bottom-0 z-50 flex flex-col bg-bg" role="dialog" aria-label="Lihat foto">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line-soft bg-panel px-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-md bg-raised px-2 py-0.5 text-xs font-medium text-muted tabular-nums">
            {num(index + 1)} / {num(photos.length)}
          </span>
          <StatusBadge status={photo.status} size={18} />
          <span className="truncate text-sm font-medium">{photo.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden items-center gap-1.5 text-[11px] text-faint lg:flex">
            <Kbd>← →</Kbd> pindah <Kbd>{kPick}</Kbd>
            <Kbd>{kMaybe}</Kbd>
            <Kbd>{kReject}</Kbd> tandai <Kbd>{kZoom}</Kbd> zoom
          </span>
          <div className="flex items-center rounded-lg border border-line bg-raised">
            <button
              type="button"
              onClick={() => zoomAt(view.s / 1.5)}
              disabled={view.s <= 1}
              aria-label="Perkecil"
              title="Perkecil (−)"
              className="inline-flex size-8 items-center justify-center text-muted hover:text-fg disabled:opacity-40"
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              onClick={() => (view.s > 1 ? setView(FIT) : zoomAt(3))}
              title="Zoom / pas layar (Z)"
              className="h-8 min-w-12 px-1 text-xs font-medium text-muted tabular-nums hover:text-fg"
            >
              {view.s > 1 ? `${Math.round(view.s * 100)}%` : 'Pas'}
            </button>
            <button
              type="button"
              onClick={() => zoomAt(view.s * 1.5)}
              disabled={view.s >= MAX_ZOOM}
              aria-label="Perbesar"
              title="Perbesar (+)"
              className="inline-flex size-8 items-center justify-center text-muted hover:text-fg disabled:opacity-40"
            >
              <Plus size={14} />
            </button>
          </div>
          {photo.faces?.length > 0 && (
            <button
              type="button"
              onClick={() => setShowFaces((v) => !v)}
              title="Tampilkan kotak wajah (F)"
              aria-label="Tampilkan kotak wajah"
              aria-pressed={showFaces}
              className={cx(
                'inline-flex size-8 items-center justify-center rounded-lg border',
                showFaces ? 'border-gold/60 bg-gold/10 text-gold-text' : 'border-line bg-raised text-muted hover:text-fg',
              )}
            >
              <ScanFace size={15} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setInfo((v) => !v)}
            title="Info foto (I)"
            aria-label="Info foto"
            aria-pressed={info}
            className={cx(
              'inline-flex size-8 items-center justify-center rounded-lg border',
              info ? 'border-gold/60 bg-gold/10 text-gold-text' : 'border-line bg-raised text-muted hover:text-fg',
            )}
          >
            <Info size={15} />
          </button>
          <button
            type="button"
            onClick={onClose}
            title="Tutup (Esc)"
            aria-label="Tutup"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-line bg-raised text-muted hover:text-fg"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          ref={area}
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-6"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={() => (drag.current = null)}
          // The picture's click handler reads the drag first, then this clears it.
          onPointerUp={() => setTimeout(() => (drag.current = null), 0)}
        >
          {src && (
            // The wrapper hugs the picture, so face boxes can be placed in %
            // of it — and zoom moves both together.
            <div
              className={cx(
                'relative max-h-full max-w-full',
                view.s > 1 ? (drag.current?.moved ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in',
                !drag.current?.moved && 'transition-transform duration-150 ease-out',
              )}
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
              onClick={onPictureClick}
            >
              <img
                ref={pic}
                key={photo.id}
                src={thumbUrl(src)}
                alt=""
                draggable={false}
                className="block max-h-[calc(100vh-232px)] max-w-full object-contain shadow-2xl"
              />
              {showFaces &&
                photo.faces?.map((f, i) => {
                  const closed = eyesClosed(f);
                  return (
                    <button
                      key={i}
                      type="button"
                      title="Perbesar wajah ini"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (drag.current?.moved) return;
                        drag.current = null;
                        zoomToFace(f);
                      }}
                      className={cx(
                        'absolute rounded-md hover:bg-white/10',
                        closed ? 'border-reject' : 'border-pick/80',
                      )}
                      // Border stays 2 screen px however far we zoom in.
                      style={{
                        left: `${f.x * 100}%`,
                        top: `${f.y * 100}%`,
                        width: `${f.w * 100}%`,
                        height: `${f.h * 100}%`,
                        borderWidth: 2 / view.s,
                        borderStyle: 'solid',
                      }}
                    >
                      {closed && (
                        <span
                          className="absolute bottom-full left-0 mb-1 origin-bottom-left rounded bg-reject px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-bg"
                          style={{ transform: `scale(${1 / view.s})` }}
                        >
                          Mungkin terpejam
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          )}
          {canFull && (
            <div className="absolute top-4 left-4 z-10 flex items-center gap-2" onPointerDown={(e) => e.stopPropagation()}>
              {quality === 'full' && (
                <>
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-panel/85 px-2.5 text-xs font-medium text-pick backdrop-blur">
                    <CircleCheck size={13} /> Kualitas penuh
                  </span>
                  <button
                    type="button"
                    onClick={() => togglePreview(photo.id, true)}
                    title="Kembali ke preview kamera (warna persis seperti di kamera)"
                    className="inline-flex h-7 items-center rounded-full border border-line bg-panel/85 px-2.5 text-xs font-medium text-muted backdrop-blur hover:text-fg"
                  >
                    Pakai pratinjau
                  </button>
                </>
              )}
              {quality === 'loading' && (
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-panel/85 px-2.5 text-xs font-medium text-muted backdrop-blur">
                  <LoaderCircle size={13} className="animate-spin" /> Memuat kualitas penuh…
                </span>
              )}
              {quality === 'preview' && (
                <>
                  <span
                    className="inline-flex h-7 items-center rounded-full bg-panel/85 px-2.5 text-xs font-medium text-faint backdrop-blur"
                    title="Gambar dari preview kamera — bisa buram kalau diperbesar"
                  >
                    Pratinjau
                  </span>
                  <button
                    type="button"
                    onClick={() => loadFull(photo.id)}
                    title="Decode file RAW asli supaya tetap tajam saat diperbesar (±1 detik)"
                    className="inline-flex h-7 items-center rounded-full border border-gold/60 bg-panel/85 px-2.5 text-xs font-medium text-gold-text backdrop-blur hover:bg-gold/15"
                  >
                    {full[photo.id] ? 'Pakai kualitas penuh' : 'Muat kualitas penuh'}
                  </button>
                </>
              )}
              {fullError[photo.id] && <span className="text-xs text-maybe">{fullError[photo.id]}</span>}
            </div>
          )}
          <NavButton side="left" disabled={index === 0} onClick={() => go(index - 1)} />
          <NavButton side="right" disabled={index === photos.length - 1} onClick={() => go(index + 1)} />
        </div>
        {info && <InfoPanel photo={photo} all={photos} onCompare={onCompare} setStatus={setStatus} setRating={setRating} />}
      </div>

      <div ref={strip} className="flex h-[88px] shrink-0 items-center gap-1.5 overflow-x-auto border-t border-line-soft bg-panel px-4">
        {around.map((p, i) => {
          const current = from + i === index;
          return (
            <button
              key={p.id}
              type="button"
              data-current={current || undefined}
              onClick={() => select(p.id)}
              title={p.name}
              className={cx(
                'relative h-16 w-24 shrink-0 overflow-hidden rounded-md bg-raised',
                current ? 'ring-2 ring-gold' : 'opacity-55 hover:opacity-100',
              )}
            >
              {p.thumb && <img src={thumbUrl(p.thumb)} alt="" loading="lazy" className="size-full object-cover" />}
              <span className="absolute top-1 left-1">
                <StatusBadge status={p.status} size={14} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NavButton({ side, disabled, onClick }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === 'left' ? 'Foto sebelumnya' : 'Foto berikutnya'}
      title={side === 'left' ? 'Sebelumnya (←)' : 'Berikutnya (→)'}
      className={cx(
        'absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-panel/85 text-fg shadow-lg backdrop-blur hover:bg-raised disabled:opacity-0',
        side === 'left' ? 'left-4' : 'right-4',
      )}
    >
      <Icon size={22} />
    </button>
  );
}

function InfoPanel({
  photo,
  all,
  onCompare,
  setStatus,
  setRating,
}: {
  photo: PhotoEntry;
  all: PhotoEntry[];
  onCompare: (group: number) => void;
  setStatus: (ids: number[], s: Status) => void;
  setRating: (ids: number[], r: number) => void;
}) {
  const m = photo.metrics;
  const siblings = photo.group != null ? all.filter((p) => p.group === photo.group).length : 0;
  const exposure = !m
    ? null
    : m.brightness < 35 || m.shadowsClipped > 0.45
      ? (['Gelap', 'maybe'] as const)
      : m.brightness > 225 || m.highlightsClipped > 0.3
        ? (['Terang', 'maybe'] as const)
        : (['Normal', 'pick'] as const);
  const sharpTone: Status = !m ? 'maybe' : m.sharpness >= 42 ? 'pick' : m.sharpness >= 25 ? 'maybe' : 'reject';
  const files = [photo.raw, photo.jpeg].filter(Boolean) as string[];
  const eyes = eyeSummary(photo);
  const formats = files.map((f) => f.split('.').pop()!.toUpperCase()).join(' + ');

  return (
    <aside className="flex w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line-soft bg-panel p-4">
      <section className="flex flex-col gap-2">
        <Title>Status</Title>
        <div className="flex gap-1.5">
          {(['pick', 'maybe', 'reject'] as const).map((st) => {
            const Icon = STATUS_ICON[st];
            const on = photo.status === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => setStatus([photo.id], st)}
                className={cx(
                  'flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold',
                  on ? 'text-bg' : 'border border-line bg-raised text-fg hover:bg-line',
                )}
                style={on ? { background: STATUS[st].color } : undefined}
              >
                <Icon size={14} style={on ? undefined : { color: STATUS[st].color }} strokeWidth={2.5} />
                {STATUS[st].one}
              </button>
            );
          })}
        </div>
        {photo.status !== photo.autoStatus && (
          <p className="text-[11px] text-faint">
            Diubah manual. Saran AI:{' '}
            <span style={{ color: STATUS[photo.autoStatus].color }}>{STATUS[photo.autoStatus].one}</span>
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <Title hint="tekan 1–5, 0 hapus">Bintang</Title>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating([photo.id], photo.rating === n ? 0 : n)}
              aria-label={`${n} bintang`}
              className="rounded p-0.5 hover:bg-raised"
            >
              <Star
                size={22}
                className={n <= photo.rating ? 'fill-gold-text text-gold-text' : 'text-line'}
                strokeWidth={n <= photo.rating ? 1.5 : 2}
              />
            </button>
          ))}
          <span className="ml-2 text-xs text-faint">{photo.rating ? `${photo.rating} dari 5` : 'Belum ada'}</span>
        </div>
      </section>

      <section className="flex flex-col gap-0.5 rounded-[10px] bg-panel-2 p-3">
        <span className="flex items-center gap-2 pb-1.5 text-xs font-semibold">
          <Sparkles size={14} className="text-gold-text" /> Penilaian AI
        </span>
        {photo.error ? (
          <p className="text-xs text-maybe">File tidak bisa dibaca: {photo.error}</p>
        ) : (
          m && (
            <>
              <Row icon={Sparkles} label="Ketajaman" value={`${Math.round(m.sharpness)}%`} tone={sharpTone} />
              {exposure && <Row icon={SunMedium} label="Eksposur" value={exposure[0]} tone={exposure[1]} />}
              {eyes && <Row icon={Eye} label="Mata" value={eyes.label} tone={eyes.tone} />}
              {smileOf(photo) && <Row icon={Smile} label="Ekspresi" value={smileOf(photo)!.label} tone={null} />}
              {photo.reasons.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {photo.reasons.map((r, i) => (
                    <Chip key={i} color={toneColor(REASON[r.kind].tone)} icon={REASON[r.kind].icon}>
                      {REASON[r.kind].label}
                    </Chip>
                  ))}
                </div>
              )}
            </>
          )
        )}
      </section>

      <section className="flex flex-col gap-2">
        <Title>Detail</Title>
        <dl className="flex flex-col text-xs">
          <Detail label="File" value={files.map(baseName).join('\n')} />
          <Detail label="Format" value={formats || '—'} />
          <Detail label="Kamera" value={photo.camera ?? '—'} />
          <Detail label="Dijepret" value={photo.takenAt != null ? `${shotDate(photo.takenAt)}, ${clock(photo.takenAt)}` : '—'} />
          <Detail label="Folder" value={photo.folder || 'Folder utama'} />
        </dl>
      </section>

      {siblings > 1 && photo.group != null && (
        <button
          type="button"
          onClick={() => onCompare(photo.group!)}
          className="flex items-center justify-between rounded-[10px] bg-panel-2 p-3 text-left hover:bg-raised"
        >
          <span className="flex items-center gap-2 text-xs font-semibold">
            <Layers size={14} className="text-gold-text" /> Grup burst · {siblings} foto
          </span>
          <span className="text-xs font-medium text-gold-text">Bandingkan (C)</span>
        </button>
      )}

      {files[0] && (
        <Button icon={FolderSearch} className="self-start" onClick={() => revealItemInDir(files[0])}>
          Tampilkan di {navigator.userAgent.includes('Mac') ? 'Finder' : 'Explorer'}
        </Button>
      )}
    </aside>
  );
}

function Title({ children, hint }: { children: string; hint?: string }) {
  return (
    <span className="flex items-center justify-between text-[11px] font-semibold tracking-wide text-faint uppercase">
      {children}
      {hint && <span className="font-normal tracking-normal normal-case">{hint}</span>}
    </span>
  );
}

/** `tone` null = information only: no coloured dot, which would read as a verdict. */
function Row({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: Status | 'gold' | null }) {
  return (
    <div className="flex h-[30px] items-center justify-between">
      <span className="flex items-center gap-2 text-xs text-muted">
        <Icon size={14} className="text-faint" /> {label}
      </span>
      <span className="flex items-center gap-1.5 text-xs font-medium">
        {tone && <Dot color={toneColor(tone)} size={6} />}
        {value}
      </span>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 border-b border-line-soft py-2 last:border-0">
      <dt className="w-16 shrink-0 text-faint">{label}</dt>
      <dd className="min-w-0 flex-1 break-all whitespace-pre-line text-fg">{value}</dd>
    </div>
  );
}
