import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  Check,
  Crop,
  ChevronDown,
  Copy,
  Download,
  FlipHorizontal,
  Italic,
  Layers,
  Minus,
  PaintBucket,
  Pencil,
  Plus,
  Redo2,
  Replace,
  RotateCcw,
  ScanFace,
  Search,
  Shapes,
  ShieldCheck,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cx } from '../components/ui';
import { thumbUrl } from '../lib/api';
import { t } from '../lib/i18n';
import { duplicate, keyOf, nudge, patchSticker, patchText, remove, type Edit } from './actions';
import { DocCanvas, useBox, useDocImages, type Box } from './canvas';
import { isLayerLocked, type CollageDoc, type StickerLayer, type TextLayer } from './engine/document';
import { FONT_CATEGORIES, FONTS } from './engine/font-catalog';
import { frameOf, type Selection } from './engine/render';
import { ExportDialog } from './export';
import { fontFamilies, formatLabel, photoIdOf, slotShapes } from './kit';
import { BackgroundPanel, ElementsPanel, LayersPanel, TextPanel, elementName } from './panels';
import { facePan, ranked, useKreasi, type SourcePhoto } from './store';
import { SHAPE_LABEL, ShapeIcon, Steps } from './ui';

type Panel = 'lapisan' | 'teks' | 'elemen' | 'latar';
const RAIL: { id: Panel; icon: typeof Layers; label: string }[] = [
  { id: 'lapisan', icon: Layers, label: 'Lapisan' },
  { id: 'teks', icon: Type, label: 'Teks' },
  { id: 'elemen', icon: Shapes, label: 'Elemen' },
  { id: 'latar', icon: PaintBucket, label: 'Latar' },
];

