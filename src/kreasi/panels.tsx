/**
 * The editor's left panels: Lapisan, Teks, Elemen, Latar. Previews of
 * presets and elements are drawn by the engine itself, so what is shown is
 * exactly what lands on the canvas.
 */

import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, Image as ImageIcon, Lock, Search, Shapes, Type, Unlock } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { addGradient, addPreset, addShape, addSticker, addText, order, toggleMeta, type Edit } from './actions';
import {
  FREE_LAYOUT_ID,
  initialDoc,
  isFreeLayout,
  isLayerHidden,
  isLayerLocked,
  layerKeys,
  photoLayerKey,
  slotsFor,
  templateOf,
  type CollageDoc,
} from './engine/document';
import { GRADIENT_PRESETS } from './engine/gradients';
import { extractPalette, type Selection } from './engine/render';
import { SHAPES, shapeById } from './engine/shapes';
import { STICKER_CATEGORIES, STICKERS, stickerById } from './engine/stickers';
import { PRESET_CATEGORIES, TEXT_PRESETS } from './engine/text-presets';
import { GENERATED_PRESETS } from './engine/text-presets-generated';
import { isPicturePlace } from './kit';
import { itemPreviewOf, previewOf } from './preview';

const ALL_PRESETS = [...TEXT_PRESETS, ...GENERATED_PRESETS];

/** A square stage for previews of one thing on the editor's own dark ground. */
function stage(fill: (d: CollageDoc) => CollageDoc, background = '#1a2923'): CollageDoc {
  const base = initialDoc();
  return fill({ ...base, format: 'square', templateId: FREE_LAYOUT_ID, slots: [], freeCells: [], style: { ...base.style, background } });
}

/** An engine-drawn picture, made once it scrolls into view. */
function Lazy({ id, make, width, className, fit }: { id: string; make: () => CollageDoc; width: number; className?: string; fit?: boolean }) {
  const ref = useRef<HTMLImageElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      (fit ? itemPreviewOf(id, make(), width) : previewOf(id, make(), width)).then((s) => alive && setSrc(s), () => {});
    }, { rootMargin: '300px' });
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [id, width]);
  return <img ref={ref} src={src ?? undefined} alt="" draggable={false} className={cx('aspect-square w-full rounded-md bg-raised object-cover', className)} />;
}

const Title = ({ children }: { children: React.ReactNode }) => (
  <span className="pt-2 pb-1 text-[11px] font-semibold text-faint uppercase">{children}</span>
);

// ── Lapisan ────────────────────────────────────────────────────

