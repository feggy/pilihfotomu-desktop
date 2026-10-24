import {
  AlignCenter,
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignLeft,
  AlignRight,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowLeft,
  Bold,
  Check,
  Crop,
  ChevronDown,
  Copy,
  Download,
  FlipHorizontal,
  Images,
  BookmarkPlus,
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
import { fixed } from '../lib/format';
import { t } from '../lib/i18n';
import {
  alignMany,
  duplicate,
  duplicateMany,
  keyOf,
  nudge,
  nudgeMany,
  order,
  patchFrame,
  patchSticker,
  patchText,
  placeMany,
  remove,
  removeMany,
  type Align,
  type Edit,
} from './actions';
import { DocCanvas, sameSel, useBox, useDocImages, type Box, type Multi } from './canvas';
import { formatRatio, isFreeLayout, isLayerLocked, isPlaceholder, layerKeys, templateOf, type LayerMove, type CollageDoc, type PhotoMask, type StickerLayer, type TextLayer } from './engine/document';
import { FONT_CATEGORIES, FONTS } from './engine/font-catalog';
import { itemBounds } from './engine/bounds';
import { frameOf, type Selection } from './engine/render';
import { ExportDialog } from './export';
import { CATEGORIES, EMPTY_PICTURE, fontFamilies, formatLabel, isPicturePlace, photoIdOf, photoSticker, saveMyTemplate, slotShapes, type TemplateCategory } from './kit';
import { PhotosPanel } from './photos-panel';
import { BackgroundPanel, ElementsPanel, LayersPanel, TextPanel, elementName } from './panels';
import { facePan, placed, ranked, useKreasi, type SourcePhoto } from './store';
import { SHAPE_LABEL, ShapeIcon, Steps } from './ui';

type Panel = 'lapisan' | 'foto' | 'teks' | 'elemen' | 'latar';
const RAIL: { id: Panel; icon: typeof Layers; label: string }[] = [
  { id: 'lapisan', icon: Layers, label: 'Lapisan' },
  { id: 'foto', icon: Images, label: 'Foto##latar' },
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
  // An empty canvas opens on its photos: that is where a design from nothing starts.
  const [panel, setPanel] = useState<Panel>(() => {
    const d = useKreasi.getState().doc;
    return d && isFreeLayout(d) && !d.freeCells.length ? 'foto' : 'lapisan';
  });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [replacing, setReplacing] = useState<number | null>(null);
  // A background-image place (by its sticker id) being given a photo.
  const [picturing, setPicturing] = useState<string | null>(null);
  // "Atur ukuran" (⌘T, double-click): the photo place whose whole picture is out to drag and resize.
  const [cropping, setCropping] = useState<number | null>(null);
  // The layer row under the pointer: outlined on the canvas as if hovered there.
  const [layerHover, setLayerHover] = useState<Selection>(null);
  if (cropping != null && (selection?.kind !== 'cell' || selection.index !== cropping || (doc ? placed(doc)[cropping] == null : true))) setCropping(null);
  // Picking something else closes the change being made to the last one (one undo step).
  const select = (s: Selection) => (commit(), setSelection(s), setEditingText(null), setMulti([]));
  // Several picked at once (a box dragged on the canvas, Shift + click); `selection` is then null.
  const [multi, setMulti] = useState<Multi>([]);
  const pickMany = (list: Multi) => (commit(), setMulti(list), list.length > 1 && setSelection(null));
  // A press on the stage around the canvas starts a selection box there too.
  const bandRef = useRef<((e: { clientX: number; clientY: number; shiftKey: boolean }) => void) | null>(null);

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
      if (typing || exporting || savingTemplate || replacing != null || picturing != null) return;
      const d = useKreasi.getState().doc;
      if (!d) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === '=' || e.key === '+')) return (e.preventDefault(), zoomBy(1.25));
      if (mod && e.key === '-') return (e.preventDefault(), zoomBy(0.8));
      if (mod && e.key === '0') return (e.preventDefault(), setView(1));
      if (cropping != null && (e.key === 'Escape' || e.key === 'Enter')) return (e.preventDefault(), setCropping(null));
      if (e.key === 'Escape') return select(null);
      // ] / [ one layer up / down (⌘ too); with Shift all the way. By key position, whatever the keyboard layout types.
      if (!e.altKey && (e.code === 'BracketRight' || e.code === 'BracketLeft')) {
        e.preventDefault();
        const up = e.code === 'BracketRight';
        const to: LayerMove = e.shiftKey ? (up ? 'front' : 'back') : up ? 'forward' : 'backward';
        const picked = multi.length > 1 ? multi : selection ? [selection] : [];
        const keys = picked.map((x) => keyOf(x, d)).filter((k): k is string => !!k && !isLayerLocked(d, k));
        // Several keep their order among themselves: the one nearest where they go moves first.
        const at = layerKeys(d);
        const first = to === 'forward' || to === 'back' ? -1 : 1;
        keys.sort((a, b) => first * (at.indexOf(a) - at.indexOf(b)));
        if (keys.length) edit((doc) => keys.reduce((x, k) => order(k, to)(x), doc));
        return;
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        return pickMany(allMovable(d));
      }
      if (multi.length > 1) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          edit(removeMany(multi));
          setMulti([]);
        } else if (mod && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          const dup = duplicateMany(multi, d);
          edit(dup.edit);
          setMulti(dup.selection);
        } else if (e.key.startsWith('Arrow')) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const f = frameOf(d, 1080 * d.slides);
          const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          const [dx, dy] = moves[e.key] ?? [0, 0];
          edit(nudgeMany(multi, dx, dy, f.width, f.height));
        }
        return;
      }
      if (mod && e.key.toLowerCase() === 't') {
        // Photos get their picture out; texts and elements already show their handles.
        e.preventDefault();
        if (selection?.kind === 'cell' && placed(d)[selection.index] != null) setCropping((c) => (c == null ? selection.index : null));
        return;
      }
      const key = keyOf(selection, d);
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
  const free = isFreeLayout(doc);
  /**
   * A photo from the Foto panel: a new frame on an empty canvas; on a
   * template, into the selected photo place, else the first empty one.
   */
  const putPhoto = (p: SourcePhoto, at?: { x: number; y: number }) => {
    if (free) {
      const index = useKreasi.getState().addFrame(p, at);
      if (index >= 0) select({ kind: 'cell', index });
      return;
    }
    const empty = placed(doc).findIndex((id) => id == null);
    const i = selection?.kind === 'cell' ? selection.index : Math.max(0, empty);
    useKreasi.getState().place(i, p);
    select({ kind: 'cell', index: i });
  };
  const photoById = (id: number) => source?.photos.find((p) => p.id === id);
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
    if (multi.length > 1) {
      items.push(
        btn(<Copy size={13} />, t('Duplikat'), () => {
          const dup = duplicateMany(multi, doc);
          edit(dup.edit);
          setMulti(dup.selection);
        }),
      );
      items.push(btn(<Trash2 size={13} />, t('Hapus'), () => (edit(removeMany(multi)), setMulti([])), true));
    } else
    if (selection?.kind === 'text') {
      items.push(btn(<Pencil size={13} />, t('Ubah teks'), () => setEditingText(selection.id)));
      items.push(btn(<Copy size={13} />, t('Duplikat'), copy));
      items.push(btn(<Trash2 size={13} />, t('Hapus'), () => (edit(remove(selection)), setSelection(null)), true));
    } else if (selection?.kind === 'sticker' && selSticker && isPicturePlace(selSticker)) {
      const empty = isPlaceholder(selSticker.sticker);
      items.push(btn(<Replace size={13} />, empty ? t('Pilih foto##isi') : t('Ganti'), () => setPicturing(selection.id)));
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
        if (free) {
          // A frame of its own: copied and deleted like any element.
          items.push(btn(<Copy size={13} />, t('Duplikat'), copy));
          items.push(btn(<Trash2 size={13} />, t('Hapus'), () => (edit(remove(selection)), setSelection(null)), true));
        } else {
          if (p?.faces?.length) items.push(btn(<ScanFace size={13} />, t('Pas wajah'), () => setSlot(i, { zoom: 1, ...facePan(p, slotShapes(doc)[i]?.ratio ?? 1) })));
          if (p) items.push(btn(<RotateCcw size={13} />, t('Atur ulang'), () => setSlot(i, { zoom: 1, ox: 0, oy: 0, rotate: 0 })));
        }
      }
    }
    if (!items.length) return null;
    const top = box.cy - box.h / 2;
    return (
      <div
        className="absolute z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-[10px] border border-line bg-raised p-1 shadow-xl"
        style={{ left: box.cx, top: Math.max(-52, top - (selection?.kind === 'cell' && !free ? 44 : 76)) }}
      >
        {items}
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line-soft px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button type="button" onClick={() => setStep(useKreasi.getState().resumed || free ? 'galeri' : 'isi')} title={t('Kembali')} className="text-muted hover:text-fg">
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
        <Steps at={3} noPhotos={free} onGo={(n) => setStep(n === 1 ? 'galeri' : 'isi')} />
        <div className="flex flex-1 items-center justify-end gap-2.5">
          <button type="button" onClick={undo} disabled={!past.length} title={t('Urungkan')} className="text-muted hover:text-fg disabled:opacity-30">
            <Undo2 size={17} />
          </button>
          <button type="button" onClick={redo} disabled={!future.length} title={t('Ulangi')} className="text-muted hover:text-fg disabled:opacity-30">
            <Redo2 size={17} />
          </button>
          <span className="h-5 w-px bg-line" />
          <button
            type="button"
            onClick={() => setSavingTemplate(true)}
            title={t('Simpan sebagai template saya')}
            className="flex h-9 items-center gap-2 rounded-[10px] border border-line px-3 text-[13px] font-medium text-muted hover:text-fg"
          >
            <BookmarkPlus size={15} /> {t('Simpan template')}
          </button>
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
          {panel === 'lapisan' && (
            <LayersPanel
              doc={doc}
              selection={selection}
              multi={multi}
              images={images}
              onSelect={select}
              onToggle={(s) => {
                const base = multi.length ? multi : selection && movableIn(doc, selection) ? [selection] : [];
                const list = base.some((m) => sameSel(m, s)) ? base.filter((m) => !sameSel(m, s)) : [...base, s];
                if (list.length === 1) select(list[0]!);
                else pickMany(list);
              }}
              onHover={setLayerHover}
              edit={edit}
            />
          )}
          {panel === 'foto' && (
            <PhotosPanel
              onPick={(p) => putPhoto(p)}
              hint={free ? t('Klik untuk menambah foto, atau seret ke kanvas.') : t('Klik untuk mengisi tempat foto yang dipilih, atau seret ke tempatnya.')}
            />
          )}
          {panel === 'teks' && <TextPanel onAdd={added} />}
          {panel === 'elemen' && <ElementsPanel onAdd={added} />}
          {panel === 'latar' && <BackgroundPanel doc={doc} images={images} edit={edit} />}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col bg-[#08100d]">
          <div ref={stageRef} className="min-h-0 flex-1 overflow-auto">
            {/* Centred while it fits; scrollable from its edges once zoomed past the window. Room above for the quick bar. */}
            <div className="flex min-h-full w-max min-w-full items-center justify-center px-8 pt-16 pb-8 outline-none" data-keyboard-target tabIndex={-1} onPointerDown={(e) => e.target === e.currentTarget && e.button === 0 && (e.currentTarget.focus({ preventScroll: true }), select(null), bandRef.current?.(e))}>
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
                  multi={multi}
                  bandFrom={bandRef}
                  hint={free && !doc.freeCells.length && !doc.texts.length && !doc.stickers.length ? t('Tambah foto dari panel Foto, atau seret ke sini.') : undefined}
                  handlers={{
                    // Picked on the canvas: its row in Lapisan, to see where it sits.
                    onSelect: (s) => (select(s), s && s.kind !== 'watermark' && setPanel('lapisan')),
                    onMulti: (list) => (pickMany(list), list.length > 1 && setPanel('lapisan')),
                    onMove: (moves) => live(placeMany(moves)),
                    onCropCell: (i) => placed(doc)[i] != null && (select({ kind: 'cell', index: i }), setCropping(i)),
                    onEndCrop: () => setCropping(null),
                    onPan: (i, ox, oy) => setSlot(i, { ox, oy }, true),
                    onZoom: (i, zoom) => setSlot(i, { zoom }, true),
                    onPatch: (s, p) => live(s.kind === 'text' ? patchText(s.id, p) : patchSticker(s.id, p)),
                    onEditText: (id) => (setSelection({ kind: 'text', id }), setEditingText(id)),
                    onTextInput: (id, text) => live(patchText(id, { text })),
                    onEndEdit: () => (commit(), setEditingText(null)),
                    onCommit: commit,
                    onFrame: (i, p) => live(patchFrame(i, p)),
                    onDropPhoto: (i, id) => {
                      const p = photoById(id);
                      if (p) (useKreasi.getState().place(i, p), select({ kind: 'cell', index: i }));
                    },
                    onDropNew: (id, x, y) => {
                      const p = photoById(id);
                      if (p) putPhoto(p, { x, y });
                    },
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
          {multi.length > 1 ? (
            <MultiInspector
              count={multi.length}
              onAlign={(to) => edit(alignMany(multi, boundsOf(doc, multi), to))}
              onDuplicate={() => {
                const dup = duplicateMany(multi, doc);
                edit(dup.edit);
                setMulti(dup.selection);
              }}
              onDelete={() => (edit(removeMany(multi)), setMulti([]))}
            />
          ) : selText ? (
            <TextInspector key={selText.id} layer={selText} doc={doc} onChange={(p) => edit(patchText(selText.id, p))} onLive={(p) => live(patchText(selText.id, p))} onCommit={commit} />
          ) : selSticker ? (
            <StickerInspector
              layer={selSticker}
              onChange={(p) => edit(patchSticker(selSticker.id, p))}
              onLive={(p) => live(patchSticker(selSticker.id, p))}
              onCommit={commit}
              onPicture={() => setPicturing(selSticker.id)}
            />
          ) : selection?.kind === 'cell' ? (
            <PhotoInspector
              index={selection.index}
              doc={doc}
              photo={photoOf(selection.index)}
              onChange={(p, l) => setSlot(selection.index, p, l)}
              onCommit={commit}
              onReplace={() => setReplacing(selection.index)}
              onDoc={edit}
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
      {savingTemplate && <SaveTemplateDialog onClose={() => setSavingTemplate(false)} />}
      {replacing != null && (
        <ReplaceDialog
          title={t('Ganti Foto {n}', { n: replacing + 1 })}
          onPick={(p) => useKreasi.getState().place(replacing, p)}
          onClose={() => setReplacing(null)}
          onPickMore={() => (setActive(replacing), setStep('isi'))}
        />
      )}
      {picturing != null && (
        <ReplaceDialog
          title={t('Foto untuk gambar latar')}
          onPick={(p) => edit(patchSticker(picturing, { sticker: photoSticker(p.id) }))}
          onClose={() => setPicturing(null)}
        />
      )}
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
    <button type="button" onClick={onClick} className="flex h-8 min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel-2 text-xs hover:bg-raised">
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
  onDoc,
}: {
  index: number;
  doc: CollageDoc;
  photo: SourcePhoto | null;
  onChange: (p: Partial<NonNullable<CollageDoc['slots'][number]>>, liveOnly?: boolean) => void;
  onCommit: () => void;
  onReplace: () => void;
  /** A change to the whole design (the free layout's frame style). */
  onDoc: (fn: Edit) => void;
}) {
  const slot = doc.slots[index];
  const shape = slotShapes(doc)[index];
  const free = isFreeLayout(doc);
  const cut = slot?.mask ?? (slot?.radius ? 'membulat' : 'kotak');
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
      <Section title={t('Foto##latar')}>
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
          <Slider label={t('Putar')} value={slot.rotate} min={-45} max={45} step={0.5} show={`${fixed(slot.rotate, 1)}°`} onChange={(rotate) => onChange({ rotate }, true)} onDone={onCommit} />
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
          <p className="text-[11px] text-faint">
            {free ? t('Seret bingkai untuk memindah. ⌘T atau dobel klik untuk menggeser foto di dalamnya.') : t('Seret foto di kanvas untuk menggeser. ⌥ + scroll untuk zoom.')}
          </p>
        </Section>
      )}
      {free && slot && (
        <Section title={t('Bentuk##bingkai')}>
          <div className="flex flex-wrap gap-1.5">
            {FRAME_CUTS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => onDoc(cutFrame(index, id))}
                className={cx('h-7 rounded-lg px-2.5 text-xs', cut === id ? 'bg-raised font-semibold text-fg ring-1 ring-gold' : 'bg-panel-2 text-muted hover:text-fg')}
              >
                {t(label)}
              </button>
            ))}
          </div>
        </Section>
      )}
      {free && (
        <Section title={t('Gaya bingkai')}>
          <div className="flex gap-1.5">
            {(
              [
                ['none', 'Tanpa##bingkai'],
                ['border', 'Garis putih##bingkai'],
                ['polaroid', 'Polaroid##bingkai'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => onDoc((d) => ({ ...d, freeFrame: id }))}
                className={cx('h-7 flex-1 rounded-lg text-xs', doc.freeFrame === id ? 'bg-raised font-semibold text-fg ring-1 ring-gold' : 'bg-panel-2 text-muted hover:text-fg')}
              >
                {t(label)}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-faint">{t('Untuk semua foto di desain ini.')}</p>
        </Section>
      )}
    </>
  );
}

/**
 * A free frame's photo cut to `cut`. A circle or heart wants a square frame:
 * the frame becomes one of the same area, around the same middle.
 */
const cutFrame =
  (index: number, cut: PhotoMask | 'kotak' | 'membulat'): Edit =>
  (d) => {
    const slot = d.slots[index];
    const cell = d.freeCells[index];
    if (!slot || !cell) return d;
    const look = cut === 'kotak' ? { mask: undefined, radius: 0 } : cut === 'membulat' ? { mask: undefined, radius: 0.08 } : { mask: cut, radius: undefined };
    let next = cell;
    if (cut === 'lingkaran' || cut === 'hati') {
      // Sides in pixels of one canvas width; equal sides of the same area.
      const r = formatRatio(d) * d.slides;
      const side = Math.sqrt(cell.w * cell.h * r);
      const w = side, h = side / r;
      next = { ...cell, x: cell.x + cell.w / 2 - w / 2, y: cell.y + cell.h / 2 - h / 2, w, h };
    }
    return { ...d, freeCells: d.freeCells.map((c, i) => (i === index ? next : c)), slots: d.slots.map((s, i) => (i === index && s ? { ...s, ...look } : s)) };
  };

/** How a free frame's photo is cut: a plain or rounded box, or a shape. */
const FRAME_CUTS: [PhotoMask | 'kotak' | 'membulat', string][] = [
  ['kotak', 'Kotak##bingkai'],
  ['membulat', 'Membulat##bingkai'],
  ['lingkaran', 'Lingkaran##bingkai'],
  ['lengkung', 'Lengkung##bingkai'],
  ['hati', 'Hati##bingkai'],
];

/** Editor › Simpan template: the design, photos taken out, as one of "Template saya". */
function SaveTemplateDialog({ onClose }: { onClose: () => void }) {
  const { doc, template, name } = useKreasi();
  const [title, setTitle] = useState(name);
  const [category, setCategory] = useState<TemplateCategory>(template?.mine || !template ? 'lainnya' : template.category);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!doc) return null;
  const save = async () => {
    setBusy(true);
    try {
      await saveMyTemplate(title, doc, category);
      setDone(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={t('Simpan sebagai template saya')} className="flex w-[440px] max-w-full flex-col gap-4 rounded-[18px] border border-line bg-panel p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{t('Simpan sebagai template saya')}</h2>
            <p className="text-xs text-muted">{t('Desain ini tanpa fotonya: tempat foto, teks, dan elemen tetap. Muncul di Template saya untuk dipakai lagi.')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>
        {done ? (
          <>
            <p className="flex items-center gap-2 rounded-lg bg-pick/10 px-3 py-2.5 text-[13px]">
              <Check size={15} className="text-pick" /> {t('Tersimpan di Template saya.')}
            </p>
            <button type="button" onClick={onClose} className="h-10 rounded-[10px] border border-line text-[13px] font-medium hover:bg-raised">
              {t('Tutup')}
            </button>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
              {t('Nama template')}
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !busy && save()}
                className="h-9 rounded-lg border border-line bg-bg px-3 text-[13px] text-fg outline-none focus:border-gold"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-medium text-muted">
              {t('Kategori')}
              <select value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory)} className="h-9 rounded-lg border border-line bg-bg px-2.5 text-[13px] text-fg outline-none focus:border-gold">
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {t(c.label)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="h-10 rounded-[10px] px-4 text-[13px] font-medium text-muted hover:text-fg">
                {t('Batal')}
              </button>
              <button type="button" disabled={busy} onClick={save} className="flex h-10 items-center gap-2 rounded-[10px] bg-gold-gradient px-4 text-[13px] font-semibold text-white disabled:opacity-60">
                <BookmarkPlus size={15} /> {t('Simpan template')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Whether `s` can be picked with others: a text, an element, a free frame. */
const movableIn = (d: CollageDoc, s: NonNullable<Selection>) => s.kind === 'text' || s.kind === 'sticker' || (s.kind === 'cell' && isFreeLayout(d));

/** Everything unlocked and shown that can move (⌘A). */
function allMovable(d: CollageDoc): Multi {
  const all: Multi = [
    ...d.texts.map((x) => ({ kind: 'text', id: x.id }) as const),
    ...d.stickers.map((x) => ({ kind: 'sticker', id: x.id }) as const),
    ...(isFreeLayout(d) ? d.freeCells.map((_, index) => ({ kind: 'cell', index }) as const) : []),
  ];
  return all.filter((s) => {
    const key = keyOf(s, d);
    return key && !d.layerMeta[key]?.hidden && !d.layerMeta[key]?.locked;
  });
}

/** Each picked thing's box, as 0–1 of the canvas, for lining them up. */
function boundsOf(d: CollageDoc, list: Multi) {
  const f = frameOf(d, 1000);
  const ctx = document.createElement('canvas').getContext('2d')!;
  const all = itemBounds(d, templateOf(d), f, fontFamilies(), ctx);
  return list.map((s) => {
    const b = all.find((x) => x.key === keyOf(s, d));
    return b ? { l: b.l / f.width, r: b.r / f.width, t: b.t / f.height, b: b.b / f.height } : { l: 0, r: 0, t: 0, b: 0 };
  });
}

/** The right panel with several things picked: line them up, copy or delete them together. */
function MultiInspector({ count, onAlign, onDuplicate, onDelete }: { count: number; onAlign: (to: Align) => void; onDuplicate: () => void; onDelete: () => void }) {
  const aligns: [Align, typeof AlignStartVertical, string][] = [
    ['kiri', AlignStartVertical, 'Rata kiri'],
    ['tengah', AlignCenterVertical, 'Rata tengah'],
    ['kanan', AlignEndVertical, 'Rata kanan'],
    ['atas', AlignStartHorizontal, 'Rata atas'],
    ['tengah-v', AlignCenterHorizontal, 'Rata tengah (tegak)'],
    ['bawah', AlignEndHorizontal, 'Rata bawah'],
  ];
  return (
    <>
      <span className="text-[15px] font-semibold">{t('{count} item dipilih', { count })}</span>
      <Section title={t('Ratakan')}>
        <div className="grid grid-cols-6 gap-1">
          {aligns.map(([id, Icon, label]) => (
            <button
              key={id}
              type="button"
              title={t(label)}
              aria-label={t(label)}
              onClick={() => onAlign(id)}
              className="flex h-8 items-center justify-center rounded-lg border border-line bg-panel-2 text-muted hover:bg-raised hover:text-fg"
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      </Section>
      <Section title={t('Lainnya')}>
        <div className="flex gap-2">
          <Btn onClick={onDuplicate}>
            <Copy size={13} /> {t('Duplikat')}
          </Btn>
          <Btn onClick={onDelete}>
            <Trash2 size={13} /> {t('Hapus')}
          </Btn>
        </div>
        <p className="text-[11px] text-faint">{t('Seret salah satunya untuk memindah semuanya. Shift + klik untuk menambah atau mengurangi.')}</p>
      </Section>
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
        <Slider label={t('Jarak huruf')} value={layer.spacing} min={-0.05} max={0.6} step={0.01} show={fixed(layer.spacing, 2)} onChange={(spacing) => onLive({ spacing })} onDone={onCommit} />
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

function StickerInspector({
  layer,
  onChange,
  onLive,
  onCommit,
  onPicture,
}: {
  layer: StickerLayer;
  onChange: (p: Partial<StickerLayer>) => void;
  onLive: (p: Partial<StickerLayer>) => void;
  onCommit: () => void;
  onPicture: () => void;
}) {
  const doc = useKreasi((s) => s.doc)!;
  const name = elementName(layer);
  const picture = isPicturePlace(layer);
  const empty = isPlaceholder(layer.sticker);
  return (
    <>
      <span className="text-[15px] font-semibold">{name}</span>
      {picture && (
        <Section title={t('Foto##latar')}>
          <p className="text-xs text-muted">
            {empty ? t('Tempat untuk foto latar. Kosong tidak ikut terekspor.') : t('Dipotong pas di tengah kotaknya.')}
          </p>
          <Btn onClick={onPicture}>
            <Replace size={13} /> {empty ? t('Pilih foto##isi') : t('Ganti foto')}
          </Btn>
          {!empty && <Btn onClick={() => onChange({ sticker: EMPTY_PICTURE })}>{t('Kosongkan')}</Btn>}
        </Section>
      )}
      {!layer.gradient && !picture && (
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
function ReplaceDialog({ title, onPick, onClose, onPickMore }: { title: string; onPick: (p: SourcePhoto) => void; onClose: () => void; onPickMore?: () => void }) {
  const source = useKreasi((s) => s.source);
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
          <h2 className="text-lg font-semibold">{title}</h2>
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
            <button key={p.id} type="button" onClick={() => (onPick(p), onClose())} title={p.name} className="aspect-[3/2] overflow-hidden rounded-lg bg-raised hover:ring-2 hover:ring-gold">
              {p.thumb && <img src={thumbUrl(p.thumb)} alt="" loading="lazy" className="size-full object-cover" />}
            </button>
          ))}
          {!photos.length && <p className="col-span-full py-10 text-center text-sm text-faint">{t('Belum ada foto di sumber ini.')}</p>}
        </div>
        <div className="flex items-center justify-between text-xs text-faint">
          <span>{t('Foto Dipilih dan Cek, bintang tertinggi dulu.')}</span>
          {onPickMore && (
            <button type="button" onClick={onPickMore} className="font-medium text-gold-text hover:underline">
              {t('Pilih dari folder lain…')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