/** Layar 14 · Editor template. */
export function Editor() {
  const { doc, template, source, past, future, name, savedAt } = useKreasi();
  const { setStep, setActive, live, commit, edit, undo, redo, setName } = useKreasi.getState();
  const [selection, setSelection] = useState<Selection>(null);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>('lapisan');
  const [exporting, setExporting] = useState(false);
  const [replacing, setReplacing] = useState<number | null>(null);
  // "Atur ukuran" (⌘T, double-click): the photo place whose whole picture is out to drag and resize.
  const [cropping, setCropping] = useState<number | null>(null);
  // The layer row under the pointer: outlined on the canvas as if hovered there.
  const [layerHover, setLayerHover] = useState<Selection>(null);
  if (cropping != null && (selection?.kind !== 'cell' || selection.index !== cropping || !doc?.slots[cropping])) setCropping(null);
  // Picking something else closes the change being made to the last one (one undo step).
  const select = (s: Selection) => (commit(), setSelection(s), setEditingText(null));

  // ⌘E from the menu bar: this design's export, not the session's.
  useEffect(() => {
    const go = () => setExporting(true);
    window.addEventListener('pfm:kreasi-export', go);
    return () => window.removeEventListener('pfm:kreasi-export', go);
  }, []);
  const [safe, setSafe] = useState(false);
  const [stageRef, stage] = useBox<HTMLDivElement>();
  const images = useDocImages(doc, source?.root ?? null, true);

  // View zoom: 1 fits the canvas in the window; up to 8× for detail.
  const [view, setView] = useState(1);
  const zoomBy = (k: number, at?: { x: number; y: number }) => {
    const el = stageRef.current;
    setView((v) => {
      const next = Math.min(8, Math.max(0.25, v * k));
      // Keep the point under the cursor (or the middle) where it is.
      if (el) {
        const px = at?.x ?? el.clientWidth / 2;
        const py = at?.y ?? el.clientHeight / 2;
        const cx = el.scrollLeft + px;
        const cy = el.scrollTop + py;
        const r = next / v;
        requestAnimationFrame(() => {
          el.scrollLeft = cx * r - px;
          el.scrollTop = cy * r - py;
        });
      }
      return next;
    });
  };

  // ⌘/Ctrl + wheel and trackpad pinch (which arrives as Ctrl + wheel) zoom the view;
  // a plain wheel scrolls it. Not passive, so the page itself never zooms.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomBy(Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // Keyboard: Delete, ⌘D, ⌘T, arrows, Enter, Esc, ⌘= / ⌘− / ⌘0. Undo / redo keys: app.tsx.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      // Shortcuts keep working after a slider, colour or checkbox was clicked.
      const typing =
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        (el instanceof HTMLInputElement && ['text', 'search', 'number', 'email', 'url', 'password', ''].includes(el.type));
      if (typing || exporting || replacing != null) return;
      const d = useKreasi.getState().doc;
      if (!d) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === '=' || e.key === '+')) return (e.preventDefault(), zoomBy(1.25));
      if (mod && e.key === '-') return (e.preventDefault(), zoomBy(0.8));
      if (mod && e.key === '0') return (e.preventDefault(), setView(1));
      if (cropping != null && (e.key === 'Escape' || e.key === 'Enter')) return (e.preventDefault(), setCropping(null));
      if (e.key === 'Escape') return select(null);
      if (mod && e.key.toLowerCase() === 't') {
        // Photos get their picture out; texts and elements already show their handles.
        e.preventDefault();
        if (selection?.kind === 'cell' && d.slots[selection.index]) setCropping((c) => (c == null ? selection.index : null));
        return;
      }
      const key = keyOf(selection);
      const locked = key ? isLayerLocked(d, key) : false;
      if ((e.key === 'Delete' || e.key === 'Backspace') && key && !locked) {
        e.preventDefault();
        edit(remove(selection));
        setSelection(null);
      } else if (mod && e.key.toLowerCase() === 'd' && key) {
        e.preventDefault();
        const dup = duplicate(selection, d);
        if (dup) (edit(dup.edit), setSelection(dup.selection));
      } else if (e.key.startsWith('Arrow') && key && !locked) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const f = frameOf(d, 1080 * d.slides);
        const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        const [dx, dy] = moves[e.key] ?? [0, 0];
        edit(nudge(selection, dx, dy, f.width, f.height));
      } else if (e.key === 'Enter' && selection?.kind === 'text' && !locked) {
        e.preventDefault();
        setEditingText(selection.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!doc || !template) return null;

  const setSlot = (i: number, patch: Partial<NonNullable<CollageDoc['slots'][number]>>, liveOnly = false) =>
    (liveOnly ? live : edit)((d) => ({ ...d, slots: d.slots.map((s, j) => (j === i && s ? { ...s, ...patch } : s)) }));
  const photoOf = (i: number): SourcePhoto | null => {
    const s = doc.slots[i];
    const id = s ? photoIdOf(s.file) : null;
    return id != null ? (source?.photos.find((p) => p.id === id) ?? null) : null;
  };
  const added = (a: { edit: Edit; id: string }) => {
    edit(a.edit);
    // The new thing is picked; its kind is whatever list it landed in.
    const d = useKreasi.getState().doc!;
    setSelection(d.texts.some((x) => x.id === a.id) ? { kind: 'text', id: a.id } : { kind: 'sticker', id: a.id });
  };
  const selText = selection?.kind === 'text' ? doc.texts.find((x) => x.id === selection.id) : undefined;
  const selSticker = selection?.kind === 'sticker' ? doc.stickers.find((x) => x.id === selection.id) : undefined;

  /** The quick bar over the selection: the few things done most. */
  const quickBar = (box: Box) => {
    const btn = (icon: React.ReactNode, label: string, run: () => void, danger = false) => (
      <button
        key={label}
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={run}
        className={cx('flex h-7 items-center gap-1.5 rounded-md px-2 text-xs whitespace-nowrap', danger ? 'text-reject hover:bg-reject/15' : 'text-fg hover:bg-line')}
      >
        {icon}
        {label}
      </button>
    );
    const copy = () => {
      const dup = duplicate(selection, doc);
      if (dup) (edit(dup.edit), setSelection(dup.selection));
    };
    const items: React.ReactNode[] = [];
    if (selection?.kind === 'text') {
      items.push(btn(<Pencil size={13} />, t('Ubah teks'), () => setEditingText(selection.id)));
      items.push(btn(<Copy size={13} />, t('Duplikat'), copy));
      items.push(btn(<Trash2 size={13} />, t('Hapus'), () => (edit(remove(selection)), setSelection(null)), true));
    } else if (selection?.kind === 'sticker') {
      items.push(btn(<Copy size={13} />, t('Duplikat'), copy));
      items.push(btn(<Trash2 size={13} />, t('Hapus'), () => (edit(remove(selection)), setSelection(null)), true));
    } else if (selection?.kind === 'cell') {
      const i = selection.index;
      const p = photoOf(i);
      if (cropping === i) {
        items.push(btn(<RotateCcw size={13} />, t('Atur ulang'), () => setSlot(i, { zoom: 1, ox: 0, oy: 0 })));
        items.push(btn(<Check size={13} />, t('Selesai'), () => setCropping(null)));
      } else {
        items.push(btn(<Replace size={13} />, p ? t('Ganti') : t('Pilih foto##isi'), () => setReplacing(i)));
        if (p) items.push(btn(<Crop size={13} />, t('Atur ukuran'), () => setCropping(i)));
        if (p?.faces?.length) items.push(btn(<ScanFace size={13} />, t('Pas wajah'), () => setSlot(i, { zoom: 1, ...facePan(p, slotShapes(doc)[i]?.ratio ?? 1) })));
        if (p) items.push(btn(<RotateCcw size={13} />, t('Atur ulang'), () => setSlot(i, { zoom: 1, ox: 0, oy: 0, rotate: 0 })));
      }
    }
    if (!items.length) return null;
    const top = box.cy - box.h / 2;
    return (
      <div
        className="absolute z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-[10px] border border-line bg-raised p-1 shadow-xl"
        style={{ left: box.cx, top: Math.max(-52, top - (selection?.kind === 'cell' ? 44 : 76)) }}
      >
        {items}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line-soft px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button type="button" onClick={() => setStep(useKreasi.getState().resumed ? 'galeri' : 'isi')} title={t('Kembali')} className="text-muted hover:text-fg">
            <ArrowLeft size={18} />
          </button>
          <NameField value={name} onChange={setName} />
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-faint">
            {savedAt ? (
              <>
                <Check size={12} className="text-pick" /> {t('Tersimpan')}
              </>
            ) : (
              t('Belum disimpan')
            )}
          </span>
        </div>
        <Steps at={3} onGo={(n) => setStep(n === 1 ? 'galeri' : 'isi')} />
        <div className="flex flex-1 items-center justify-end gap-2.5">
          <button type="button" onClick={undo} disabled={!past.length} title={t('Urungkan')} className="text-muted hover:text-fg disabled:opacity-30">
            <Undo2 size={17} />
          </button>
          <button type="button" onClick={redo} disabled={!future.length} title={t('Ulangi')} className="text-muted hover:text-fg disabled:opacity-30">
            <Redo2 size={17} />
          </button>
          <span className="h-5 w-px bg-line" />
          <button type="button" onClick={() => setExporting(true)} className="flex h-9 items-center gap-2 rounded-[10px] bg-gold-gradient px-4 text-[13px] font-semibold text-white">
            <Download size={15} /> {t('Ekspor')}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[68px] shrink-0 flex-col items-center gap-1 border-r border-line-soft bg-panel pt-3">
          {RAIL.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setPanel(r.id)}
              className={cx('flex w-[60px] flex-col items-center gap-1 rounded-[10px] py-2 text-center text-[10px] leading-tight font-medium', panel === r.id ? 'bg-raised text-gold-text' : 'text-faint hover:text-fg')}
            >
              <r.icon size={17} />
              {t(r.label)}
            </button>
          ))}
        </nav>
        <aside className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line-soft bg-panel p-3.5">
          {panel === 'lapisan' && <LayersPanel doc={doc} selection={selection} images={images} onSelect={select} onHover={setLayerHover} edit={edit} />}
          {panel === 'teks' && <TextPanel onAdd={added} />}
          {panel === 'elemen' && <ElementsPanel onAdd={added} />}
          {panel === 'latar' && <BackgroundPanel doc={doc} images={images} edit={edit} />}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col bg-[#08100d]">
          <div ref={stageRef} className="min-h-0 flex-1 overflow-auto">
            {/* Centred while it fits; scrollable from its edges once zoomed past the window. Room above for the quick bar. */}
            <div className="flex min-h-full w-max min-w-full items-center justify-center px-8 pt-16 pb-8" onPointerDown={(e) => e.target === e.currentTarget && select(null)}>
              {stage.w > 0 && (
                <DocCanvas
                  doc={doc}
                  images={images}
                  box={{ w: stage.w - 64, h: stage.h - 96 }}
                  scale={view}
                  selection={selection}
                  outlines
                  safe={safe}
                  editingText={editingText}
                  overlay={quickBar}
                  cropping={cropping}
                  hovered={panel === 'lapisan' ? layerHover : null}
                  handlers={{
                    onSelect: select,
                    onCropCell: (i) => doc.slots[i] && (select({ kind: 'cell', index: i }), setCropping(i)),
                    onEndCrop: () => setCropping(null),
                    onPan: (i, ox, oy) => setSlot(i, { ox, oy }, true),
                    onZoom: (i, zoom) => setSlot(i, { zoom }, true),
                    onPatch: (s, p) => live(s.kind === 'text' ? patchText(s.id, p) : patchSticker(s.id, p)),
                    onEditText: (id) => (setSelection({ kind: 'text', id }), setEditingText(id)),
                    onTextInput: (id, text) => live(patchText(id, { text })),
                    onEndEdit: () => (commit(), setEditingText(null)),
                    onCommit: commit,
                  }}
                />
              )}
            </div>
          </div>
          <div className="flex h-10 shrink-0 items-center justify-center gap-4 overflow-hidden border-t border-line-soft px-3 text-[11px] whitespace-nowrap text-faint">
            <span className="shrink-0">{formatLabel(doc.format)}</span>
            <span className="h-3 w-px bg-line" />
            <span className="flex items-center gap-1">
              <button type="button" onClick={() => zoomBy(0.8)} title={t('Perkecil')} className="rounded p-1 hover:bg-raised hover:text-fg">
                <Minus size={13} />
              </button>
              <button type="button" onClick={() => setView(1)} title={t('Pas layar')} className="w-12 rounded py-0.5 text-center font-medium text-fg tabular-nums hover:bg-raised">
                {Math.round(view * 100)}%
              </button>
              <button type="button" onClick={() => zoomBy(1.25)} title={t('Perbesar')} className="rounded p-1 hover:bg-raised hover:text-fg">
                <Plus size={13} />
              </button>
            </span>
            <span className="h-3 w-px bg-line" />
            <button type="button" onClick={() => setSafe((v) => !v)} className={cx('flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-raised', safe ? 'text-gold-text' : 'hover:text-fg')}>
              <ShieldCheck size={13} /> {t('Area aman')}
            </button>
            <span className="hidden h-3 w-px bg-line 2xl:inline" />
            <span className="hidden min-w-0 truncate 2xl:inline" title={t('Dobel klik teks untuk mengubah · ⌘ + scroll zoom kanvas · ⌥ + scroll zoom foto · ⌘ saat menyeret: tanpa magnet')}>
              {t('Dobel klik teks untuk mengubah · ⌘ + scroll zoom kanvas · ⌥ + scroll zoom foto · ⌘ saat menyeret: tanpa magnet')}
            </span>
          </div>
        </div>

        <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line-soft bg-panel p-5">
          {selText ? (
            <TextInspector key={selText.id} layer={selText} doc={doc} onChange={(p) => edit(patchText(selText.id, p))} onLive={(p) => live(patchText(selText.id, p))} onCommit={commit} />
          ) : selSticker ? (
            <StickerInspector layer={selSticker} onChange={(p) => edit(patchSticker(selSticker.id, p))} onLive={(p) => live(patchSticker(selSticker.id, p))} onCommit={commit} />
          ) : selection?.kind === 'cell' ? (
            <PhotoInspector
              index={selection.index}
              doc={doc}
              photo={photoOf(selection.index)}
              onChange={(p, l) => setSlot(selection.index, p, l)}
              onCommit={commit}
              onReplace={() => setReplacing(selection.index)}
            />
          ) : (
            <div className="flex flex-col gap-3 text-[13px] text-muted">
              <span className="text-[15px] font-semibold text-fg">{name}</span>
              <span className="text-xs">
                {formatLabel(doc.format)} · {template.name}
              </span>
              <p className="text-xs">{t('Klik foto, teks, atau elemen di kanvas untuk mengubahnya. Tambah teks dan elemen dari panel kiri.')}</p>
            </div>
          )}
        </aside>
      </div>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {replacing != null && <ReplaceDialog index={replacing} onClose={() => setReplacing(null)} onPickMore={() => (setActive(replacing), setStep('isi'))} />}
    </div>
  );
}

