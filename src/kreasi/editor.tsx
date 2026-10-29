import { getCurrentWebview } from '@tauri-apps/api/webview';
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
  ArrowLeftRight,
  Bold,
  Check,
  Crop,
  ChevronDown,
  Copy,
  Download,
  FlipHorizontal,
  History,
  Images,
  Info,
  BookmarkPlus,
  Italic,
  Layers,
  Loader2,
  Minus,
  PaintBucket,
  Paintbrush,
  Pencil,
  Plus,
  Redo2,
  Replace,
  RotateCcw,
  ScanFace,
  Search,
  Shapes,
  Stamp,
  ShieldCheck,
  Trash2,
  Type,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Select } from '../components/select';
import { Switch, cx } from '../components/ui';
import { fixed } from '../lib/format';
import { t, tRust } from '../lib/i18n';
import { useApp } from '../store';
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
  copyOf,
  pasteClip,
  type Align,
  type Clip,
  type Edit,
} from './actions';
import { DocCanvas, sameSel, useBox, useDocImages, type Box, type Multi } from './canvas';
import { ADJUST_PRESETS, NO_ADJUST, PHOTOS_LAYER, behindKeys, stickerLayerKey, emptyPhotoFile, formatRatio, isFreeLayout, stopsOf, withStops, type Gradient, type GradientStopDef, isImageSticker, isLayerLocked, isPlaceholder, layerKeys, newId, patchLayerMeta, photoLayerKey, templateOf, type CutoutMode, type LayerMove, type CollageDoc, type PhotoAdjust, type PhotoMask, type StickerLayer, type TextLayer } from './engine/document';
import { FONT_CATEGORIES, FONTS } from './engine/font-catalog';
import { itemBounds } from './engine/bounds';
import { cutOutImage, cutOutPhoto, imageCutOrder, trimCutout, type ImageCutMethod } from './engine/cutout';
import { cellLayouts, frameOf, type Selection } from './engine/render';
import { assetIdOf, assetImage, isCutout, saveCutout } from './assets';
import { useBrand } from './brand';
import { BrandPanel } from './brand-panel';
import { CutoutRefine } from './cutout-refine';
import { ExportDialog } from './export';
import { CATEGORIES, EMPTY_PICTURE, fontFamilies, formatLabel, isBlankId, isPicturePlace, photoIdOf, photoSticker, saveMyTemplate, slotShapes, type TemplateCategory } from './kit';
import { PhotosPanel } from './photos-panel';
import { addDropped } from './sources';
import { BackgroundPanel, ElementsPanel, HistoryPanel, LayersPanel, TextPanel, elementName } from './panels';
import { facePan, placed, ranked, useKreasi, type SourcePhoto } from './store';
import { discardDesign, saveNow, worthSaving } from './autosave';
import { setStep as setHistoryStep } from './history';
import { MAX_SLIDES, MIN_SLIDES, addSlide, duplicateSlide, removeSlide } from './slides';
import { LeaveDialog, PhotoThumb, SHAPE_LABEL, ShapeIcon, Steps } from './ui';

type Panel = 'lapisan' | 'foto' | 'teks' | 'elemen' | 'latar' | 'brand' | 'riwayat';
const RAIL: { id: Panel; icon: typeof Layers; label: string }[] = [
  { id: 'lapisan', icon: Layers, label: 'Lapisan' },
  { id: 'foto', icon: Images, label: 'Foto##latar' },
  { id: 'teks', icon: Type, label: 'Teks' },
  { id: 'elemen', icon: Shapes, label: 'Elemen' },
  { id: 'latar', icon: PaintBucket, label: 'Latar' },
  { id: 'brand', icon: Stamp, label: 'Brand' },
  { id: 'riwayat', icon: History, label: 'Riwayat' },
];

