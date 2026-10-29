/**
 * Edit foto › Masking: parts of the photo edited on their own, as Lightroom's
 * Masking panel — the subject or the background (found offline, MODNet /
 * U²-Netp via `subjectMask`), a brush, a linear or radial gradient, a range
 * of colors or of brightness; each mask made of parts added or taken away,
 * with its own light and color. The engine does the drawing
 * (kreasi/engine/develop.ts: `maskRaster`, the develop shader).
 *
 * While masking, the photo shows whole and upright: the parts are placed on
 * the photo itself, not on its crop.
 */

import { Brush, ChevronDown, ChevronRight, Circle, Cloud, Eye, EyeOff, Layers, MoreHorizontal, Palette, Plus, Sparkles, SquareDashedMousePointer, Sun, Trash2, User, Image as ImageIcon, MoveDiagonal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button, cx } from '../components/ui';
import { EYEDROPPER, ScreenRing, usePointerAt } from './cursors';
import { PopMenu } from './preset-menu';
import { objectMask, skyMask, type Box } from './smart-masks';
import { t } from '../lib/i18n';
import { previewUrl } from '../kreasi/canvas';
import {
  MAX_MASKS,
  MAX_MASK_PARTS,
  MAX_RANGE_COLORS,
  maskParts,
  newId,
  type EditMask,
  type LocalAdjust,
  type MaskKind,
  type MaskPart,
} from '../kreasi/engine/document';
import { canvasToPng, personMatte, subjectMask } from '../kreasi/engine/cutout';
import { hasMaskImage, maskPreview, registerMaskImage } from '../kreasi/engine/develop';
import { getMaskImage, saveMaskImage } from '../kreasi/engine/lut-store';
import { loadLocalImage } from '../kreasi/kit';
import { Slider } from './panels';
import { FACE_PARTS, faceThumbs, landmarksOf, peopleCover, peopleMask, type FacePart } from './people-mask';
import type { EditSettings } from './geometry';

export interface BrushSettings {
  /** Share of the picture's width. */
  size: number;
  feather: number;
  erase: boolean;
}

const KINDS: { kind: MaskKind; label: string; icon: typeof User; ai?: boolean }[] = [
  { kind: 'subject', label: 'Subjek', icon: User, ai: true },
  { kind: 'background', label: 'Latar', icon: ImageIcon, ai: true },
  { kind: 'brush', label: 'Kuas', icon: Brush },
  { kind: 'linear', label: 'Linear', icon: MoveDiagonal },
  { kind: 'radial', label: 'Radial', icon: Circle },
  { kind: 'color', label: 'Warna', icon: Palette },
  { kind: 'luminance', label: 'Luminance', icon: Sun },
];
const kindLabel = (k: MaskKind) => t(KINDS.find((x) => x.kind === k)?.label ?? k);
/** A part's name: a people mask is drawn like a subject's, but says what it is. */
const partLabel = (p: MaskPart) =>
  p.kind === 'subject' && p.subject?.startsWith('people-')
    ? t('Orang')
    : p.kind === 'subject' && p.subject?.startsWith('sky-')
      ? t('Langit')
      : p.kind === 'subject' && p.subject?.startsWith('object-')
        ? t('Objek')
        : kindLabel(p.kind);

const LOCAL: { key: keyof LocalAdjust; label: string; min?: number }[] = [
  { key: 'exposure', label: 'Exposure' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'whites', label: 'Whites' },
  { key: 'blacks', label: 'Blacks' },
  { key: 'temp', label: 'Temp' },
  { key: 'tint', label: 'Tint' },
  { key: 'saturation', label: 'Saturation' },
  { key: 'texture', label: 'Texture' },
  { key: 'clarity', label: 'Clarity' },
  { key: 'dehaze', label: 'Dehaze' },
  { key: 'sharpness', label: 'Sharpness' },
  { key: 'noise', label: 'Noise', min: 0 },
];

/** A new part of a kind; the subject's mask is found by `ensureSubject` first. */
function newPart(kind: MaskKind, subject?: string): MaskPart {
  const id = newId();
  if (kind === 'subject' || kind === 'background') return { id, kind, subject };
  if (kind === 'brush') return { id, kind, strokes: [] };
  if (kind === 'linear' || kind === 'radial') return { id, kind, unplaced: true, feather: 50 };
  if (kind === 'color') return { id, kind, colors: [], range: 50 };
  return { id, kind, lumLo: 70, lumHi: 100, smooth: 30 };
}

/** The subject of photo `key` found (once, kept in this browser) and ready to draw; its id. */
async function ensureSubject(root: string, photoId: number): Promise<string | null> {
  // v2: the matte read finer, and people's bodies filled by the parts model.
  const id = `edit2-${root}#${photoId}`;
  if (hasMaskImage(id)) return id;
  const stored = await getMaskImage(id).catch(() => null);
  if (stored) {
    const bmp = await createImageBitmap(stored as Blob);
    registerMaskImage(id, bmp);
    return id;
  }
  const img = await loadLocalImage(await previewUrl(root, photoId));
  const points = await landmarksOf(root, photoId).catch(() => [] as [number, number][][]);
  let mask: HTMLCanvasElement | null;
  if (points.length) {
    // People: their matte at 1024 on the short side, with each found
    // person's body from the parts model laid over it (lighter wins).
    const matte = await personMatte(img, 1024);
    const cover = await peopleCover(img, points);
    mask = document.createElement('canvas');
    mask.width = 1024;
    mask.height = Math.max(8, Math.round((1024 * img.naturalHeight) / img.naturalWidth));
    const ctx = mask.getContext('2d')!;
    ctx.drawImage(matte, 0, 0, mask.width, mask.height);
    if (cover) {
      ctx.globalCompositeOperation = 'lighten';
      ctx.drawImage(cover, 0, 0, mask.width, mask.height);
    }
  } else {
    mask = await subjectMask(img, () => {});
  }
  if (!mask) return null;
  registerMaskImage(id, mask);
  canvasToPng(mask).then((png) => png && saveMaskImage(id, png)).catch(() => {});
  return id;
}