/** The design's name, edited in place. */
function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() && draft !== value && onChange(draft.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      title={t('Ganti nama desain')}
      style={{ width: `${Math.min(36, Math.max(6, draft.length + 2))}ch` }}
      className="min-w-0 truncate rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[15px] font-semibold outline-none hover:border-line focus:border-gold"
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-semibold text-faint uppercase">{title}</span>
      {children}
    </div>
  );
}

function Slider({ label, value, min, max, step, show, onChange, onDone }: { label: string; value: number; min: number; max: number; step: number; show: string; onChange: (v: number) => void; onDone?: () => void }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-medium tabular-nums">{show}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onPointerUp={onDone} onKeyUp={onDone} className="accent-[var(--color-gold)]" />
    </label>
  );
}

function Btn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel-2 text-xs hover:bg-raised">
      {children}
    </button>
  );
}

function PhotoInspector({
  index,
  doc,
  photo,
  onChange,
  onCommit,
  onReplace,
}: {
  index: number;
  doc: CollageDoc;
  photo: SourcePhoto | null;
  onChange: (p: Partial<NonNullable<CollageDoc['slots'][number]>>, liveOnly?: boolean) => void;
  onCommit: () => void;
  onReplace: () => void;
}) {
  const slot = doc.slots[index];
  const shape = slotShapes(doc)[index];
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold">{t('Foto {n}', { n: index + 1 })}</span>
        {shape && (
          <span className="flex items-center gap-1 text-[11px] text-faint">
            <ShapeIcon shape={shape.shape} size={12} /> {t(SHAPE_LABEL[shape.shape])}
          </span>
        )}
      </div>
      <Section title={t('Foto')}>
        {photo ? (
          <div className="flex items-center gap-2.5">
            {photo.thumb && <img src={thumbUrl(photo.thumb)} alt="" className="h-12 w-[68px] rounded-md object-cover" />}
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-medium">{photo.name}</span>
              {photo.rating ? <span className="text-[11px] text-faint">★{photo.rating}</span> : null}
            </div>
          </div>
        ) : (
          <span className="text-xs text-muted">{t('Belum ada foto')}</span>
        )}
        <Btn onClick={onReplace}>
          <Replace size={13} /> {photo ? t('Ganti foto') : t('Pilih foto##isi')}
        </Btn>
      </Section>
      {photo && slot && (
        <Section title={t('Posisi di tempatnya')}>
          <Slider label={t('Zoom')} value={slot.zoom} min={1} max={3} step={0.01} show={`${Math.round(slot.zoom * 100)}%`} onChange={(zoom) => onChange({ zoom }, true)} onDone={onCommit} />
          <Slider label={t('Putar')} value={slot.rotate} min={-45} max={45} step={0.5} show={`${slot.rotate.toFixed(1).replace('.', ',')}°`} onChange={(rotate) => onChange({ rotate }, true)} onDone={onCommit} />
          <div className="flex gap-2">
            {photo.faces?.length ? (
              <Btn onClick={() => onChange({ zoom: 1, ...facePan(photo, shape?.ratio ?? 1) })}>
                <ScanFace size={13} /> {t('Pas wajah')}
              </Btn>
            ) : null}
            <Btn onClick={() => onChange({ flip: !slot.flip })}>
              <FlipHorizontal size={13} /> {t('Balik')}
            </Btn>
            <Btn onClick={() => onChange({ zoom: 1, ox: 0, oy: 0, rotate: 0 })}>
              <RotateCcw size={13} /> {t('Atur ulang')}
            </Btn>
          </div>
          <p className="text-[11px] text-faint">{t('Seret foto di kanvas untuk menggeser. ⌥ + scroll untuk zoom.')}</p>
        </Section>
      )}
    </>
  );
}