/** What ⌘C / ⌘X copied, for ⌘V here or in another design; each paste steps a little further. */
let clip: Clip | null = null;
let pastes = 0;

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
  // "Atur foto" (⌘T, double-click): the photo place whose whole picture is out to drag and resize.
  const [cropping, setCropping] = useState<number | null>(null);
  // The layer row under the pointer: outlined on the canvas as if hovered there.
  const [layerHover, setLayerHover] = useState<Selection>(null);
  if (cropping != null && (selection?.kind !== 'cell' || selection.index !== cropping || (doc ? placed(doc)[cropping] == null : true))) setCropping(null);
  // Picking something else closes the change being made to the last one (one undo step).
  const select = (s: Selection) => (commit(), setSelection(s), setEditingText(null), setMulti([]));
  // Several picked at once (a box dragged on the canvas, Shift + click); `selection` is then null.
  const [multi, setMulti] = useState<Multi>([]);
  /**
   * ⌘C / ⌘X / ⌘V on the picked layers (the app's own clipboard). Reached by
   * the keys, and by the Edit menu's Copy / Cut / Paste (as clipboard events)
   * — the same press can arrive both ways, so one within a moment counts once.
   */
  const lastClip = useRef(0);
  const clipboard = (op: 'c' | 'x' | 'v') => {
    if (Date.now() - lastClip.current < 250) return;
    lastClip.current = Date.now();
    const d = useKreasi.getState().doc;
    if (!d) return;
    const root = useKreasi.getState().source?.root ?? null;
    if (op === 'v') {
      if (!clip) return;
      pastes += 1;
      const p = pasteClip(clip, d, root, 0.02 * pastes);
      if (!p.selection.length) return;
      edit(p.edit);
      if (p.selection.length === 1) select(p.selection[0]!);
      else pickMany(p.selection);
      return;
    }
    const picked = multi.length > 1 ? multi : selection && movableIn(d, selection) ? [selection] : [];
    if (!picked.length) return;
    clip = copyOf(picked, d, root);
    pastes = 0;
    if (op === 'x') (edit(removeMany(picked)), select(null));
  };
  useEffect(() => {
    const on = (op: 'c' | 'x' | 'v') => (e: ClipboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && ['text', 'search', 'number', ''].includes(el.type))) return;
      e.preventDefault();
      clipboard(op);
    };
    const copy = on('c'), cut = on('x'), paste = on('v');
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', paste);
    };
  });
  const pickMany = (list: Multi) => (commit(), setMulti(list), list.length > 1 && setSelection(null));
  // A press on the stage around the canvas starts a selection box there too.
  const bandRef = useRef<((e: { clientX: number; clientY: number; shiftKey: boolean }) => void) | null>(null);

  // Edit › Urungkan / Ulangi from the menu bar.
  useEffect(() => {
    const go = (e: Event) => ((e as CustomEvent<'undo' | 'redo'>).detail === 'redo' ? redo() : undo());
    window.addEventListener('pfm:undo', go);
    return () => window.removeEventListener('pfm:undo', go);
  }, [undo, redo]);

  // ⌘E from the menu bar: this design's export, not the session's.
  useEffect(() => {
    const go = () => setExporting(true);
    window.addEventListener('pfm:kreasi-export', go);
    return () => window.removeEventListener('pfm:kreasi-export', go);
  }, []);
  const [safe, setSafe] = useState(false);
  const [stageRef, stage] = useBox<HTMLDivElement>();
  // Space held: a drag anywhere on the stage moves the view (zoomed in), as in Figma and Photoshop.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panFrom = useRef<{ x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
    };
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e)) return;
      e.preventDefault();
      if (!e.repeat) setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceHeld(false);
    const off = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', off);
    };
  }, []);
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
      if (typing || exporting || savingTemplate || replacing != null || picturing != null || refining != null) return;
      const d = useKreasi.getState().doc;
      if (!d) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === '=' || e.key === '+')) return (e.preventDefault(), zoomBy(1.25));
      if (mod && e.key === '-') return (e.preventDefault(), zoomBy(0.8));
      if (mod && e.key === '0') return (e.preventDefault(), setView(1));
      if (cropping != null && (e.key === 'Escape' || e.key === 'Enter')) return (e.preventDefault(), setCropping(null));
      if (e.key === 'Escape') return select(null);
      // ⌘Z / ⇧⌘Z / Ctrl+Y: this design's history (app.tsx leaves them to the editor).
      if (mod && !e.altKey && (e.key.toLowerCase() === 'z' || (e.key.toLowerCase() === 'y' && !e.shiftKey))) {
        e.preventDefault();
        if (e.key.toLowerCase() === 'z' && !e.shiftKey) undo();
        else redo();
        return;
      }
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
      if (mod && !e.shiftKey && ['c', 'x', 'v'].includes(e.key.toLowerCase())) {
        e.preventDefault();
        clipboard(e.key.toLowerCase() as 'c' | 'x' | 'v');
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
  /** `s` to an edge or the middle of its slide (the one its centre is on). */
  const toCanvas =
    (s: NonNullable<Selection>, to: Align): Edit =>
    (d) => {
      const [b] = boundsOf(d, [s]);
      const i = Math.min(d.slides - 1, Math.max(0, Math.floor(((b!.l + b!.r) / 2) * d.slides)));
      return alignMany([s], [b!], to, { l: i / d.slides, r: (i + 1) / d.slides, t: 0, b: 1 })(d);
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

  /**
   * Hapus latar: the subject of photo place `i`, as it shows there, becomes
   * an element in the same spot; the photo itself goes (a free frame is
   * hidden, a template's place emptied) — ⌘Z brings it back.
   */
  const [cutting, setCutting] = useState<number | null>(null);
  /** A note over the canvas after something happened that isn't obvious; can offer "Rapikan". */
  const [notice, setNotice] = useState<{ text: string; refine?: string } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 9000);
    return () => clearTimeout(id);
  }, [notice]);
  /** The cut-out element being touched up with the brush. */
  const [refining, setRefining] = useState<string | null>(null);
  /**
   * Hapus latar, on a photo or on a picture element: every way is tried (the
   * models; for a picture, a plain color round a logo too), the likeliest
   * shown first and the others coming in as they finish, to pick from in the
   * panel. The results, per element, while it shows one of them.
   */
  const [cutSets, setCutSets] = useState<Record<string, CutSet>>({});
  const cuttingElement = Object.entries(cutSets).find(([, c]) => !c.shown)?.[0] ?? null;
  const patchCutSet = (id: string, fn: (c: CutSet) => CutSet) => setCutSets((all) => (all[id] ? { ...all, [id]: fn(all[id]!) } : all));
  /** A way's result, or none when it keeps nothing (or fails). */
  const variantOf = async (make: () => Promise<{ canvas: HTMLCanvasElement; original: HTMLCanvasElement; scale?: number }>): Promise<CutVariant> => {
    try {
      const { canvas, original, scale = 1 } = await make();
      const kept = trimCutout(canvas);
      return kept ? { status: 'ok', canvas, original, kept, scale, preview: thumbOf(kept.canvas), print: printOf(canvas) } : { status: 'none' };
    } catch (e) {
      // Kept to say why, if no way works at all (a model missing, say), rather than "nothing found".
      console.error('hapus latar', e);
      return { status: 'none', error: tRust(e instanceof Error ? e.message : String(e)) };
    }
  };
  /** Nothing kept by any way: the error, if one failed outright, else that nothing was found in it. */
  const noCut = (set: CutSet, nothing: string) => {
    const err = Object.values(set.variants).find((v): v is { status: 'none'; error: string } => v?.status === 'none' && !!v.error);
    useApp.getState().fail(err ? t('Hapus latar gagal: {why}', { why: err.error }) : nothing);
  };
  /** Result `method` as element `id`'s picture: kept once as a file, placed where it sat. */
  const applyCut = async (id: string, set: CutSet, method: ImageCutMethod) => {
    const v = set.variants[method];
    if (v?.status !== 'ok' || !useKreasi.getState().doc?.stickers.some((x) => x.id === id)) return;
    const sticker = set.saved[method] ?? (await saveCutout(v.kept.canvas, v.original, v.canvas));
    edit(patchSticker(id, { sticker, ...set.place(v) }));
    patchCutSet(id, (c) => ({ ...c, shown: method, saved: { ...c.saved, [method]: sticker } }));
  };

  /** Hapus latar on photo place `i`: the subject becomes a new element on top, the photo is hidden. */
  const cutOut = async (i: number) => {
    const slot = doc.slots[i];
    const img = slot && images.get(slot.file.fileId);
    if (!slot || !img || cutting != null) return;
    setCutting(i);
    try {
      const fr = frameOf(doc, 1080 * doc.slides);
      const l = cellLayouts(templateOf(doc), fr, doc.style, doc.slots)[i];
      if (!l) return;
      // The photo uncut, the same size: what the brush brings back.
      const original = (await cutOutPhoto(img, l.photo, slot, null, () => {})).canvas;
      // Its centre, turned with the place around the place's centre.
      const place = (v: OkVariant) => {
        const px = l.photo.x + (v.kept.x + v.kept.w / 2) / v.scale, py = l.photo.y + (v.kept.y + v.kept.h / 2) / v.scale;
        const rx = l.rect.x + l.rect.w / 2, ry = l.rect.y + l.rect.h / 2;
        const c = Math.cos(l.rotate), sn = Math.sin(l.rotate);
        const cx = rx + (px - rx) * c - (py - ry) * sn, cy = ry + (px - rx) * sn + (py - ry) * c;
        return { x: cx / fr.width, y: cy / fr.height, size: v.kept.w / v.scale / fr.unit, rotate: (l.rotate * 180) / Math.PI, ratio: v.kept.h / v.kept.w };
      };
      const order: ImageCutMethod[] = ['potret', 'objek'];
      let set: CutSet = { order, shown: null, saved: {}, place, variants: Object.fromEntries(order.map((m) => [m, { status: 'busy' }])) };
      let id: string | null = null;
      for (const method of order) {
        const v = await variantOf(async () => ({ ...(await cutOutPhoto(img, l.photo, slot, method as CutoutMode, () => {})), original }));
        set = { ...set, variants: { ...set.variants, [method]: v } };
        if (id) {
          patchCutSet(id, (c) => ({ ...c, variants: { ...c.variants, [method]: v } }));
          continue;
        }
        if (v.status !== 'ok') continue;
        // The first result: a new element over the photo, which is hidden.
        const sticker = await saveCutout(v.kept.canvas, v.original, v.canvas);
        const newEl = newId();
        id = newEl;
        edit((d) => {
          // Just above the photo it came from, not on top of everything: texts and elements over the photo stay over it.
          const key = stickerLayerKey(newEl);
          const keys = layerKeys(d);
          const at = isFreeLayout(d) ? keys.indexOf(photoLayerKey(d.freeCells[i]?.id ?? '')) : keys.reduce((a, k, j) => (behindKeys(d).has(k) || k === PHOTOS_LAYER ? j : a), -1);
          const withElement = {
            ...d,
            stickers: [...d.stickers, { id: newEl, sticker, color: '#ffffff', ...place(v) }],
            layerOrder: [...keys.slice(0, at + 1), key, ...keys.slice(at + 1)],
          };
          return isFreeLayout(d)
            ? patchLayerMeta(withElement, photoLayerKey(d.freeCells[i]?.id ?? ''), { hidden: true })
            : { ...withElement, slots: d.slots.map((s, j) => (j === i && s ? { ...s, file: emptyPhotoFile(i + 1) } : s)) };
        });
        set = { ...set, shown: method, saved: { [method]: sticker } };
        setCutSets((all) => ({ ...all, [newEl]: set }));
        select({ kind: 'sticker', id: newEl });
        setNotice({ text: t('Subjeknya jadi elemen baru di atas, fotonya disembunyikan. Kalau belum pas, pilih hasil lain di panel kanan. ⌘Z mengembalikan foto.'), refine: newEl });
        setCutting(null);
      }
      if (!id) noCut(set, t('Tidak ada subjek yang bisa dipisahkan dari foto ini.'));
    } catch (e) {
      useApp.getState().fail(tRust(e instanceof Error ? e.message : String(e)));
    } finally {
      setCutting(null);
    }
  };

  /** Hapus latar on a picture element (an upload): the same element, its picture now the subject alone, where it was. */
  const cutOutElement = async (id: string) => {
    const st = doc.stickers.find((x) => x.id === id);
    const from = st && assetIdOf(st.sticker);
    if (!st || !from || cuttingElement) return;
    try {
      const img = await assetImage(from);
      const order = imageCutOrder(img);
      const base = { x: st.x, y: st.y, size: st.size };
      // Where the kept part sat in the picture, turned and mirrored as the element is now.
      const place = (v: OkVariant) => {
        const now = useKreasi.getState().doc?.stickers.find((x) => x.id === id) ?? st;
        const f = frameOf(doc, 1000 * doc.slides);
        const perPx = (base.size * f.unit) / v.canvas.width;
        const dx = (v.kept.x + v.kept.w / 2 - v.canvas.width / 2) * perPx * (now.flip ? -1 : 1);
        const dy = (v.kept.y + v.kept.h / 2 - v.canvas.height / 2) * perPx;
        const a = (now.rotate * Math.PI) / 180;
        return {
          size: (base.size * v.kept.w) / v.canvas.width,
          x: base.x + (dx * Math.cos(a) - dy * Math.sin(a)) / f.width,
          y: base.y + (dx * Math.sin(a) + dy * Math.cos(a)) / f.height,
          ratio: v.kept.h / v.kept.w,
        };
      };
      let set: CutSet = { order, shown: null, saved: {}, place, variants: Object.fromEntries(order.map((m) => [m, { status: 'busy' }])) };
      setCutSets((all) => ({ ...all, [id]: set }));
      for (const method of order) {
        const v = await variantOf(() => cutOutImage(img, method));
        set = { ...set, variants: { ...set.variants, [method]: v } };
        patchCutSet(id, (c) => ({ ...c, variants: { ...c.variants, [method]: v } }));
        // The first that keeps something goes on the canvas at once.
        if (!set.shown && v.status === 'ok') {
          set = { ...set, shown: method };
          await applyCut(id, set, method);
          setNotice({ text: t('Latarnya dihapus. Kalau belum pas, pilih hasil lain di panel kanan.'), refine: id });
        }
      }
      if (!set.shown) {
        setCutSets(({ [id]: _, ...rest }) => rest);
        noCut(set, t('Tidak ada subjek yang bisa dipisahkan dari gambar ini.'));
      }
    } catch (e) {
      setCutSets(({ [id]: _, ...rest }) => rest);
      useApp.getState().fail(tRust(e instanceof Error ? e.message : String(e)));
    }
  };

  // Photos dragged in from Finder: added to the Foto panel, the first one
  // placed where it was dropped (a template: the selected or first empty place).
  const [fileOver, setFileOver] = useState(false);
  const dropRef = useRef<(paths: string[], x: number, y: number) => void>(() => {});
  dropRef.current = async (paths, x, y) => {
    const src = useKreasi.getState().source;
    if (!src) return;
    try {
      const { source: next, added } = await addDropped(src, paths);
      useKreasi.getState().setSource(next);
      setPanel('foto');
      const first = added[0];
      if (!first) return;
      const box = stageRef.current?.querySelector('canvas')?.getBoundingClientRect();
      const inside = box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
      putPhoto(first, inside && box ? { x: (x - box.left) / box.width, y: (y - box.top) / box.height } : undefined);
    } catch (e) {
      useApp.getState().fail(tRust(e instanceof Error ? e.message : String(e)));
    }
  };
  useEffect(() => {
    const off = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === 'enter' || e.payload.type === 'over') setFileOver(true);
      else if (e.payload.type === 'leave') setFileOver(false);
      else if (e.payload.type === 'drop') {
        setFileOver(false);
        const k = window.devicePixelRatio || 1;
        if (e.payload.paths.length) dropRef.current(e.payload.paths, e.payload.position.x / k, e.payload.position.y / k);
      }
    });
    return () => {
      off.then((f) => f());
    };
  }, []);
  const selText = selection?.kind === 'text' ? doc.texts.find((x) => x.id === selection.id) : undefined;
  const selSticker = selection?.kind === 'sticker' ? doc.stickers.find((x) => x.id === selection.id) : undefined;
  // Back: a design worked on asks whether to keep it (Lanjutkan desain) or throw it away.
  const [leaving, setLeaving] = useState(false);
  const leave = () => (saveNow(), setStep(useKreasi.getState().resumed || free ? 'galeri' : 'isi'));
  // A new carousel slide: a template's gets a photo place, a blank canvas's is blank too.
  const withPhotoPlace = !!template && !isBlankId(template.id);
  // One movable thing picked: to the middle or an edge of the canvas.
  const alignable = !!selection && movableIn(doc, selection) && !isLayerLocked(doc, keyOf(selection, doc) ?? '');
  const alignRow = alignable ? (
    <Section title={t('Ratakan ke kanvas')}>
      <AlignButtons onAlign={(to) => edit(toCanvas(selection!, to))} />
    </Section>
  ) : null;

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
      items.push(btn(<X size={13} />, t('Batal pilih'), () => pickMany([])));
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
        // A free frame moves when dragged: its photo is moved and zoomed here. In a
        // template, dragging the photo already moves it (and Zoom is in the panel).
        if (p && free) items.push(btn(<Crop size={13} />, t('Atur foto'), () => setCropping(i)));
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
          <button type="button" onClick={() => (commit(), worthSaving() ? setLeaving(true) : leave())} title={t('Kembali')} className="text-muted hover:text-fg">
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
          {panel === 'elemen' && <ElementsPanel onAdd={added} edit={edit} />}
          {panel === 'latar' && <BackgroundPanel doc={doc} images={images} edit={edit} />}
          {panel === 'brand' && <BrandPanel doc={doc} edit={edit} onAdd={added} />}
          {panel === 'riwayat' && <HistoryPanel past={past} doc={doc} future={future} onJump={(i) => (select(null), useKreasi.getState().jump(i))} />}
        </aside>

        <div className="relative flex min-w-0 flex-1 flex-col bg-[#08100d]">
          {notice && (
            <div className="absolute top-3 left-1/2 z-30 flex w-max max-w-[min(560px,90%)] -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-panel-2 px-3.5 py-2.5 text-xs text-muted shadow-2xl">
              <Info size={14} className="shrink-0 text-gold-text" />
              <span className="leading-snug">{notice.text}</span>
              {notice.refine && (
                <button type="button" onClick={() => (setRefining(notice.refine!), setNotice(null))} className="shrink-0 font-semibold text-gold-text hover:underline">
                  {t('Rapikan')}
                </button>
              )}
              <button type="button" onClick={() => setNotice(null)} aria-label={t('Tutup')} className="shrink-0 text-faint hover:text-fg">
                <X size={13} />
              </button>
            </div>
          )}
          <div
            ref={stageRef}
            className={cx('relative min-h-0 flex-1 overflow-auto', fileOver && 'ring-2 ring-gold ring-inset', spaceHeld && (panning ? 'cursor-grabbing' : 'cursor-grab'))}
            // Caught before the canvas sees it: with Space held nothing is picked or moved, only the view.
            onPointerDownCapture={(e) => {
              if (!spaceHeld || e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              panFrom.current = { x: e.clientX, y: e.clientY };
              setPanning(true);
            }}
            onPointerMoveCapture={(e) => {
              const from = panFrom.current;
              if (!from) return;
              e.stopPropagation();
              e.currentTarget.scrollLeft -= e.clientX - from.x;
              e.currentTarget.scrollTop -= e.clientY - from.y;
              panFrom.current = { x: e.clientX, y: e.clientY };
            }}
            onPointerUpCapture={(e) => {
              if (!panFrom.current) return;
              e.stopPropagation();
              panFrom.current = null;
              setPanning(false);
            }}
          >
            {fileOver && (
              <span className="pointer-events-none absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full bg-panel-2 px-3 py-1.5 text-xs text-gold-text shadow-xl">
                {t('Lepas untuk menambah foto')}
              </span>
            )}
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
                    // ⌥ + drag: copies where the originals are; the drag then moves the copies.
                    onAddSlide: (after) => (select(null), edit(addSlide(after, withPhotoPlace))),
                    onCloneDrag: (list) => {
                      const dup = duplicateMany(list, doc, 0);
                      edit(dup.edit);
                      if (dup.selection.length === 1) select(dup.selection[0]!);
                      else pickMany(dup.selection);
                      return dup.selection;
                    },
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
            {doc.format === 'carousel' && (
              <>
                <span className="h-3 w-px bg-line" />
                {/* The slides: ⧉ on one copies it right after, × takes it away (⌘Z brings it back), + adds one at the end. */}
                <span className="flex items-center gap-1">
                  {Array.from({ length: doc.slides }, (_, k) => (
                    <span key={k} className="group relative flex h-6 min-w-6 items-center justify-center rounded-md bg-raised px-1.5 font-medium text-fg tabular-nums">
                      {k + 1}
                      {doc.slides < MAX_SLIDES && (
                        <button
                          type="button"
                          onClick={() => (select(null), edit(duplicateSlide(k)), setHistoryStep(useKreasi.getState().doc!, { label: 'Duplikat slide', at: Date.now() }))}
                          title={t('Duplikat slide {n}', { n: k + 1 })}
                          aria-label={t('Duplikat slide {n}', { n: k + 1 })}
                          className="absolute -top-1.5 -left-1.5 hidden size-4 items-center justify-center rounded-full bg-gold text-ink group-hover:flex"
                        >
                          <Copy size={9} strokeWidth={3} />
                        </button>
                      )}
                      {doc.slides > MIN_SLIDES && (
                        <button
                          type="button"
                          onClick={() => {
                            select(null);
                            edit(removeSlide(k));
                            setNotice({ text: t('Slide {n} dihapus. ⌘Z mengembalikannya.', { n: k + 1 }) });
                          }}
                          title={t('Hapus slide {n}', { n: k + 1 })}
                          aria-label={t('Hapus slide {n}', { n: k + 1 })}
                          className="absolute -top-1.5 -right-1.5 hidden size-4 items-center justify-center rounded-full bg-reject text-white group-hover:flex"
                        >
                          <X size={10} strokeWidth={3} />
                        </button>
                      )}
                    </span>
                  ))}
                  <button
                    type="button"
                    disabled={doc.slides >= MAX_SLIDES}
                    onClick={() => edit(addSlide(doc.slides - 1, withPhotoPlace))}
                    title={doc.slides >= MAX_SLIDES ? t('Carousel Instagram paling banyak {n} slide', { n: MAX_SLIDES }) : t('Tambah slide')}
                    className="flex h-6 items-center gap-1 rounded-md px-1.5 hover:bg-raised hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <Plus size={12} /> {t('Slide')}
                  </button>
                </span>
              </>
            )}
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
              onAlignCanvas={(to) => edit(multi.reduce<Edit>((fn, m) => (d) => toCanvas(m, to)(fn(d)), (d) => d))}
              onDuplicate={() => {
                const dup = duplicateMany(multi, doc);
                edit(dup.edit);
                setMulti(dup.selection);
              }}
              onDelete={() => (edit(removeMany(multi)), setMulti([]))}
              onDeselect={() => pickMany([])}
            />
          ) : selText ? (
            <TextInspector key={selText.id} layer={selText} doc={doc} align={alignRow} onChange={(p) => edit(patchText(selText.id, p))} onLive={(p) => live(patchText(selText.id, p))} onCommit={commit} />
          ) : selSticker ? (
            <StickerInspector
              layer={selSticker}
              align={alignRow}
              onChange={(p) => edit(patchSticker(selSticker.id, p))}
              onLive={(p) => live(patchSticker(selSticker.id, p))}
              onCommit={commit}
              onPicture={() => setPicturing(selSticker.id)}
              onRefine={() => setRefining(selSticker.id)}
              onCutOut={() => cutOutElement(selSticker.id)}
              cutSet={cutSets[selSticker.id] && (!cutSets[selSticker.id]!.shown || Object.values(cutSets[selSticker.id]!.saved).includes(selSticker.sticker)) ? cutSets[selSticker.id] : undefined}
              onPickCut={(m) => applyCut(selSticker.id, cutSets[selSticker.id]!, m)}
            />
          ) : selection?.kind === 'cell' ? (
            <PhotoInspector
              index={selection.index}
              align={alignRow}
              doc={doc}
              photo={photoOf(selection.index)}
              onChange={(p, l) => setSlot(selection.index, p, l)}
              onCommit={commit}
              onReplace={() => setReplacing(selection.index)}
              onDoc={edit}
              onCutOut={() => cutOut(selection.index)}
              cutting={cutting === selection.index}
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
      {leaving && <LeaveDialog onSave={() => (setLeaving(false), leave())} onDiscard={() => (setLeaving(false), discardDesign())} onCancel={() => setLeaving(false)} />}
      {refining && doc.stickers.some((x) => x.id === refining) && (
        <CutoutRefine
          layer={doc.stickers.find((x) => x.id === refining)!}
          doc={doc}
          onSave={(patch) => (edit(patchSticker(refining, patch)), setRefining(null))}
          onClose={() => setRefining(null)}
        />
      )}
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

function Btn({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 min-h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel-2 text-xs hover:bg-raised disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Same look either way: presets set every number, sliders one. */
const sameAdjust = (a: PhotoAdjust | undefined, b: PhotoAdjust) => JSON.stringify(a ?? NO_ADJUST) === JSON.stringify(b);

/**
 * Warna foto: a ready look, four sliders, and "Samakan ke semua foto" so a
 * feed or carousel reads as one set.
 */
function PhotoLook({
  adjust,
  title = 'Warna foto',
  onChange,
  onCommit,
  onAll,
}: {
  adjust: PhotoAdjust | undefined;
  title?: string;
  /** `live`: a slider on its way, made one undo step by `onCommit`. */
  onChange: (adjust: PhotoAdjust, live?: boolean) => void;
  onCommit: () => void;
  /** "Samakan ke semua foto", where there are photos to match. */
  onAll?: () => void;
}) {
  const a = adjust ?? NO_ADJUST;
  const set = (patch: Partial<PhotoAdjust>) => onChange({ ...a, ...patch }, true);
  const signed = (v: number) => (v > 0 ? `+${v}` : String(v));
  return (
    <Section title={t(title)}>
      <div className="grid grid-cols-3 gap-1.5">
        {ADJUST_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.adjust)}
            className={cx(
              'h-7 truncate rounded-lg px-1.5 text-[11px]',
              sameAdjust(adjust, p.adjust) ? 'bg-raised font-semibold text-fg ring-1 ring-gold' : 'bg-panel-2 text-muted hover:text-fg',
            )}
          >
            {t(p.name)}
          </button>
        ))}
      </div>
      <Slider label={t('Eksposur')} value={a.brightness} min={-100} max={100} step={1} show={signed(a.brightness)} onChange={(brightness) => set({ brightness })} onDone={onCommit} />
      <Slider label={t('Kontras')} value={a.contrast} min={-100} max={100} step={1} show={signed(a.contrast)} onChange={(contrast) => set({ contrast })} onDone={onCommit} />
      <Slider label={t('Saturasi')} value={a.saturation} min={-100} max={100} step={1} show={signed(a.saturation)} onChange={(saturation) => set({ saturation })} onDone={onCommit} />
      <Slider label={t('Suhu')} value={a.warmth} min={-100} max={100} step={1} show={signed(a.warmth)} onChange={(warmth) => set({ warmth })} onDone={onCommit} />
      {onAll && (
        <Btn onClick={onAll}>
          <Copy size={13} /> {t('Samakan ke semua foto')}
        </Btn>
      )}
    </Section>
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
  onCutOut,
  cutting,
  align,
}: {
  index: number;
  doc: CollageDoc;
  photo: SourcePhoto | null;
  /** "Ratakan ke kanvas": a free layout's frame only. */
  align: React.ReactNode;
  onChange: (p: Partial<NonNullable<CollageDoc['slots'][number]>>, liveOnly?: boolean) => void;
  onCommit: () => void;
  onReplace: () => void;
  /** A change to the whole design (the free layout's frame style). */
  onDoc: (fn: Edit) => void;
  onCutOut: () => void;
  cutting: boolean;
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
      {align}
      <Section title={t('Foto##latar')}>
        {photo ? (
          <div className="flex items-center gap-2.5">
            <PhotoThumb photo={photo} className="h-12 w-[68px] rounded-md object-cover" />
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
      {photo && slot && (
        <Section title={t('Hapus latar')}>
          <Btn onClick={onCutOut} disabled={cutting}>
            <Wand2 size={13} /> {cutting ? t('Memisahkan subjek…') : t('Hapus latar')}
          </Btn>
          <p className="text-[11px] text-faint">{t('Subjeknya jadi elemen di tempat yang sama, latarnya hilang. Kalau belum pas, ada pilihan hasil lain. Diproses di komputer ini.')}</p>
        </Section>
      )}
      {photo && slot && (
        <PhotoLook
          adjust={slot.adjust}
          onChange={(adjust, live) => onChange({ adjust }, live)}
          onCommit={onCommit}
          onAll={() => onDoc((d) => (d.slots.some((s) => s && s !== slot) ? { ...d, slots: d.slots.map((s) => (s ? { ...s, adjust: slot.adjust } : s)) } : d))}
        />
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
            <div className="flex flex-col gap-1.5 text-xs font-medium text-muted">
              {t('Kategori')}
              <Select<TemplateCategory> value={category} onChange={setCategory} options={CATEGORIES.map((c) => ({ value: c.id, label: t(c.label) }))} />
            </div>
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

/** Left, centre, right, top, middle, bottom: six small buttons. */
function AlignButtons({ onAlign }: { onAlign: (to: Align) => void }) {
  const aligns: [Align, typeof AlignStartVertical, string][] = [
    ['kiri', AlignStartVertical, 'Rata kiri'],
    ['tengah', AlignCenterVertical, 'Rata tengah'],
    ['kanan', AlignEndVertical, 'Rata kanan'],
    ['atas', AlignStartHorizontal, 'Rata atas'],
    ['tengah-v', AlignCenterHorizontal, 'Rata tengah (tegak)'],
    ['bawah', AlignEndHorizontal, 'Rata bawah'],
  ];
  return (
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
  );
}

/** The right panel with several things picked: line them up, copy or delete them together. */
function MultiInspector({
  count,
  onAlign,
  onAlignCanvas,
  onDuplicate,
  onDelete,
  onDeselect,
}: {
  count: number;
  onAlign: (to: Align) => void;
  /** Each one on its own to the canvas (its slide), not to the others. */
  onAlignCanvas: (to: Align) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onDeselect: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold">{t('{count} item dipilih', { count })}</span>
        <button type="button" onClick={onDeselect} title="Esc" className="flex items-center gap-1 text-xs text-faint hover:text-fg">
          <X size={13} /> {t('Batal pilih')}
        </button>
      </div>
      <Section title={t('Ratakan')}>
        <AlignButtons onAlign={onAlign} />
      </Section>
      <Section title={t('Ratakan ke kanvas')}>
        <AlignButtons onAlign={onAlignCanvas} />
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
  // The studio's own colours first (Pengaturan › Brand studio).
  const brandColors = useBrand((b) => b.colors);
  const colors = useMemo(() => {
    const own = brandColors.map((c) => c.toLowerCase());
    return [...own, ...palette(doc).filter((c) => !own.includes(c.toLowerCase()))];
  }, [doc, brandColors]);
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

function TextInspector({
  layer,
  doc,
  align,
  onChange,
  onLive,
  onCommit,
}: {
  layer: TextLayer;
  doc: CollageDoc;
  /** "Ratakan ke kanvas", when it can move. */
  align: React.ReactNode;
  onChange: (p: Partial<TextLayer>) => void;
  onLive: (p: Partial<TextLayer>) => void;
  onCommit: () => void;
}) {
  return (
    <>
      <span className="text-[15px] font-semibold">{t('Teks')}</span>
      {align}
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

const GRADIENT_TYPES: { id: Gradient['type']; label: string }[] = [
  { id: 'linear', label: 'Lurus' },
  { id: 'radial', label: 'Melingkar' },
  { id: 'reflected', label: 'Cermin' },
  { id: 'conic', label: 'Putar##gradasi' },
];

/** `#rrggbb` at `alpha`, for CSS. */
const rgba = (hex: string, alpha: number) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/**
 * A gradient's colors: the fade drawn as a bar with a dot per color. A dot
 * picked gets its color, how solid it is and where it sits; colors can be
 * added, removed and the whole fade turned round. Then its kind and direction.
 */
function GradientSection({
  doc,
  gradient,
  onChange,
  onLive,
  onCommit,
}: {
  doc: CollageDoc;
  gradient: Gradient;
  onChange: (g: Gradient) => void;
  onLive: (g: Gradient) => void;
  onCommit: () => void;
}) {
  const stops = stopsOf(gradient);
  const [picked, setPicked] = useState(0);
  const at = Math.min(picked, stops.length - 1);
  const stop = stops[at]!;
  const withStop = (patch: Partial<GradientStopDef>) => withStops(gradient, stops.map((x, i) => (i === at ? { ...x, ...patch } : x)));
  const bar = `linear-gradient(90deg, ${stops.map((x) => `${rgba(x.color, x.alpha)} ${Math.round(x.at * 100)}%`).join(', ')})`;
  /** A new color at `pos` (0–1), the fade's own color there, picked. */
  const addAt = (pos: number) => {
    const after = stops.findIndex((x) => x.at > pos);
    const near = stops[after < 0 ? stops.length - 1 : Math.max(0, after - 1)]!;
    const g = withStops(gradient, [...stops, { ...near, at: pos }]);
    onChange(g);
    setPicked(stopsOf(g).findIndex((x) => x.at === pos && x.color === near.color));
  };
  // A dot dragged along the bar moves its color; a click on the bar adds one there.
  const track = useRef<HTMLDivElement>(null);
  // The colors as they were when the drag began, and which one moves: passing another must not swap them.
  const dragging = useRef<{ i: number; from: GradientStopDef[] } | null>(null);
  const posOf = (e: React.PointerEvent) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const iconBtn = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-raised hover:text-fg disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {icon}
    </button>
  );
  const angled = gradient.type !== 'radial';
  return (
    <Section title={t('Gradasi')}>
      {/* Inset so the dots at either end sit whole inside the panel. */}
      <div className="px-2">
        <div
          ref={track}
          onPointerDown={(e) => e.target === e.currentTarget && addAt(Math.round(posOf(e) * 100) / 100)}
          title={t('Klik untuk menambah warna, seret titik untuk menggeser')}
          className="relative h-7 cursor-copy rounded-md bg-[repeating-conic-gradient(#2a3a33_0_25%,#1a2622_0_50%)] bg-[length:10px_10px] ring-1 ring-line"
        >
          <div className="pointer-events-none absolute inset-0 rounded-md" style={{ background: bar }} />
          {stops.map((x, i) => (
            <button
              key={i}
              type="button"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                setPicked(i);
                dragging.current = { i, from: stops };
              }}
              onPointerMove={(e) => {
                const d = dragging.current;
                if (!d) return;
                const moved = { ...d.from[d.i]!, at: Math.round(posOf(e) * 100) / 100 };
                const g = withStops(gradient, d.from.map((y, j) => (j === d.i ? moved : y)));
                onLive(g);
                setPicked(stopsOf(g).findIndex((y) => y.at === moved.at && y.color === moved.color));
              }}
              onPointerUp={() => {
                if (dragging.current == null) return;
                dragging.current = null;
                onCommit();
              }}
              aria-label={t('Warna {n}', { n: i + 1 })}
              className={cx(
                'absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 shadow',
                i === at ? 'border-fg ring-2 ring-gold' : 'border-white/80',
              )}
              style={{ left: `${x.at * 100}%`, background: x.color }}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{t('Warna {n}', { n: at + 1 })}</span>
        <span className="flex gap-0.5">
          {iconBtn(t('Tambah warna'), <Plus size={14} />, () => {
            // Half-way to the next color (or the one before, from the last).
            const other = stops[at < stops.length - 1 ? at + 1 : at - 1]!;
            addAt(Math.round(((stop.at + other.at) / 2) * 100) / 100);
          })}
          {iconBtn(
            stops.length <= 2 ? t('Gradasi butuh paling sedikit 2 warna') : t('Hapus warna'),
            <Trash2 size={14} />,
            () => (onChange(withStops(gradient, stops.filter((_, i) => i !== at))), setPicked(Math.max(0, at - 1))),
            stops.length <= 2,
          )}
          {iconBtn(t('Balik urutan warna'), <ArrowLeftRight size={14} />, () => (
            onChange(withStops(gradient, stops.map((x) => ({ ...x, at: 1 - x.at })))), setPicked(stops.length - 1 - at)
          ))}
        </span>
      </div>
      <Swatches doc={doc} value={stop.color} onPick={(color) => onChange(withStop({ color }))} />
      <Slider label={t('Kepekatan')} value={stop.alpha} min={0} max={1} step={0.01} show={`${Math.round(stop.alpha * 100)}%`} onChange={(alpha) => onLive(withStop({ alpha }))} onDone={onCommit} />
      <Slider label={t('Posisi')} value={stop.at} min={0} max={1} step={0.01} show={`${Math.round(stop.at * 100)}%`} onChange={(v) => onLive(withStop({ at: v }))} onDone={onCommit} />
      <div className="grid grid-cols-4 gap-1">
        {GRADIENT_TYPES.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => onChange({ ...gradient, type: x.id })}
            className={cx('h-8 rounded-lg text-[11px] font-medium', gradient.type === x.id ? 'bg-raised text-fg ring-1 ring-gold' : 'bg-panel-2 text-muted hover:text-fg')}
          >
            {t(x.label)}
          </button>
        ))}
      </div>
      {angled && (
        <Slider
          label={t('Arah')}
          value={gradient.angle}
          min={0}
          max={360}
          step={1}
          show={`${Math.round(gradient.angle)}°`}
          // A line drawn on the canvas would win over the angle: the slider takes over.
          onChange={(angle) => onLive({ ...gradient, angle, line: undefined })}
          onDone={onCommit}
        />
      )}
    </Section>
  );
}

type OkVariant = {
  status: 'ok';
  canvas: HTMLCanvasElement;
  original: HTMLCanvasElement;
  kept: { canvas: HTMLCanvasElement; x: number; y: number; w: number; h: number };
  /** Pixels of `canvas` per canvas pixel at 1080 a slide (a photo's cut-out); 1 for a picture element. */
  scale: number;
  preview: string;
  /** What it keeps, coarsely: two results alike are offered once. */
  print: Uint8Array;
};
type CutVariant = { status: 'busy' } | { status: 'none'; error?: string } | OkVariant;

/** One element's Hapus latar: every way's result, the one shown, and where a result sits on the canvas. */
type CutSet = {
  place: (v: OkVariant) => Partial<StickerLayer>;
  order: ImageCutMethod[];
  shown: ImageCutMethod | null;
  variants: Partial<Record<ImageCutMethod, CutVariant>>;
  /** The results already kept as element pictures, so switching back costs nothing. */
  saved: Partial<Record<ImageCutMethod, string>>;
};

/** A result's see-through-ness on a 32 × 32 grid, uncut size: to tell results apart. */
function printOf(c: HTMLCanvasElement) {
  const g = document.createElement('canvas');
  g.width = g.height = 32;
  const ctx = g.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, 32, 32);
  const d = ctx.getImageData(0, 0, 32, 32).data;
  return Uint8Array.from({ length: 1024 }, (_, i) => d[i * 4 + 3]!);
}

/** Two results that keep the same thing, near enough (under 2% apart). */
const alike = (a: Uint8Array, b: Uint8Array) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]!), 0) / (255 * a.length) < 0.02;

/** A small picture of a result, for the choices. */
function thumbOf(c: HTMLCanvasElement) {
  const k = Math.min(1, 160 / Math.max(c.width, c.height));
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(c.width * k));
  t.height = Math.max(1, Math.round(c.height * k));
  t.getContext('2d')!.drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL('image/png');
}

/**
 * The results worth offering: finished ones only (one still being made never
 * shows, so nothing appears and then vanishes), and none that came out like
 * an earlier one (the one on the canvas always stays).
 */
function shownOrder(set: CutSet): ImageCutMethod[] {
  const out: ImageCutMethod[] = [];
  for (const m of set.order) {
    const v = set.variants[m];
    if (v?.status !== 'ok') continue;
    const twin = m !== set.shown && out.some((o) => {
      const w = set.variants[o];
      return w?.status === 'ok' && alike(w.print, v.print);
    });
    if (!twin) out.push(m);
  }
  return out;
}

/** Every way's result side by side: the one on the canvas marked, a click puts another there. */
function CutChoices({ set, onPick }: { set: CutSet; onPick: (m: ImageCutMethod) => void }) {
  const ways = shownOrder(set);
  // Every way came out the same: nothing to choose, so no choice is offered.
  if (ways.length < 2) return null;
  return (
    <Section title={t('Hapus latar')}>
      <span className="text-xs text-muted">{t('Pilih hasil yang paling pas:')}</span>
      <div className="grid grid-cols-2 gap-2">
        {/* Numbered, not named by how they were made: the photographer judges the picture, not the method. */}
        {ways.map((m, i) => {
          const v = set.variants[m];
          const on = set.shown === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onPick(m)}
              className={cx('flex flex-col gap-1.5 rounded-lg p-1.5 text-left', on ? 'bg-gold/[0.08] ring-2 ring-gold' : 'ring-1 ring-line-soft hover:ring-gold/70')}
            >
              <span className="flex aspect-[4/3] items-center justify-center rounded-md bg-[repeating-conic-gradient(#2a3a33_0_25%,#1a2622_0_50%)] bg-[length:10px_10px] p-1.5">
                {v?.status === 'ok' && <img src={v.preview} alt="" className="max-h-full max-w-full object-contain" />}
              </span>
              <span className={cx('text-[11px]', on ? 'font-semibold text-fg' : 'text-muted')}>{t('Hasil {n}', { n: i + 1 })}</span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function StickerInspector({
  layer,
  align,
  onChange,
  onLive,
  onCommit,
  onPicture,
  onRefine,
  onCutOut,
  cutSet,
  onPickCut,
}: {
  layer: StickerLayer;
  align: React.ReactNode;
  /** A picture element: Hapus latar on it. */
  onCutOut: () => void;
  /** Its Hapus latar results this session (one shown, the others to pick), while it shows one of them. */
  cutSet?: CutSet;
  onPickCut: (m: ImageCutMethod) => void;
  onChange: (p: Partial<StickerLayer>) => void;
  onLive: (p: Partial<StickerLayer>) => void;
  onCommit: () => void;
  onPicture: () => void;
  /** A Hapus latar cut-out: touch it up with the brush. */
  onRefine: () => void;
}) {
  const doc = useKreasi((s) => s.doc)!;
  const cut = isCutout(layer.sticker);
  const name = cut ? t('Potongan foto') : elementName(layer);
  const picture = isPicturePlace(layer);
  const empty = isPlaceholder(layer.sticker);
  // A picture of its own (an upload or a cut-out), not a built-in sticker or a background place.
  const image = isImageSticker(layer.sticker) && !picture && assetIdOf(layer.sticker) != null;
  const shadow = layer.shadow;
  const line = layer.imageOutline;
  return (
    <>
      <span className="text-[15px] font-semibold">{name}</span>
      {align}
      {image && !cut && (!cutSet || !cutSet.shown) && (
        <Section title={t('Hapus latar')}>
          <Btn onClick={onCutOut} disabled={!!cutSet}>
            {cutSet ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />} {cutSet ? t('Memisahkan subjek…') : t('Hapus latar')}
          </Btn>
          <p className="text-[11px] text-faint">{t('Logo, benda, atau orang: caranya dipilih sendiri dari gambarnya. Diproses di komputer ini.')}</p>
        </Section>
      )}
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
      {cutSet && <CutChoices set={cutSet} onPick={onPickCut} />}
      {cut && (
        <Section title={cutSet && shownOrder(cutSet).length > 1 ? t('Rapikan') : t('Hapus latar')}>
          <p className="text-xs text-muted">{t('Hapus sisa latar atau kembalikan bagian yang hilang dengan kuas.')}</p>
          <Btn onClick={onRefine}>
            <Paintbrush size={13} /> {t('Rapikan potongan')}
          </Btn>
        </Section>
      )}
      {layer.gradient && (
        <GradientSection
          doc={doc}
          gradient={layer.gradient}
          onChange={(gradient) => onChange({ gradient })}
          onLive={(gradient) => onLive({ gradient })}
          onCommit={onCommit}
        />
      )}
      {!layer.gradient && !picture && !isImageSticker(layer.sticker) && (
        <Section title={t('Warna')}>
          <Swatches doc={doc} value={layer.color} onPick={(color) => onChange({ color })} />
        </Section>
      )}
      {image && <PhotoLook adjust={layer.adjust} title="Warna gambar" onChange={(adjust, live) => (live ? onLive({ adjust }) : onChange({ adjust }))} onCommit={onCommit} />}
      {image && (
        <Section title={t('Garis tepi')}>
          <label className="flex items-center justify-between text-xs text-muted">
            {t('Garis mengikuti bentuknya')}
            <Switch label={t('Garis tepi')} checked={!!line} onChange={(on) => onChange({ imageOutline: on ? { width: 0.008, color: '#ffffff' } : undefined })} />
          </label>
          {line && (
            <>
              <Slider label={t('Tebal')} value={line.width} min={0.002} max={0.03} step={0.001} show={`${Math.round(line.width * 1000) / 10}%`} onChange={(width) => onLive({ imageOutline: { ...line, width } })} onDone={onCommit} />
              <Swatches doc={doc} value={line.color} onPick={(color) => onChange({ imageOutline: { ...line, color } })} />
            </>
          )}
        </Section>
      )}
      {image && (
        <Section title={t('Bayangan')}>
          <label className="flex items-center justify-between text-xs text-muted">
            {t('Bayangan lembut di bawahnya')}
            <Switch label={t('Bayangan')} checked={!!shadow} onChange={(on) => onChange({ shadow: on ? { color: '#000000', alpha: 0.4, blur: 0.03, x: 0, y: 0.012 } : undefined })} />
          </label>
          {shadow && (
            <>
              <Slider label={t('Kepekatan')} value={shadow.alpha} min={0.05} max={1} step={0.01} show={`${Math.round(shadow.alpha * 100)}%`} onChange={(alpha) => onLive({ shadow: { ...shadow, alpha } })} onDone={onCommit} />
              <Slider label={t('Kelembutan')} value={shadow.blur} min={0} max={0.1} step={0.002} show={`${Math.round(shadow.blur * 1000) / 10}`} onChange={(blur) => onLive({ shadow: { ...shadow, blur } })} onDone={onCommit} />
              <Slider label={t('Jarak')} value={shadow.y} min={0} max={0.06} step={0.001} show={`${Math.round(shadow.y * 1000) / 10}`} onChange={(y) => onLive({ shadow: { ...shadow, y } })} onDone={onCommit} />
            </>
          )}
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
  const brandFont = useBrand((b) => b.font);
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
            {brandFont && FONTS[brandFont] && (!query || FONTS[brandFont].label.toLowerCase().includes(query)) && (
              <div className="flex flex-col">
                <span className="px-2 pt-2 pb-1 text-[10px] font-semibold text-gold-text uppercase">{t('Huruf brand')}</span>
                <button
                  type="button"
                  onClick={() => (onChange(brandFont), setOpen(false))}
                  className={cx('flex h-9 shrink-0 items-center justify-between rounded-lg px-2 text-left text-[17px] hover:bg-raised', brandFont === value && 'bg-raised')}
                  style={{ fontFamily: fam[brandFont] }}
                >
                  <span className="truncate">{FONTS[brandFont].label}</span>
                  {brandFont === value && <Check size={14} className="shrink-0 text-gold-text" />}
                </button>
              </div>
            )}
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
              <PhotoThumb photo={p} loading="lazy" className="size-full object-cover" />
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