/** Subjects a photo's masks use, read back from this browser before drawing. */
export async function loadSubjects(a: EditSettings | undefined) {
  for (const m of a?.masks ?? []) {
    for (const p of maskParts(m)) {
      if (!p.subject || hasMaskImage(p.subject)) continue;
      const stored = await getMaskImage(p.subject).catch(() => null);
      if (stored) registerMaskImage(p.subject, await createImageBitmap(stored as Blob));
    }
  }
}

// ── The panel ──

export type MaskCreate = 'new' | 'add' | 'subtract';


/** A mask (or one of its parts) small, white where it applies on black, as Lightroom's thumbnails. */
function MaskThumb({ m, img }: { m: EditMask; img: HTMLImageElement | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const key = JSON.stringify(m.parts);
  useEffect(() => {
    if (!img) return;
    const t = window.setTimeout(() => {
      const raster = maskPreview({ ...m, hidden: false }, img.naturalHeight / img.naturalWidth, img, '#ffffff');
      if (!raster) return;
      const c = document.createElement('canvas');
      c.width = 48;
      c.height = Math.max(1, Math.round((48 * img.naturalHeight) / img.naturalWidth));
      const x = c.getContext('2d')!;
      x.fillStyle = '#000';
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(raster, 0, 0, c.width, c.height);
      setSrc(c.toDataURL());
    }, 120);
    return () => window.clearTimeout(t);
  }, [key, img]);
  return <span className="block h-6 w-9 shrink-0 rounded-[3px] bg-black bg-cover bg-center ring-1 ring-line" style={{ backgroundImage: src ? `url(${src})` : undefined }} />;
}

/**
 * What both sides of masking share: the photo (for thumbnails), the people
 * found, the person being masked and the parts ticked (shown in red on the
 * photo before the mask is made), and making masks — a new one, or a part
 * added to (taken from) the one chosen.
 */
export function useMasking({
  root,
  photoId,
  a,
  sel,
  creating,
  onSelect,
  onCreating,
  onLive,
  onDone,
}: {
  root: string;
  photoId: number;
  a: EditSettings;
  sel: string | null;
  creating: MaskCreate | null;
  onSelect: (mask: string | null, part: string | null) => void;
  onCreating: (c: MaskCreate | null) => void;
  onLive: (patch: Partial<EditSettings>) => void;
  onDone: () => void;
}) {
  const masks = a.masks ?? [];
  const mask = masks.find((m) => m.id === sel) ?? null;
  const parts = mask ? maskParts(mask) : [];
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [people, setPeople] = useState<{ points: [number, number][][]; thumbs: string[] } | null>(null);
  /** The person whose mask options show on the right. */
  const [person, setPerson] = useState<number | null>(null);
  const [chosen, setChosen] = useState<FacePart[]>(['orang']);
  /** The ticked parts' mask, drawn on the photo while choosing. */
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Objek: waiting for a box to be dragged on the photo. */
  const [boxing, setBoxing] = useState(false);
  useEffect(() => {
    let alive = true;
    setImg(null);
    setBoxing(false);
    setPeople(null);
    setPerson(null);
    if (photoId < 0) return;
    (async () => {
      const i = await loadLocalImage(await previewUrl(root, photoId)).catch(() => null);
      if (!alive) return;
      setImg(i);
      try {
        const points = await landmarksOf(root, photoId);
        if (alive) setPeople({ points, thumbs: i ? faceThumbs(i, points) : [] });
      } catch {
        if (alive) setPeople({ points: [], thumbs: [] });
      }
    })();
    return () => {
      alive = false;
    };
  }, [root, photoId]);
  useEffect(() => {
    setPreview(null);
    if (person == null || !people || !img || !chosen.length) return;
    let alive = true;
    peopleMask(root, photoId, img, people.points, [person], [...chosen].sort()).then(
      (id) => alive && setPreview(id),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [person, chosen.join(','), people, img]);

  const how: MaskCreate = creating && mask ? creating : 'new';
  const setMasks = (next: EditMask[]) => onLive({ masks: next.length ? next : undefined });
  const make = async (kind: MaskKind, subjects?: string[]) => {
    setError(null);
    let ids = subjects;
    if ((kind === 'subject' || kind === 'background') && !ids) {
      setBusy(kind);
      const found = await ensureSubject(root, photoId).catch(() => null);
      setBusy(null);
      if (!found) return setError(t('Subjek tidak ditemukan di foto ini.'));
      ids = [found];
    }
    const made = (ids ?? [undefined]).map((sub) => ({ ...newPart(kind, sub), subtract: how === 'subtract' || undefined }));
    if (how === 'new' || !mask) {
      const fresh: EditMask[] = made.map((p) => ({ id: newId(), parts: [p], adjust: { exposure: 0 } }));
      setMasks([...masks, ...fresh].slice(0, MAX_MASKS));
      const last = fresh[fresh.length - 1]!;
      onSelect(last.id, last.parts[0]!.id);
    } else {
      setMasks(masks.map((x) => (x.id === mask.id ? { ...mask, parts: [...parts, ...made].slice(0, MAX_MASK_PARTS) } : x)));
      onSelect(mask.id, made[made.length - 1]!.id);
    }
    onCreating(null);
    onDone();
  };
  const makePeople = async (separate: boolean) => {
    if (person == null || !people || !img || !chosen.length) return;
    setBusy('people');
    try {
      const groups = separate ? chosen.map((c) => [c]) : [[...chosen].sort()];
      const ids: string[] = [];
      for (const g of groups) ids.push(await peopleMask(root, photoId, img, people.points, [person], g));
      setPerson(null);
      await make('subject', ids);
    } catch {
      setError(t('Orang tidak bisa dipisahkan di foto ini.'));
    } finally {
      setBusy(null);
    }
  };
  const makeSky = async () => {
    if (!img) return;
    setError(null);
    setBusy('sky');
    const id = await skyMask(root, photoId, img).catch(() => null);
    setBusy(null);
    if (!id) return setError(t('Langit tidak ditemukan di foto ini.'));
    await make('subject', [id]);
  };
  const makeObject = async (box: Box) => {
    setBoxing(false);
    if (!img || box.w < 0.01 || box.h < 0.01) return;
    setError(null);
    setBusy('object');
    const id = await objectMask(root, photoId, img, box).catch(() => null);
    setBusy(null);
    if (!id) return setError(t('Tidak ada benda yang jelas di dalam kotak itu.'));
    await make('subject', [id]);
  };
  return {
    masks,
    mask,
    parts,
    img,
    people,
    person,
    setPerson,
    chosen,
    setChosen,
    preview: person != null ? preview : null,
    busy,
    error,
    how,
    make,
    makePeople,
    makeSky,
    boxing,
    setBoxing,
    makeObject,
    setMasks,
  };
}
export type Masking = ReturnType<typeof useMasking>;

/** A mask's name in the list. */
const maskName = (masks: EditMask[], m: EditMask) =>
  m.id === 'kulit-wajah'
    ? t('Kulit wajah')
    : m.id === 'retouch-mata'
      ? t('Cerahkan mata')
      : m.id === 'retouch-gigi'
        ? t('Putihkan gigi')
        : t('Mask {n}', { n: masks.indexOf(m) + 1 });

/**
 * Lightroom's Masks panel, floating over the photo once there is a mask:
 * Create New Mask, each mask with its thumbnail (the chosen one opened to
 * its parts, with Add and Subtract), a ⋯ menu and an eye, Show Overlay.
 */
export function MaskList({
  m,
  sel,
  part,
  overlay,
  onSelect,
  onCreating,
  onOverlay,
  onHover,
  onDone,
}: {
  m: Masking;
  sel: string | null;
  part: string | null;
  overlay: boolean;
  /** Pointed at in the list: that mask (or part) shown on the photo, as Lightroom does. */
  onHover: (m: EditMask | null) => void;
  onSelect: (mask: string | null, part: string | null) => void;
  onCreating: (c: MaskCreate | null) => void;
  onOverlay: (v: boolean) => void;
  onDone: () => void;
}) {
  const { masks, img } = m;
  const setMask = (x: EditMask) => m.setMasks(masks.map((y) => (y.id === x.id ? x : y)));
  const [open, setOpen] = useState(true);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; mask: EditMask } | null>(null);
  // Delete (or Backspace): the chosen part goes, or the mask when it is the last of it, as Lightroom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const el = e.target;
      if (el instanceof HTMLElement && (el.closest('input, textarea, select') || el.isContentEditable)) return;
      const x = masks.find((y) => y.id === sel);
      if (!x) return;
      e.preventDefault();
      const ps = maskParts(x);
      const p = ps.find((y) => y.id === part);
      if (p && ps.length > 1) {
        const rest = ps.filter((y) => y.id !== p.id);
        m.setMasks(masks.map((y) => (y.id === x.id ? { ...x, parts: rest } : y)));
        onSelect(x.id, rest[rest.length - 1]!.id);
      } else {
        m.setMasks(masks.filter((y) => y.id !== x.id));
        onSelect(null, null);
      }
      onHover(null);
      onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!masks.length) return null;
  return (
    <div className="absolute top-3 right-3 z-10 flex w-60 flex-col rounded-lg border border-line bg-panel/95 shadow-2xl backdrop-blur">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center justify-between px-3 py-1.5 text-xs font-semibold">
        {t('Masks')}
        {open ? <ChevronDown size={13} className="text-faint" /> : <ChevronRight size={13} className="text-faint" />}
      </button>
      {open && (
        <>
          <button
            type="button"
            onClick={() => (onSelect(null, null), onCreating('new'))}
            disabled={masks.length >= MAX_MASKS}
            className="mx-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1.5 text-[13px] hover:bg-raised disabled:opacity-40"
          >
            <span className="flex size-7 items-center justify-center rounded-full bg-gold text-white">
              <Plus size={15} />
            </span>
            {t('Buat mask baru')}
          </button>
          <div className="flex max-h-[55vh] flex-col overflow-y-auto px-1.5 pb-1">
            {masks.map((x) => {
              const ps = maskParts(x);
              const on = sel === x.id;
              return (
                <div key={x.id} className="flex flex-col">
                  <div
                    onPointerEnter={() => onHover(x)}
                    onPointerLeave={() => onHover(null)}
                    className={cx('group flex items-center gap-1.5 rounded-md py-1 pr-1.5', on ? 'bg-raised' : 'hover:bg-panel-2')}
                  >
                    <span className="flex w-4 justify-center text-faint">{on && <ChevronDown size={12} />}</span>
                    <button type="button" onClick={() => (onSelect(x.id, ps[ps.length - 1]?.id ?? null), onCreating(null))} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <span className={cx('rounded-[4px]', on && 'ring-2 ring-gold')}>
                        <MaskThumb m={x} img={img} />
                      </span>
                      <span className={cx('truncate text-xs', on ? 'text-fg' : 'text-muted', x.hidden && 'line-through')}>{maskName(masks, x)}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => setMenu({ at: { x: e.clientX, y: e.clientY }, mask: x })}
                      aria-label={t('Menu')}
                      className="text-faint opacity-0 group-hover:opacity-100 hover:text-fg"
                    >
                      <MoreHorizontal size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => (setMask({ ...x, hidden: !x.hidden }), onDone())}
                      title={x.hidden ? t('Nyalakan lagi') : t('Matikan sementara untuk membandingkan')}
                      className={cx('hover:text-fg', x.hidden ? 'text-faint' : 'text-muted')}
                    >
                      {x.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>
                  {on && (
                    <div className="flex flex-col gap-0.5 py-1 pl-6">
                      {ps.map((p) => (
                        <div
                          key={p.id}
                          onPointerEnter={() => onHover({ ...x, parts: [{ ...p, subtract: undefined }] })}
                          onPointerLeave={() => onHover(null)}
                          className={cx('group flex items-center gap-2 rounded-md px-1.5 py-1', part === p.id ? 'bg-gold/15' : 'hover:bg-panel-2')}
                        >
                          <button type="button" onClick={() => (onSelect(x.id, p.id), onCreating(null))} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                            <span className="relative block">
                              <MaskThumb m={{ ...x, parts: [{ ...p, subtract: undefined }] }} img={img} />
                              {p.subtract && (
                                <span className="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-reject text-[10px] leading-none font-bold text-white">−</span>
                              )}
                            </span>
                            <span className={cx('truncate text-[11px]', part === p.id ? 'text-fg' : 'text-muted')}>
                              {partLabel(p)}
                              {p.invert ? ` · ${t('dibalik')}` : ''}
                            </span>
                          </button>
                          {ps.length > 1 && (
                            <button
                              type="button"
                              onClick={() => (setMask({ ...x, parts: ps.filter((y) => y.id !== p.id) }), onHover(null), onDone())}
                              aria-label={t('Hapus bagian')}
                              className="text-faint opacity-0 group-hover:opacity-100 hover:text-reject"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                      <div className="grid grid-cols-2 gap-1.5 pt-1 pr-1.5">
                        <button
                          type="button"
                          onClick={() => onCreating('add')}
                          disabled={ps.length >= MAX_MASK_PARTS}
                          className="flex h-6 items-center justify-center gap-1 rounded-md bg-panel-2 text-[11px] text-muted hover:text-fg disabled:opacity-40"
                        >
                          {t('Tambah##mask')}
                        </button>
                        <button
                          type="button"
                          onClick={() => onCreating('subtract')}
                          disabled={ps.length >= MAX_MASK_PARTS}
                          className="flex h-6 items-center justify-center gap-1 rounded-md bg-panel-2 text-[11px] text-muted hover:text-fg disabled:opacity-40"
                        >
                          {t('Kurangi##mask')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <label className="flex cursor-pointer items-center gap-2 border-t border-line-soft px-3 py-2 text-[11px] text-muted">
            <span className={cx('relative h-3.5 w-6 rounded-full transition-colors', overlay ? 'bg-gold' : 'bg-line')}>
              <span className={cx('absolute top-0.5 size-2.5 rounded-full bg-white transition-all', overlay ? 'left-3' : 'left-0.5')} />
            </span>
            <input type="checkbox" checked={overlay} onChange={(e) => onOverlay(e.target.checked)} className="sr-only" />
            {t('Tampilkan overlay')}
            <span className="ml-auto text-faint">O</span>
          </label>
        </>
      )}
      {menu && (
        <PopMenu
          at={menu.at}
          onClose={() => setMenu(null)}
          items={[
            {
              label: t('Duplikat mask'),
              disabled: masks.length >= MAX_MASKS,
              onClick: () => {
                const copy: EditMask = { ...menu.mask, id: newId(), parts: maskParts(menu.mask).map((p) => ({ ...p, id: newId() })) };
                m.setMasks([...masks, copy]);
                onSelect(copy.id, copy.parts[copy.parts.length - 1]!.id);
                onDone();
              },
            },
            {
              label: t('Balik mask'),
              onClick: () => (setMask({ ...menu.mask, parts: maskParts(menu.mask).map((p) => ({ ...p, invert: !p.invert || undefined })) }), onDone()),
            },
            {
              label: t('Hapus mask'),
              danger: true,
              onClick: () => (m.setMasks(masks.filter((y) => y.id !== menu.mask.id)), onSelect(null, null), onHover(null), onDone()),
            },
          ]}
        />
      )}
    </div>
  );
}

/** Lightroom's grouping of a mask's sliders: folded sections. */
const LOCAL_SECTIONS: { title: string; keys: (keyof LocalAdjust)[] }[] = [
  { title: 'Cahaya', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
  { title: 'Warna', keys: ['temp', 'tint', 'saturation'] },
  { title: 'Efek', keys: ['texture', 'clarity', 'dehaze'] },
  { title: 'Detail', keys: ['sharpness', 'noise'] },
];

/**
 * The right-hand side while masking, as Lightroom Classic's: Create New
 * Mask (Subject and Background as tiles, the tools as rows, People to
 * open), a person's mask options (Cancel / Create Mask), or the chosen
 * mask — its part and Invert, then Light, Color, Effects and Detail.
 */
export function MaskPanel({
  m,
  part,
  creating,
  brush,
  onCreating,
  onBrush,
  onDone,
  onClose,
}: {
  m: Masking;
  part: string | null;
  creating: MaskCreate | null;
  brush: BrushSettings;
  onCreating: (c: MaskCreate | null) => void;
  onBrush: (b: BrushSettings) => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const { masks, mask, parts, people, person, setPerson, chosen, setChosen, busy, how, make } = m;
  const cur = parts.find((p) => p.id === part) ?? parts[parts.length - 1] ?? null;
  const setMask = (x: EditMask) => m.setMasks(masks.map((y) => (y.id === x.id ? x : y)));
  const setPart = (p: MaskPart) => mask && setMask({ ...mask, parts: parts.map((x) => (x.id === p.id ? p : x)) });
  const [separate, setSeparate] = useState(false);
  const [showPeople, setShowPeople] = useState(true);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const full = how === 'new' && masks.length >= MAX_MASKS;
  const foot = (buttons: React.ReactNode) => <div className="mt-auto flex justify-end gap-2 border-t border-line-soft pt-3">{buttons}</div>;

  // A person's options: the parts to take, shown in red on the photo as they're ticked.
  if (person != null && people)
    return (
      <div className="flex min-h-full flex-col gap-3">
        <h2 className="text-[15px] font-semibold">{t('Opsi mask orang')}</h2>
        <div className="flex flex-wrap gap-3">
          {people.thumbs.map((src, i) => (
            <button key={i} type="button" onClick={() => setPerson(i)} className="flex flex-col items-center gap-1">
              <img src={src} alt="" className={cx('size-12 rounded-full object-cover', person === i ? 'ring-2 ring-gold' : 'opacity-60 ring-1 ring-line hover:opacity-100')} />
              <span className={cx('text-[11px]', person === i ? 'text-fg' : 'text-faint')}>{t('Orang {n}', { n: i + 1 })}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-col">
          {FACE_PARTS.map((fp, i) => (
            <label key={fp.id} className={cx('flex items-center gap-2.5 px-1 py-1.5 text-[13px]', i === 1 && 'mt-1 border-t border-line-soft pt-2.5')}>
              <input
                type="checkbox"
                checked={chosen.includes(fp.id)}
                onChange={(e) => setChosen((c) => (e.target.checked ? [...c, fp.id] : c.filter((x) => x !== fp.id)))}
                className="size-3.5 accent-[var(--color-gold)]"
              />
              {t(fp.label)}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2.5 border-t border-line-soft px-1 pt-2.5 text-xs text-muted">
          <input type="checkbox" checked={separate} onChange={(e) => setSeparate(e.target.checked)} className="size-3.5 accent-[var(--color-gold)]" />
          {t('Buat mask terpisah')}
        </label>
        {m.error && <p className="text-[11px] text-reject">{m.error}</p>}
        {foot(
          <>
            <Button variant="plain" onClick={() => setPerson(null)}>
              {t('Batal')}
            </Button>
            <Button variant="primary" onClick={() => m.makePeople(separate)} disabled={!chosen.length || !!busy}>
              {busy === 'people' ? t('Memisahkan…') : t('Buat mask')}
            </Button>
          </>,
        )}
      </div>
    );

  if (creating != null || !mask) {
    const row = 'flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-[13px] text-muted hover:bg-raised hover:text-fg disabled:opacity-40';
    const tile = (on: () => void, key: string, Icon: typeof User, label: string) => (
      <button type="button" disabled={!!busy || full} onClick={on} className="flex flex-col items-center gap-1.5 text-[11px] text-muted hover:text-fg disabled:opacity-40">
        <span className={cx('flex size-16 items-center justify-center rounded-md border border-line bg-panel-2', busy === key && 'animate-pulse border-gold')}>
          <Icon size={22} />
        </span>
        {label}
      </button>
    );
    const tool = (on: () => void, Icon: typeof User, label: string, keys?: string, off?: string) => (
      <button type="button" disabled={!!busy || full || !!off} title={off} onClick={on} className={row}>
        <Icon size={15} /> {label}
        {keys && <span className="ml-auto text-[11px] text-faint">{keys}</span>}
      </button>
    );
    return (
      <div className="flex min-h-full flex-col gap-2">
        <h2 className="text-[15px] font-semibold">
          {how === 'add' ? t('Tambah ke mask') : how === 'subtract' ? t('Kurangi dari mask') : t('Buat mask baru')}
        </h2>
        <div className="flex justify-between gap-2 py-2">
          {tile(() => make('subject'), 'subject', User, t('Subjek'))}
          {tile(m.makeSky, 'sky', Cloud, t('Langit'))}
          {tile(() => make('background'), 'background', ImageIcon, t('Latar'))}
        </div>
        <div className="flex flex-col border-t border-line-soft pt-2">
          <button type="button" disabled={!!busy || full} onClick={() => m.setBoxing(!m.boxing)} className={cx(row, m.boxing && 'bg-gold/15 text-fg')}>
            <SquareDashedMousePointer size={15} /> {t('Objek')}
          </button>
          {m.boxing && <p className="px-2 pb-1 text-[11px] text-gold-text">{t('Tarik kotak di sekeliling benda di foto.')}</p>}
          {tool(() => make('brush'), Brush, t('Kuas'), 'K')}
          {tool(() => make('linear'), MoveDiagonal, t('Gradasi linear'))}
          {tool(() => make('radial'), Circle, t('Gradasi radial'), '⇧M')}
        </div>
        <div className="flex flex-col border-t border-line-soft pt-2">
          {tool(() => make('color'), Palette, t('Rentang warna'), '⇧J')}
          {tool(() => make('luminance'), Sun, t('Rentang luminance'), '⇧Q')}
          {tool(() => {}, Layers, t('Rentang kedalaman'), '⇧Z', t('Hanya untuk foto yang menyimpan data kedalaman (mode Potret iPhone).'))}
        </div>
        <div className="flex flex-col border-t border-line-soft pt-2">
          <button type="button" onClick={() => setShowPeople((v) => !v)} className={row}>
            {showPeople ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {t('Orang##masking')}
            {people && <span className="text-faint">{people.points.length}</span>}
          </button>
          {showPeople && (
            <div className="flex flex-wrap gap-3 px-2 pt-1 pb-2">
              {!people && <span className="animate-pulse text-[11px] text-faint">{t('Mencari orang…')}</span>}
              {people && !people.points.length && <span className="text-[11px] text-faint">{t('Tidak ada orang yang ditemukan di foto ini.')}</span>}
              {people?.thumbs.map((src, i) => (
                <button key={i} type="button" disabled={full} onClick={() => setPerson(i)} className="flex flex-col items-center gap-1 disabled:opacity-40">
                  <img src={src} alt="" className="size-12 rounded-full object-cover ring-1 ring-line hover:ring-gold" />
                  <span className="text-[11px] text-faint">{t('Orang {n}', { n: i + 1 })}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {busy && busy !== 'people' && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted">
            <Sparkles size={12} className="animate-pulse text-gold-text" />{' '}
            {busy === 'sky' ? t('Mencari langit…') : busy === 'object' ? t('Memisahkan benda…') : t('Mencari subjek…')}
          </p>
        )}
        {m.error && <p className="text-[11px] text-reject">{m.error}</p>}
        {foot(
          mask ? (
            <Button variant="plain" onClick={() => onCreating(null)}>
              {t('Batal')}
            </Button>
          ) : (
            <Button variant="primary" onClick={onClose}>
              {t('Tutup')}
            </Button>
          ),
        )}
      </div>
    );
  }

  const local = mask.adjust ?? {};
  return (
    <div className="flex min-h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{cur ? partLabel(cur) : maskName(masks, mask)}</h2>
        {cur && (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={!!cur.invert} onChange={(e) => (setPart({ ...cur, invert: e.target.checked || undefined }), onDone())} className="size-3.5 accent-[var(--color-gold)]" />
            {t('Balik##mask')}
          </label>
        )}
      </div>
      <span className="text-[13px] font-medium text-muted">{maskName(masks, mask)}</span>
      {cur && <PartControls part={cur} brush={brush} onBrush={onBrush} onPart={setPart} onDone={onDone} />}
      {LOCAL_SECTIONS.map((sec) => {
        const shut = folded[sec.title];
        return (
          <div key={sec.title} className="flex flex-col gap-3 border-t border-line-soft pt-2.5">
            <button type="button" onClick={() => setFolded((f) => ({ ...f, [sec.title]: !shut }))} className="flex items-center gap-1.5 text-[13px] font-semibold">
              {shut ? <ChevronRight size={14} /> : <ChevronDown size={14} />} {t(sec.title)}
            </button>
            {!shut &&
              sec.keys.map((k) => {
                const l = LOCAL.find((x) => x.key === k)!;
                return (
                  <Slider
                    key={k}
                    label={t(l.label)}
                    value={local[k] ?? 0}
                    min={l.min ?? -100}
                    track={k === 'temp' ? 'linear-gradient(90deg,#4a7bd1,#d8d0b8,#e2b23c)' : k === 'tint' ? 'linear-gradient(90deg,#4caf50,#d8d0b8,#c04fc4)' : undefined}
                    onLive={(v) => setMask({ ...mask, adjust: { ...mask.adjust, [k]: v } })}
                    onDone={onDone}
                  />
                );
              })}
          </div>
        );
      })}
      {foot(
        <>
          <Button variant="plain" onClick={() => (setMask({ ...mask, adjust: { exposure: 0 } }), onDone())}>
            {t('Reset')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('Tutup')}
          </Button>
        </>,
      )}
    </div>
  );
}

function PartControls({ part, brush, onBrush, onPart, onDone }: { part: MaskPart; brush: BrushSettings; onBrush: (b: BrushSettings) => void; onPart: (p: MaskPart) => void; onDone: () => void }) {
  if (part.kind === 'brush')
    return (
      <div className="flex flex-col gap-3 rounded-lg bg-panel-2 p-3">
        <div className="grid grid-cols-2 gap-1.5">
          <Button onClick={() => onBrush({ ...brush, erase: false })} className={cx(!brush.erase && 'ring-1 ring-gold')}>
            {t('Lukis')}
          </Button>
          <Button onClick={() => onBrush({ ...brush, erase: true })} className={cx(brush.erase && 'ring-1 ring-gold')}>
            {t('Hapus##kuas')}
          </Button>
        </div>
        <Slider label={t('Ukuran kuas')} value={Math.round(brush.size * 100)} min={1} max={40} center={8} onLive={(v) => onBrush({ ...brush, size: v / 100 })} onDone={() => {}} />
        <Slider label={t('Feather')} value={brush.feather} min={0} center={50} onLive={(v) => onBrush({ ...brush, feather: v })} onDone={() => {}} />
        <p className="text-[11px] text-faint">{t('Sapukan di foto. [ dan ] mengubah ukuran kuas.')}</p>
      </div>
    );
  if (part.kind === 'linear' || part.kind === 'radial')
    return (
      <div className="flex flex-col gap-3 rounded-lg bg-panel-2 p-3">
        <p className="text-[11px] text-faint">
          {part.unplaced
            ? part.kind === 'linear'
              ? t('Tarik di foto dari bagian yang paling kena ke bagian yang tidak kena.')
              : t('Tarik di foto dari tengah ke tepi lingkaran.')
            : t('Geser titik-titiknya di foto untuk mengubah.')}
        </p>
        <Slider label={t('Feather')} value={part.feather ?? 50} min={0} center={50} onLive={(v) => onPart({ ...part, feather: v })} onDone={onDone} />
      </div>
    );
  if (part.kind === 'color')
    return (
      <div className="flex flex-col gap-3 rounded-lg bg-panel-2 p-3">
        <div className="flex items-center gap-1.5">
          {(part.colors ?? []).map((c, i) => (
            <button
              key={i}
              type="button"
              title={t('Klik untuk melepas warna ini')}
              onClick={() => (onPart({ ...part, colors: part.colors!.filter((_, j) => j !== i) }), onDone())}
              className="size-6 rounded-md ring-1 ring-line"
              style={{ background: `rgb(${c.join(',')})` }}
            />
          ))}
          <span className="text-[11px] text-faint">
            {(part.colors?.length ?? 0) < MAX_RANGE_COLORS ? t('Klik foto untuk mengambil warna (sampai {n}).', { n: MAX_RANGE_COLORS }) : ''}
          </span>
        </div>
        <Slider label={t('Jangkauan')} value={part.range ?? 50} min={0} center={50} onLive={(v) => onPart({ ...part, range: v })} onDone={onDone} />
      </div>
    );
  if (part.kind === 'luminance')
    return (
      <div className="flex flex-col gap-3 rounded-lg bg-panel-2 p-3">
        <Slider label={t('Dari')} value={part.lumLo ?? 0} min={0} center={0} onLive={(v) => onPart({ ...part, lumLo: Math.min(v, part.lumHi ?? 100) })} onDone={onDone} />
        <Slider label={t('Sampai')} value={part.lumHi ?? 100} min={0} center={100} onLive={(v) => onPart({ ...part, lumHi: Math.max(v, part.lumLo ?? 0) })} onDone={onDone} />
        <Slider label={t('Kehalusan')} value={part.smooth ?? 30} min={0} center={30} onLive={(v) => onPart({ ...part, smooth: v })} onDone={onDone} />
      </div>
    );
  return null;
}

// ── On the photo ──

/**
 * Over the photo while masking: the chosen mask tinted red (overlay), and
 * what the chosen part takes from the pointer — a brush's sweeps, a
 * gradient's drag and handles, a color picked.
 */
export function MaskLayer({
  root,
  photoId,
  a,
  sel,
  part,
  overlay,
  preview,
  hover,
  boxing,
  onBox,
  brush,
  onBrush,
  onLive,
  onDone,
}: {
  root: string;
  photoId: number;
  a: EditSettings;
  sel: string | null;
  part: string | null;
  overlay: boolean;
  /** A people mask being chosen (its id): shown in red instead of the chosen mask. */
  preview?: string | null;
  /** A mask pointed at in the Masks list: shown in red, whatever the overlay setting (not when turned off). */
  hover?: EditMask | null;
  /** Objek: a box is being dragged round a thing; `onBox` gets it (shares of the photo). */
  boxing?: boolean;
  onBox?: (b: Box) => void;
  brush: BrushSettings;
  onBrush: (b: BrushSettings) => void;
  onLive: (patch: Partial<EditSettings>) => void;
  onDone: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const tint = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const pointer = usePointerAt(box);
  const masks = a.masks ?? [];
  const mask = masks.find((m) => m.id === sel) ?? null;
  const parts = mask ? maskParts(mask) : [];
  const cur = parts.find((p) => p.id === part) ?? parts[parts.length - 1] ?? null;

  useEffect(() => {
    let alive = true;
    previewUrl(root, photoId).then(loadLocalImage).then((i) => alive && setImg(i), () => {});
    return () => {
      alive = false;
    };
  }, [root, photoId]);

  // Drawn whether or not it shows; showing and hiding fade (as Lightroom's).
  const tintOn = !!preview || !!hover || overlay;
  const tintClass = 'pointer-events-none absolute inset-0 size-full transition-opacity duration-300 ease-out';

  // The chosen mask in red over the photo.
  useEffect(() => {
    const c = tint.current;
    if (!c) return;
    const r = c.parentElement!.getBoundingClientRect();
    c.width = Math.round(r.width);
    c.height = Math.round(r.height);
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!img) return;
    const shown: EditMask | null = preview
      ? { id: 'preview', parts: [{ id: 'preview', kind: 'subject', subject: preview }], adjust: { exposure: 0 } }
      : (hover ?? mask);
    // A mask turned off with its eye shows nothing, its overlay included.
    if (!shown || shown.hidden) return;
    const p = maskPreview(shown, img.naturalHeight / img.naturalWidth, img);
    if (!p) return;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(p, 0, 0, c.width, c.height);
  }, [overlay, mask, img, preview, hover]);

  // [ and ] size the brush.
  useEffect(() => {
    if (cur?.kind !== 'brush') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '[' || e.key === ']') onBrush({ ...brush, size: Math.min(0.4, Math.max(0.01, brush.size * (e.key === ']' ? 1.2 : 1 / 1.2))) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (boxing && onBox)
    return (
      <>
        <canvas ref={tint} className={tintClass} style={{ opacity: tintOn ? 1 : 0 }} />
        <BoxDraw onBox={onBox} />
      </>
    );
  if (!mask || !cur || preview) return <canvas ref={tint} className={tintClass} style={{ opacity: tintOn ? 1 : 0 }} />;

  const setPart = (p: MaskPart) => onLive({ masks: masks.map((m) => (m.id === mask.id ? { ...mask, parts: parts.map((x) => (x.id === p.id ? p : x)) } : m)) });
  // Gradients reach past the photo's edge (as Lightroom's, dragged from outside it).
  const reach = cur.kind === 'linear' || cur.kind === 'radial';
  const at = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    const [lo, hi] = reach ? [-0.5, 1.5] : [0, 1];
    return [Math.min(hi, Math.max(lo, (e.clientX - r.left) / r.width)), Math.min(hi, Math.max(lo, (e.clientY - r.top) / r.height))] as [number, number];
  };
  /** Follows the pointer from a press until it is let go. */
  const track = (e: React.PointerEvent, onMove: (p: [number, number]) => void) => {
    e.preventDefault();
    e.stopPropagation();
    const move = (ev: PointerEvent) => onMove(at(ev));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onDone();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const aspect = img ? img.naturalWidth / img.naturalHeight : 1.5;

  const down = (e: React.PointerEvent) => {
    const p0 = at(e);
    if (cur.kind === 'brush') {
      let stroke = { size: brush.size, feather: brush.feather, erase: brush.erase || undefined, points: [p0] };
      let strokes = [...(cur.strokes ?? []), stroke];
      setPart({ ...cur, strokes });
      track(e, (p) => {
        stroke = { ...stroke, points: [...stroke.points, p] };
        strokes = [...strokes.slice(0, -1), stroke];
        setPart({ ...cur, strokes });
      });
    } else if (cur.kind === 'linear' && cur.unplaced) {
      track(e, (p) => setPart({ ...cur, unplaced: undefined, x0: p0[0], y0: p0[1], x1: p[0], y1: p[1] }));
    } else if (cur.kind === 'radial' && cur.unplaced) {
      track(e, (p) => {
        const rx = Math.max(0.02, Math.abs(p[0] - p0[0]));
        const ry = Math.max(0.02, Math.abs(p[1] - p0[1]));
        // A circle unless dragged long one way: as round on the photo as the drag.
        setPart({ ...cur, unplaced: undefined, cx: p0[0], cy: p0[1], rx, ry: e.shiftKey ? rx * aspect : ry });
      });
    } else if (cur.kind === 'color') {
      if (!img || (cur.colors?.length ?? 0) >= MAX_RANGE_COLORS) return;
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, p0[0] * img.naturalWidth - 2, p0[1] * img.naturalHeight - 2, 5, 5, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      setPart({ ...cur, colors: [...(cur.colors ?? []), [r!, g!, b!]] });
      onDone();
    }
  };

  const pct = (v: number) => `${v * 100}%`;
  const handle = (x: number, y: number, onMove: (p: [number, number]) => void, title: string) => (
    <span
      title={title}
      onPointerDown={(e) => track(e, onMove)}
      className="absolute size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white bg-gold shadow"
      style={{ left: pct(x), top: pct(y) }}
    />
  );
  const placed = !cur.unplaced;
  return (
    // For gradients the press is caught round the photo too.
    <div
      className={cx('absolute', reach ? '-inset-12' : 'inset-0', cur.kind === 'brush' ? 'cursor-none' : cur.unplaced ? 'cursor-crosshair' : '')}
      style={cur.kind === 'color' ? { cursor: EYEDROPPER } : undefined}
      onPointerDown={down}
      onPointerMove={(e) => cur.kind === 'brush' && pointer.move(e)}
      onPointerLeave={pointer.leave}
    >
    <div ref={box} className={cx('absolute', reach ? 'inset-12' : 'inset-0')}>
      <canvas ref={tint} className={tintClass} style={{ opacity: tintOn ? 1 : 0 }} />
      {cur.kind === 'brush' && <ScreenRing at={pointer.screen} share={brush.size} feather={brush.feather} erase={brush.erase} />}
      {cur.kind === 'linear' && placed && (
        <>
          <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">
            <line x1={pct(cur.x0 ?? 0)} y1={pct(cur.y0 ?? 0)} x2={pct(cur.x1 ?? 0)} y2={pct(cur.y1 ?? 0)} stroke="white" strokeWidth={1.5} strokeDasharray="5 4" />
          </svg>
          {handle(cur.x0 ?? 0, cur.y0 ?? 0, (p) => setPart({ ...cur, x0: p[0], y0: p[1] }), t('Paling kena'))}
          {handle(cur.x1 ?? 0, cur.y1 ?? 0, (p) => setPart({ ...cur, x1: p[0], y1: p[1] }), t('Tidak kena'))}
        </>
      )}
      {cur.kind === 'radial' && placed && (
        <>
          <span
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-2 border-dashed border-white"
            style={{ left: pct(cur.cx ?? 0.5), top: pct(cur.cy ?? 0.5), width: pct((cur.rx ?? 0.25) * 2), height: pct((cur.ry ?? 0.25) * 2) }}
          />
          {handle(cur.cx ?? 0.5, cur.cy ?? 0.5, (p) => setPart({ ...cur, cx: p[0], cy: p[1] }), t('Geser'))}
          {handle((cur.cx ?? 0.5) + (cur.rx ?? 0.25), cur.cy ?? 0.5, (p) => setPart({ ...cur, rx: Math.max(0.02, Math.abs(p[0] - (cur.cx ?? 0.5))) }), t('Lebar'))}
          {handle(cur.cx ?? 0.5, (cur.cy ?? 0.5) - (cur.ry ?? 0.25), (p) => setPart({ ...cur, ry: Math.max(0.02, Math.abs(p[1] - (cur.cy ?? 0.5))) }), t('Tinggi##ukuran'))}
        </>
      )}
    </div>
    </div>
  );
}

/** Objek: a box dragged on the photo (crosshair), dashed while drawn. */
function BoxDraw({ onBox }: { onBox: (b: Box) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = ref.current!.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) => [
      Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)),
    ];
    const [x0, y0] = at(e) as [number, number];
    let b: Box = { x: x0, y: y0, w: 0, h: 0 };
    const move = (ev: PointerEvent) => {
      const [x1, y1] = at(ev) as [number, number];
      b = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      setBox(b);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBox(null);
      onBox(b);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const pct = (v: number) => `${v * 100}%`;
  return (
    <div ref={ref} onPointerDown={down} className="absolute inset-0 cursor-crosshair">
      {box && (
        <span
          className="pointer-events-none absolute border-2 border-dashed border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
          style={{ left: pct(box.x), top: pct(box.y), width: pct(box.w), height: pct(box.h) }}
        />
      )}
    </div>
  );
}