/** Colors the design already uses, then a few neutrals. */
function palette(doc: CollageDoc): string[] {
  const used = [...doc.texts.map((x) => x.color), ...doc.stickers.map((x) => x.color), doc.style.background].map((c) => c.toLowerCase().slice(0, 7));
  return [...new Set([...used, '#ffffff', '#000000', '#2b3a33', '#c9a96e'])].slice(0, 12);
}

function Swatches({ doc, value, onPick }: { doc: CollageDoc; value: string; onPick: (c: string) => void }) {
  const colors = useMemo(() => palette(doc), [doc]);
  return (
    <div className="flex flex-wrap gap-2">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onPick(c)}
          aria-label={c}
          title={c}
          className={cx('size-7 rounded-full', value.toLowerCase().startsWith(c) ? 'ring-2 ring-fg ring-offset-2 ring-offset-panel' : 'ring-1 ring-line')}
          style={{ background: c }}
        />
      ))}
      <label className="relative flex size-7 cursor-pointer items-center justify-center overflow-hidden rounded-full text-sm text-faint ring-1 ring-line" title={t('Warna lain')}>
        <input type="color" value={value.slice(0, 7)} onChange={(e) => onPick(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />+
      </label>
    </div>
  );
}

function TextInspector({ layer, doc, onChange, onLive, onCommit }: { layer: TextLayer; doc: CollageDoc; onChange: (p: Partial<TextLayer>) => void; onLive: (p: Partial<TextLayer>) => void; onCommit: () => void }) {
  return (
    <>
      <span className="text-[15px] font-semibold">{t('Teks')}</span>
      <Section title={t('Isi')}>
        <textarea
          value={layer.text}
          rows={3}
          onChange={(e) => onLive({ text: e.target.value })}
          onBlur={onCommit}
          className="resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-gold"
        />
      </Section>
      <Section title={t('Huruf')}>
        <FontPicker value={layer.font} onChange={(font) => onChange({ font })} />
        <Slider label={t('Ukuran')} value={layer.size} min={0.015} max={0.3} step={0.001} show={`${Math.round(layer.size * 1080)} px`} onChange={(size) => onLive({ size })} onDone={onCommit} />
        <Slider label={t('Jarak huruf')} value={layer.spacing} min={-0.05} max={0.6} step={0.01} show={layer.spacing.toFixed(2).replace('.', ',')} onChange={(spacing) => onLive({ spacing })} onDone={onCommit} />
        <div className="flex gap-1.5">
          <IconToggle on={layer.weight >= 600} onClick={() => onChange({ weight: layer.weight >= 600 ? 400 : 700 })} label={t('Tebal')}>
            <Bold size={14} />
          </IconToggle>
          <IconToggle on={layer.italic} onClick={() => onChange({ italic: !layer.italic })} label={t('Miring')}>
            <Italic size={14} />
          </IconToggle>
          <IconToggle on={layer.textCase === 'besar'} onClick={() => onChange({ textCase: layer.textCase === 'besar' ? 'asli' : 'besar' })} label={t('Huruf besar semua')}>
            <span className="text-[11px] font-bold">AA</span>
          </IconToggle>
          <span className="w-2" />
          {(['left', 'center', 'right'] as const).map((a) => (
            <IconToggle key={a} on={layer.align === a} onClick={() => onChange({ align: a })} label={a}>
              {a === 'left' ? <AlignLeft size={14} /> : a === 'center' ? <AlignCenter size={14} /> : <AlignRight size={14} />}
            </IconToggle>
          ))}
        </div>
      </Section>
      <Section title={t('Warna')}>
        <Swatches doc={doc} value={layer.color} onPick={(color) => onChange({ color, fill: undefined })} />
      </Section>
      <Section title={t('Lainnya')}>
        <Slider label={t('Transparansi')} value={layer.opacity ?? 1} min={0.1} max={1} step={0.01} show={`${Math.round((layer.opacity ?? 1) * 100)}%`} onChange={(opacity) => onLive({ opacity })} onDone={onCommit} />
        <Slider label={t('Putar')} value={layer.rotate ?? 0} min={-180} max={180} step={1} show={`${Math.round(layer.rotate ?? 0)}°`} onChange={(rotate) => onLive({ rotate })} onDone={onCommit} />
      </Section>
    </>
  );
}