export function LayersPanel({
  doc,
  selection,
  images,
  onSelect,
  onHover,
  edit,
}: {
  doc: CollageDoc;
  selection: Selection;
  images: Map<string, HTMLImageElement>;
  onSelect: (s: Selection) => void;
  /** The row under the pointer, to outline its layer on the canvas. */
  onHover: (s: Selection) => void;
  edit: (fn: Edit) => void;
}) {
  // Top of the stack first, as in every design app; photo places at the bottom.
  const keys = layerKeys(doc).reverse();
  const slots = slotsFor(doc, templateOf(doc).cells.length);
  /** Order, lock and visibility of a movable layer; shown on hover, or while it matters. */
  const rowActions = (key: string, on: boolean) => {
    const hidden = isLayerHidden(doc, key);
    const locked = isLayerLocked(doc, key);
    return (
      <span className={cx('shrink-0 items-center gap-0.5', on || hidden || locked ? 'flex' : 'hidden group-hover:flex')}>
        <IconBtn label={t('Naikkan')} onClick={() => edit(order(key, 'forward'))}>
          <ArrowUp size={12} />
        </IconBtn>
        <IconBtn label={t('Turunkan')} onClick={() => edit(order(key, 'backward'))}>
          <ArrowDown size={12} />
        </IconBtn>
        <IconBtn label={locked ? t('Buka kunci') : t('Kunci')} onClick={() => edit(toggleMeta(key, 'locked'))} on={locked}>
          {locked ? <Lock size={12} /> : <Unlock size={12} />}
        </IconBtn>
        <IconBtn label={hidden ? t('Tampilkan') : t('Sembunyikan')} onClick={() => edit(toggleMeta(key, 'hidden'))} on={hidden}>
          {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
        </IconBtn>
      </span>
    );
  };
  const photoRow = (i: number, key: string) => {
    const on = selection?.kind === 'cell' && selection.index === i;
    const s = slots[i];
    const img = s && images.get(s.file.fileId);
    // A free layout's frame is a layer like the others: it can be ordered, locked and hidden.
    const movable = key.startsWith('photo:');
    const hidden = movable && isLayerHidden(doc, key);
    return (
      <div
        key={key}
        onPointerEnter={() => onHover({ kind: 'cell', index: i })}
        onPointerLeave={() => onHover(null)}
        className={cx('group flex h-9 shrink-0 items-center gap-2 rounded-lg px-2', on ? 'bg-raised ring-1 ring-gold' : 'hover:bg-panel-2', hidden && 'opacity-50')}
      >
        <button type="button" onClick={() => onSelect({ kind: 'cell', index: i })} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className="flex w-6 shrink-0 justify-center">
            {img ? <img src={img.src} alt="" className="h-5 w-6 rounded-sm object-cover" /> : <ImageIcon size={14} className="text-faint" />}
          </span>
          <span className={cx('truncate text-xs', on ? 'font-semibold text-fg' : 'text-muted')}>{t('Foto {n}', { n: i + 1 })}</span>
        </button>
        {movable && rowActions(key, on)}
      </div>
    );
  };
  return (
    <div className="flex flex-col gap-0.5">
      <Title>{t('Lapisan')}</Title>
      {keys.map((key) => {
        // A free layout's photo places are layers among the others.
        if (key.startsWith('photo:')) {
          const i = doc.freeCells.findIndex((c) => photoLayerKey(c.id) === key);
          return i < 0 ? null : photoRow(i, key);
        }
        const isText = key.startsWith('text:');
        const id = key.slice(isText ? 5 : 8);
        const sel: Selection = isText ? { kind: 'text', id } : { kind: 'sticker', id };
        const on = !!selection && 'id' in selection && selection.id === id;
        const label = isText ? (doc.texts.find((x) => x.id === id)?.text.split('\n')[0] ?? '') || t('Teks') : elementName(doc.stickers.find((x) => x.id === id));
        const hidden = isLayerHidden(doc, key);
        return (
          <div
            key={key}
            className={cx('group flex h-9 shrink-0 items-center gap-2 rounded-lg px-2', on ? 'bg-raised ring-1 ring-gold' : 'hover:bg-panel-2', hidden && 'opacity-50')}
            onPointerEnter={() => onHover(sel)}
            onPointerLeave={() => onHover(null)}
          >
            <button type="button" onClick={() => onSelect(sel)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
              <span className="flex w-6 shrink-0 justify-center">{isText ? <Type size={14} className="text-faint" /> : <Shapes size={14} className="text-faint" />}</span>
              <span className={cx('truncate text-xs', on ? 'font-semibold text-fg' : 'text-muted')}>{label}</span>
            </button>
            {rowActions(key, on)}
          </div>
        );
      })}
      {!isFreeLayout(doc) && slots.map((_, i) => photoRow(i, `cell${i}`))}
    </div>
  );
}

/** A sticker's, shape's or gradient's name in the current language. */
export const elementLabel = (name: string) => t(`${name}##elemen`);

/** What an element is called in the list: its sticker or shape name, "Gradasi" for a gradient band. */
export function elementName(st: { sticker: string; gradient?: unknown } | undefined): string {
  if (!st) return t('Elemen');
  if (st.gradient) return t('Gradasi##lapisan');
  if (isPicturePlace(st)) return t('Gambar latar');
  const name = stickerById(st.sticker)?.name ?? shapeById(st.sticker)?.name;
  return name ? elementLabel(name) : t('Elemen');
}

function IconBtn({ label, onClick, on, children }: { label: string; onClick: () => void; on?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className={cx('rounded p-1 hover:bg-line hover:text-fg', on ? 'text-gold-text' : 'text-faint')}>
      {children}
    </button>
  );
}

// ── Teks ───────────────────────────────────────────────────────

export function TextPanel({ onAdd }: { onAdd: (a: { edit: Edit; id: string }) => void }) {
  const [cat, setCat] = useState<string>(PRESET_CATEGORIES[0]!.id);
  const presets = useMemo(() => ALL_PRESETS.filter((p) => p.category === cat), [cat]);
  return (
    <div className="flex flex-col gap-2">
      <Title>{t('Tambah teks')}</Title>
      {(
        [
          ['Judul', 0.11, 700, 'text-lg font-bold'],
          ['Subjudul', 0.06, 600, 'text-[15px] font-semibold'],
          ['Teks biasa', 0.04, 400, 'text-[13px]'],
        ] as const
      ).map(([label, size, weight, cls]) => (
        <button
          key={label}
          type="button"
          onClick={() => onAdd(addText(t(label), size, weight))}
          className={cx('flex h-11 items-center rounded-lg bg-panel-2 px-3 text-left hover:bg-raised', cls)}
        >
          {t(label)}
        </button>
      ))}
      <Title>{t('Gaya siap pakai')}</Title>
      {/* One line however many kinds there are. */}
      <label className="relative flex items-center">
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          aria-label={t('Gaya siap pakai')}
          className="h-8 w-full appearance-none rounded-lg border border-line bg-panel-2 pr-8 pl-2.5 text-xs font-medium text-fg outline-none focus:border-gold"
        >
          {PRESET_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {t(c.label)} ({ALL_PRESETS.filter((p) => p.category === c.id).length})
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-faint" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {presets.map((p) => (
          <button key={p.id} type="button" title={p.name} onClick={() => onAdd(addPreset(p))} className="rounded-md ring-1 ring-line-soft hover:ring-gold">
            <Lazy fit id={`preset:${p.id}`} width={120} make={() => stage(addPreset(p).edit)} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Elemen ─────────────────────────────────────────────────────

export function ElementsPanel({ onAdd }: { onAdd: (a: { edit: Edit; id: string }) => void }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  // Found by its name in either language.
  const named = (name: string) => !query || name.toLowerCase().includes(query) || elementLabel(name).toLowerCase().includes(query);
  const stickers = STICKERS.filter((s) => !s.retired && named(s.name));
  const shapes = SHAPES.filter((s) => named(s.name));
  return (
    <div className="flex flex-col gap-2">
      <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-bg px-2.5 focus-within:border-gold">
        <Search size={13} className="text-faint" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Cari elemen…')} className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-faint" />
      </label>
      {!query && (
        <>
          <Title>{t('Gradasi')}</Title>
          <div className="grid grid-cols-3 gap-1.5">
            {GRADIENT_PRESETS.map((g) => (
              <button key={g.id} type="button" title={elementLabel(g.name)} onClick={() => onAdd(addGradient(g))} className="rounded-md ring-1 ring-line-soft hover:ring-gold">
                <Lazy id={`grad:${g.id}`} width={90} make={() => stage(addGradient(g).edit, '#c9b8a0')} />
              </button>
            ))}
          </div>
        </>
      )}
      {shapes.length > 0 && <Title>{t('Bentuk')}</Title>}
      <div className="grid grid-cols-4 gap-1.5">
        {shapes.map((s) => (
          <button key={s.id} type="button" title={elementLabel(s.name)} onClick={() => onAdd(addShape(s))} className="rounded-md ring-1 ring-line-soft hover:ring-gold">
            <Lazy fit id={`shape:${s.id}`} width={64} make={() => stage(addShape({ ...s, size: s.kind === 'line' ? 0.15 : 0.6, opacity: 1, color: '#d9bd88' }).edit)} />
          </button>
        ))}
      </div>
      {STICKER_CATEGORIES.map((c) => {
        const list = stickers.filter((s) => s.category === c.id);
        if (!list.length) return null;
        return (
          <div key={c.id} className="flex flex-col gap-1.5">
            <Title>{t(c.label)}</Title>
            <div className="grid grid-cols-4 gap-1.5">
              {list.map((s) => (
                <button key={s.id} type="button" title={elementLabel(s.name)} onClick={() => onAdd(addSticker(s))} className="rounded-md ring-1 ring-line-soft hover:ring-gold">
                  <Lazy
                    fit
                    id={`sticker:${s.id}`}
                    width={64}
                    make={() =>
                      stage((d) => {
                        const a = addSticker(s).edit(d);
                        return { ...a, stickers: a.stickers.map((x) => ({ ...x, size: s.ratio > 1 ? 0.55 / s.ratio : 0.7 })) };
                      })
                    }
                  />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Latar ──────────────────────────────────────────────────────

const NEUTRALS = ['#ffffff', '#faf6ee', '#e8e2d4', '#c9a96e', '#8c6a30', '#2b3a33', '#1f2433', '#000000'];

export function BackgroundPanel({ doc, images, edit }: { doc: CollageDoc; images: Map<string, HTMLImageElement>; edit: (fn: Edit) => void }) {
  // Colors that actually occur in the photos: a background that belongs to them.
  const fromPhotos = useMemo(() => (images.size ? extractPalette([...images.values()], 8) : []), [images]);
  const set = (background: string) => edit((d) => ({ ...d, style: { ...d.style, background } }));
  const current = doc.style.background.toLowerCase();
  const swatch = (c: string) => (
    <button
      key={c}
      type="button"
      onClick={() => set(c)}
      aria-label={c}
      title={c}
      className={cx('aspect-square w-full rounded-lg', current === c.toLowerCase() ? 'ring-2 ring-fg ring-offset-2 ring-offset-panel' : 'ring-1 ring-line')}
      style={{ background: c }}
    />
  );
  return (
    <div className="flex flex-col gap-2">
      <Title>{t('Warna latar')}</Title>
      <div className="flex items-center gap-2.5">
        <label className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-lg ring-1 ring-line" style={{ background: doc.style.background }}>
          <input type="color" value={doc.style.background.slice(0, 7)} onChange={(e) => set(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
        </label>
        <span className="font-mono text-xs text-muted uppercase">{doc.style.background}</span>
      </div>
      {fromPhotos.length > 0 && (
        <>
          <Title>{t('Dari foto')}</Title>
          <div className="grid grid-cols-4 gap-2">{fromPhotos.map(swatch)}</div>
        </>
      )}
      <Title>{t('Netral')}</Title>
      <div className="grid grid-cols-4 gap-2">{NEUTRALS.map(swatch)}</div>
      <p className="pt-1 text-[11px] text-faint">{t('Latar terlihat di sela foto dan di bagian yang tidak tertutup foto.')}</p>
    </div>
  );
}