function StickerInspector({ layer, onChange, onLive, onCommit }: { layer: StickerLayer; onChange: (p: Partial<StickerLayer>) => void; onLive: (p: Partial<StickerLayer>) => void; onCommit: () => void }) {
  const doc = useKreasi((s) => s.doc)!;
  const name = elementName(layer);
  return (
    <>
      <span className="text-[15px] font-semibold">{name}</span>
      {!layer.gradient && (
        <Section title={t('Warna')}>
          <Swatches doc={doc} value={layer.color} onPick={(color) => onChange({ color })} />
        </Section>
      )}
      <Section title={t('Ukuran & posisi')}>
        <Slider label={t('Ukuran')} value={layer.size} min={0.02} max={1.5} step={0.005} show={`${Math.round(layer.size * 100)}%`} onChange={(size) => onLive({ size })} onDone={onCommit} />
        <Slider label={t('Putar')} value={layer.rotate} min={-180} max={180} step={1} show={`${Math.round(layer.rotate)}°`} onChange={(rotate) => onLive({ rotate })} onDone={onCommit} />
        <Slider label={t('Transparansi')} value={layer.opacity ?? 1} min={0.05} max={1} step={0.01} show={`${Math.round((layer.opacity ?? 1) * 100)}%`} onChange={(opacity) => onLive({ opacity })} onDone={onCommit} />
        <div className="flex gap-2">
          <Btn onClick={() => onChange({ flip: !layer.flip })}>
            <FlipHorizontal size={13} /> {t('Balik')}
          </Btn>
        </div>
      </Section>
    </>
  );
}

function IconToggle({ on, onClick, label, children }: { on: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-pressed={on}
      className={cx('flex size-8 items-center justify-center rounded-lg', on ? 'bg-raised text-fg ring-1 ring-line' : 'text-muted hover:bg-panel-2')}
    >
      {children}
    </button>
  );
}

/** Every bundled font, each shown in its own face, grouped and searchable. */
function FontPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const fam = fontFamilies();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const query = q.trim().toLowerCase();
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex h-10 w-full items-center justify-between rounded-lg border border-line bg-bg px-3 text-left hover:border-faint">
        <span className="truncate text-[15px]" style={{ fontFamily: fam[value] }}>
          {FONTS[value]?.label ?? value}
        </span>
        <ChevronDown size={14} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div className="absolute top-11 right-0 left-0 z-30 flex max-h-96 flex-col rounded-xl border border-line bg-panel-2 shadow-2xl">
          <label className="m-2 flex h-8 items-center gap-2 rounded-lg border border-line bg-bg px-2.5 focus-within:border-gold">
            <Search size={13} className="text-faint" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Cari huruf…')} className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-faint" />
            {q && (
              <button type="button" onClick={() => setQ('')}>
                <X size={12} className="text-faint" />
              </button>
            )}
          </label>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
            {FONT_CATEGORIES.map((c) => {
              const list = Object.entries(FONTS).filter(([, f]) => f.category === c.id && (!query || f.label.toLowerCase().includes(query)));
              if (!list.length) return null;
              return (
                <div key={c.id} className="flex flex-col">
                  <span className="px-2 pt-2 pb-1 text-[10px] font-semibold text-faint uppercase">{t(c.label)}</span>
                  {list.map(([id, f]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => (onChange(id), setOpen(false))}
                      className={cx('flex h-9 shrink-0 items-center justify-between rounded-lg px-2 text-left text-[17px] hover:bg-raised', id === value && 'bg-raised')}
                      style={{ fontFamily: fam[id] }}
                    >
                      <span className="truncate">{f.label}</span>
                      {id === value && <Check size={14} className="shrink-0 text-gold-text" />}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Ganti foto without leaving the editor: the source's photos, best first. */
function ReplaceDialog({ index, onClose, onPickMore }: { index: number; onClose: () => void; onPickMore: () => void }) {
  const source = useKreasi((s) => s.source);
  const place = useKreasi((s) => s.place);
  const [q, setQ] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const photos = useMemo(() => {
    const query = q.trim().toLowerCase();
    return ranked(source?.photos ?? []).filter((p) => p.status !== 'reject' && (!query || p.name.toLowerCase().includes(query))).slice(0, 300);
  }, [source, q]);
  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} className="flex max-h-full w-[760px] max-w-full flex-col gap-4 rounded-[18px] border border-line bg-panel p-6 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t('Ganti Foto {n}', { n: index + 1 })}</h2>
          <div className="flex items-center gap-2">
            <label className="flex h-8 w-52 items-center gap-2 rounded-lg border border-line bg-bg px-2.5 focus-within:border-gold">
              <Search size={13} className="text-faint" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Cari nama file…')} className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-faint" />
            </label>
            <button type="button" onClick={onClose} aria-label={t('Tutup')} className="text-faint hover:text-fg">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="grid min-h-0 grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2.5 overflow-y-auto p-1">
          {photos.map((p) => (
            <button key={p.id} type="button" onClick={() => (place(index, p), onClose())} title={p.name} className="aspect-[3/2] overflow-hidden rounded-lg bg-raised hover:ring-2 hover:ring-gold">
              {p.thumb && <img src={thumbUrl(p.thumb)} alt="" loading="lazy" className="size-full object-cover" />}
            </button>
          ))}
          {!photos.length && <p className="col-span-full py-10 text-center text-sm text-faint">{t('Belum ada foto di sumber ini.')}</p>}
        </div>
        <div className="flex items-center justify-between text-xs text-faint">
          <span>{t('Foto Dipilih dan Cek, bintang tertinggi dulu.')}</span>
          <button type="button" onClick={onPickMore} className="font-medium text-gold-text hover:underline">
            {t('Pilih dari folder lain…')}
          </button>
        </div>
      </div>
    </div>
  );
}
