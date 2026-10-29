/**
 * Edit foto: the session's Pilih photos developed like Lightroom — presets
 * on the left, the photo in the middle (as it is, or before | after), the
 * panels on the right, the photos along the bottom. Settings are kept per
 * photo in the session (`set_edits`); the files themselves never change.
 */

import {
  ArrowLeft,
  Camera,
  ClipboardPaste,
  Copy,
  Crop,
  SlidersHorizontal,
  Download,
  Eraser,
  FileUp,
  Image as ImageIcon,
  Columns2,
  Redo2,
  RefreshCw,
  Save,
  Search,
  MoreHorizontal,
  Undo2,
  CircleDashed,
  ChevronDown,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { TitleBar } from '../components/title-bar';
import { Button, cx } from '../components/ui';
import { CopyDialog, DEFAULT_CHOICE, applyChoice, type CopyChoice } from '../edit/copy-dialog';
import { DenoiseBlock } from '../edit/denoise-block';
import { EditExportDialog } from '../edit/export';
import { matchCameras } from '../edit/match-cameras';
import { ImportPresetsDialog } from '../edit/import-presets';
import { PopMenu, SavePresetDialog, type MenuItem } from '../edit/preset-menu';
import { EditedThumb } from '../edit/look-thumb';
import { BUILT_IN, applyLook, isEdited, useMyLooks, type Look } from '../edit/looks';
import {
  BASIC_RESET,
  BasicPanel,
  CurvePanel,
  DETAIL_RESET,
  DetailPanel,
  EFFECTS_RESET,
  EffectsPanel,
  GradePanel,
  MixerPanel,
  Section,
} from '../edit/panels';
import { EditView, HistogramView, type Histogram, type ViewMode, type Viewport } from '../edit/view';
import { api, thumbUrl, type PhotoEntry } from '../lib/api';
import { num } from '../lib/format';
import { t } from '../lib/i18n';
import { previewUrl } from '../kreasi/canvas';
import { NO_ADJUST, maskActive, type EditMask, type PhotoAdjust } from '../kreasi/engine/document';
import { CropPanel, autoAngle, autoUpright, cropFor, ratioValue } from '../edit/crop-panel';
import { HealLayer, HealPanel } from '../edit/heal';
import { LensBlurPanel } from '../edit/lens-blur-panel';
import { LensPanel } from '../edit/lens-panel';
import { Library } from '../edit/library';
import { ToolBox, ToolRow } from '../edit/tool-box';
import { MaskLayer, MaskList, MaskPanel, loadSubjects, useMasking, type BrushSettings, type MaskCreate } from '../edit/masking';
import { NO_GEOMETRY, frameSize, hasGeometry, type EditSettings, type Geometry } from '../edit/geometry';
import { autoAdjust, neutralBalance } from '../kreasi/engine/develop';
import { loadLocalImage } from '../kreasi/kit';
import { useApp, type Screen } from '../store';

const HISTORY = 60;
type Panel = 'basic' | 'curve' | 'mixer' | 'grade' | 'detail' | 'effects' | 'lens' | 'lensblur';

export function EditPhotos({ back, ids, start }: { back: Screen; ids?: number[]; start?: number }) {
  const session = useApp((s) => s.session);
  // From Review: straight to the editor on the session's Pilih photos.
  // Otherwise the Library first, to choose what to edit.
  if (session && (ids || back.name === 'review')) return <Editor back={back} ids={ids} start={start} />;
  return <Library back={back} />;
}

function Editor({ back, ids, start }: { back: Screen; ids?: number[]; start?: number }) {
  const go = useApp((s) => s.go);
  const session = useApp((s) => s.session)!;
  const root = session.root;

  // The Pilih photos; everything not skipped while nothing is Pilih yet.
  // The photos chosen in the Library; from Review, the Pilih ones (all
  // not skipped while nothing is Pilih yet).
  const photos = useMemo(() => {
    if (ids) {
      const want = new Set(ids);
      return session.photos.filter((p) => want.has(p.id));
    }
    const picks = session.photos.filter((p) => p.status === 'pick');
    return picks.length ? picks : session.photos.filter((p) => p.status !== 'reject');
  }, [session.photos, ids]);
  const [edits, setEdits] = useState<Record<number, EditSettings>>(() =>
    Object.fromEntries(Object.entries(session.edits ?? {}).map(([k, v]) => [Number(k), v as EditSettings])),
  );
  const [at, setAt] = useState(() =>
    Math.max(0, start != null ? photos.findIndex((p) => p.id === start) : photos.findIndex((p) => isEdited((session.edits ?? {})[p.id] as PhotoAdjust))),
  );
  const photo = photos[at] ?? photos[0];
  const a: EditSettings = (photo && edits[photo.id]) || NO_ADJUST;

  // Undo per photo: the settings before each change.
  const past = useRef(new Map<number, EditSettings[]>());
  const future = useRef(new Map<number, EditSettings[]>());
  const before = useRef<EditSettings | null>(null);
  const [, bump] = useState(0);

  // Saved shortly after the last change, into the session file.
  const pending = useRef(new Map<number, EditSettings | null>());
  const timer = useRef<number | null>(null);
  const save = (id: number, next: EditSettings) => {
    pending.current.set(id, isEdited(next) ? next : null);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 400);
  };
  const flush = () => {
    timer.current = null;
    const list = [...pending.current.entries()];
    pending.current.clear();
    if (!list.length) return;
    api.setEdits(list).catch(useApp.getState().fail);
    useApp.setState(({ session: s }) => {
      if (!s) return {};
      const all = { ...s.edits };
      for (const [id, v] of list) {
        if (v) all[id] = v;
        else delete all[id];
      }
      return { session: { ...s, edits: all } };
    });
  };
  useEffect(() => () => flush(), []);

  // The newest settings, read and written at once (state follows for drawing):
  // a reset is a change and its end in one go.
  const latest = useRef(edits);
  const put = (id: number, next: EditSettings) => {
    latest.current = { ...latest.current, [id]: next };
    setEdits(latest.current);
  };
  const remember = (id: number, old: EditSettings) => {
    past.current.set(id, [...(past.current.get(id) ?? []), old].slice(-HISTORY));
    future.current.set(id, []);
  };

  const [moving, setMoving] = useState(false);
  /** A change while a control moves: shown at once, one undo step when let go. */
  const live = (patch: Partial<EditSettings>) => {
    if (!photo) return;
    const cur = latest.current[photo.id] ?? NO_ADJUST;
    if (!before.current) before.current = cur;
    setMoving(true);
    put(photo.id, { ...cur, ...patch });
  };
  const done = () => {
    setMoving(false);
    const prev = before.current;
    before.current = null;
    if (!photo || !prev) return;
    const now = latest.current[photo.id] ?? NO_ADJUST;
    if (prev === now) return;
    remember(photo.id, prev);
    save(photo.id, now);
    bump((n) => n + 1);
  };
  /** A whole new set of settings for some photos, one undo step each. */
  const replace = (ids: number[], fn: (old: EditSettings, id: number) => EditSettings) => {
    for (const id of ids) {
      const old = latest.current[id] ?? NO_ADJUST;
      const now = fn(old, id);
      remember(id, old);
      put(id, now);
      save(id, now);
    }
    bump((n) => n + 1);
  };
  const step = (from: Map<number, EditSettings[]>, to: Map<number, EditSettings[]>, takeLast: boolean) => {
    if (!photo) return;
    const list = from.get(photo.id) ?? [];
    const next = takeLast ? list.pop() : list.shift();
    if (!next) return;
    const cur = latest.current[photo.id] ?? NO_ADJUST;
    to.set(photo.id, takeLast ? [cur, ...(to.get(photo.id) ?? [])] : [...(to.get(photo.id) ?? []), cur]);
    put(photo.id, next);
    save(photo.id, next);
    bump((n) => n + 1);
  };
  const undo = () => step(past.current, future.current, true);
  const redo = () => step(future.current, past.current, false);

  // Photos ticked in the strip (⌘/Shift-click) for Sync and export.
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const others = [...ticked].filter((id) => id !== photo?.id);
  // Copy and Sync ask which groups go across; Paste uses what was copied.
  const [copied, setCopied] = useState<{ a: EditSettings; choice: CopyChoice } | null>(null);
  const [choice, setChoice] = useState<CopyChoice>(DEFAULT_CHOICE);
  const [asking, setAsking] = useState<'copy' | 'sync' | null>(null);
  const copy = () => setAsking('copy');
  const paste = () => copied && photo && replace(ticked.size > 1 ? [...ticked] : [photo.id], (old) => applyChoice(copied.a, old, copied.choice));
  const sync = () => others.length && setAsking('sync');
  const confirmCopy = (c: CopyChoice) => {
    setChoice(c);
    if (asking === 'copy') setCopied({ a, choice: c });
    else replace(others, (old) => applyChoice(a, old, c));
    setAsking(null);
  };

  const [mode, setMode] = useState<ViewMode>('after');
  const [picking, setPicking] = useState(false);
  const [hist, setHist] = useState<Histogram | null>(null);
  const [exporting, setExporting] = useState(false);
  /** The preset pointed at in the list: tried on the photo, not kept. */
  const [trying, setTrying] = useState<Look | null>(null);
  // The same object while nothing changes: the picture redraws only when it must.
  const current = photo ? edits[photo.id] : undefined;
  const shown = useMemo(() => (trying ? applyLook(trying.adjust, current) : current), [trying, current]);

  // Samakan warna antar kamera: the open photo's camera is the reference.
  const cameras = useMemo(() => new Set(photos.map((p) => p.camera).filter(Boolean)).size, [photos]);
  const [matching, setMatching] = useState(false);
  const matchColors = async () => {
    if (!photo?.camera) return;
    setMatching(true);
    try {
      const shift = await matchCameras(photos, photo.camera);
      const ids = photos.filter((p) => p.camera && shift.has(p.camera)).map((p) => p.id);
      const clamp = (v: number) => Math.max(-100, Math.min(100, v));
      if (ids.length)
        replace(ids, (old, id) => {
          const d = shift.get(photos.find((p) => p.id === id)?.camera ?? '') ?? { warmth: 0, tint: 0 };
          return { ...old, warmth: clamp((old.warmth ?? 0) + d.warmth), tint: clamp((old.tint ?? 0) + d.tint) };
        });
    } finally {
      setMatching(false);
    }
  };

  /** Bumped by Z: the picture zooms to 1:1 or back to fit. */
  const [zoom, setZoom] = useState(0);
  // The zoomed view's part of the photo, for the Navigator's box; and moving it.
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const panRef = useRef<((x: number, y: number) => void) | null>(null);

  // Crop & luruskan.
  const [cropping, setCropping] = useState(false);
  const [ratioId, setRatioId] = useState('asli');
  const [portrait, setPortrait] = useState(false);
  const [leveling, setLeveling] = useState(false);
  const [applyAll, setApplyAll] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const g: Geometry = a.geometry ?? NO_GEOMETRY;
  const frame = size ? frameSize(size.w, size.h, g) : { w: 3, h: 2 };
  const setGeometry = (next: Geometry) => live({ geometry: next });
  // Masking.
  const [masking, setMasking] = useState(false);
  const [selMask, setSelMask] = useState<string | null>(null);
  const [selPart, setSelPart] = useState<string | null>(null);
  const [overlay, setOverlay] = useState(true);
  const [hoverMask, setHoverMask] = useState<EditMask | null>(null);
  // As Lightroom: the overlay steps aside while the chosen mask's effect
  // changes (a slider moving), so the edit itself shows, and comes back once
  // it rests — or at once when a mask is made, chosen or reshaped.
  const [overlayRest, setOverlayRest] = useState(false);
  const chosenMask = a.masks?.find((m) => m.id === selMask);
  const firstEffect = useRef(true);
  useEffect(() => {
    if (firstEffect.current) return void (firstEffect.current = false);
    setOverlayRest(true);
    // Back once the slider has rested a moment.
    const back = window.setTimeout(() => setOverlayRest(false), 500);
    return () => window.clearTimeout(back);
  }, [chosenMask?.adjust]);
  useEffect(() => setOverlayRest(false), [selMask, selPart, chosenMask?.parts, a.masks?.length, masking]);
  /** Making a mask, or a part of the chosen one; null: the chosen mask's sliders. */
  const [maskCreate, setMaskCreate] = useState<MaskCreate | null>(null);
  const maskTools = useMasking({
    root,
    // Only while masking: finding people reads the photo's faces.
    photoId: masking && photo ? photo.id : -1,
    a,
    sel: selMask,
    creating: maskCreate,
    onSelect: (m, p) => (setSelMask(m), setSelPart(p)),
    onCreating: setMaskCreate,
    onLive: live,
    onDone: done,
  });
  const [brush, setBrush] = useState<BrushSettings>({ size: 0.08, feather: 50, erase: false });
  // Hapus objek.
  const [healing, setHealing] = useState(false);
  const [healSize, setHealSize] = useState(0.04);
  const openHealing = () => {
    setPicking(false);
    if (cropping) closeCrop();
    setMasking(false);
    setHealing(true);
  };
  const openMasking = () => {
    setPicking(false);
    if (cropping) closeCrop();
    setHealing(false);
    setMasking(true);
    const last = a.masks?.[a.masks.length - 1];
    setSelMask(last?.id ?? null);
    setSelPart(null);
    setMaskCreate(last ? null : 'new');
  };
  const adjustOnly = ({ geometry: _g, heal: _h, masks: _m, ...rest }: EditSettings): PhotoAdjust => rest;
  /** Back to the sliders: whatever tool is open closes (Lightroom's Edit button). */
  const closeTools = () => {
    if (cropping) closeCrop();
    setHealing(false);
    setMasking(false);
  };
  // Subjects found earlier come back from this browser before the photo is drawn.
  useEffect(() => {
    if (photo) loadSubjects(latest.current[photo.id]).then(() => bump((n) => n + 1));
  }, [photo?.id]);

  // The crop as it was when the tool opened: Esc puts it back.
  const cropStart = useRef<{ g: Geometry | undefined; past: number } | null>(null);
  const openCrop = () => {
    setPicking(false);
    setMasking(false);
    setHealing(false);
    setPortrait(frame.h > frame.w);
    cropStart.current = { g: a.geometry, past: past.current.get(photo?.id ?? -1)?.length ?? 0 };
    setCropping(true);
  };
  const cancelCrop = () => {
    const was = cropStart.current;
    setCropping(false);
    setLeveling(false);
    setApplyAll(false);
    if (photo && was && a.geometry !== was.g) replace([photo.id], (old) => ({ ...old, geometry: was.g }));
  };
  const autoStraighten = async () => {
    if (!photo) return;
    const img = await loadLocalImage(await previewUrl(root, photo.id)).catch(() => null);
    if (!img) return;
    setGeometry({ ...g, angle: autoAngle(img, g) });
    done();
  };
  const autoUprightNow = async () => {
    if (!photo) return;
    const img = await loadLocalImage(await previewUrl(root, photo.id)).catch(() => null);
    if (!img) return;
    const r = autoUpright(img, g);
    setGeometry({ ...g, vertical: r.vertical || undefined, horizontal: r.horizontal || undefined });
    done();
  };
  const closeCrop = () => {
    setCropping(false);
    setLeveling(false);
    if (applyAll && photo && others.length) replace(others, (old) => ({ ...old, geometry: a.geometry }));
    setApplyAll(false);
  };
  const chooseRatio = (id: string, stand = id === '9:16' ? true : portrait) => {
    setRatioId(id);
    setPortrait(stand);
    setGeometry({ ...g, crop: cropFor(id, stand, frame) });
    done();
  };
  const [open, setOpen] = useState<Record<Panel, boolean>>({ basic: true, curve: false, mixer: false, grade: false, detail: false, effects: false, lens: false, lensblur: false });
  const toggle = (p: Panel) => setOpen((o) => ({ ...o, [p]: !o[p] }));

  const auto = async () => {
    if (!photo) return;
    const img = await loadLocalImage(await previewUrl(root, photo.id)).catch(() => null);
    const patch = img && autoAdjust(img);
    if (patch) replace([photo.id], (old) => ({ ...old, ...patch }));
  };
  const picked = (rgb: [number, number, number]) => {
    setPicking(false);
    if (photo) replace([photo.id], (old) => ({ ...old, ...neutralBalance(...rgb) }));
  };

  const goTo = (i: number) => {
    if (i < 0 || i >= photos.length) return;
    setAt(i);
    setPicking(false);
    setSelMask(null);
    setSelPart(null);
  };
  const lastClick = useRef<number | null>(null);
  const clickStrip = (e: React.MouseEvent, i: number) => {
    const id = photos[i]!.id;
    if (e.metaKey || e.ctrlKey) {
      setTicked((s) => {
        const next = new Set(s.size ? s : [photo!.id]);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else if (e.shiftKey && lastClick.current != null) {
      const [lo, hi] = [Math.min(lastClick.current, i), Math.max(lastClick.current, i)];
      setTicked(new Set(photos.slice(lo, hi + 1).map((p) => p.id)));
    } else {
      setTicked(new Set());
      goTo(i);
    }
    lastClick.current = i;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : document.body;
      if (exporting || asking || el.closest('input[type="text"], input:not([type]), textarea, select')) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.shiftKey && k === 'c') {
        e.preventDefault();
        copy();
      } else if (mod && e.shiftKey && k === 'v') {
        e.preventDefault();
        paste();
      } else if (mod && e.shiftKey && k === 's') {
        e.preventDefault();
        sync();
      } else if (!mod && e.key === '\\') {
        setMode((m) => (m === 'before' ? 'after' : 'before'));
      } else if (!mod && k === 'y') {
        setMode((m) => (m === 'split' ? 'after' : 'split'));
      } else if (!mod && el.tagName !== 'INPUT' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        goTo(at + (e.key === 'ArrowRight' ? 1 : -1));
      } else if (!mod && k === 'z') {
        setZoom((v) => v + 1);
      } else if (!mod && (k === 'k' || (e.shiftKey && (k === 'm' || k === 'j' || k === 'q')))) {
        // Lightroom's: Brush K, Radial Gradient ⇧M, Color Range ⇧J, Luminance Range ⇧Q.
        if (!masking) openMasking();
        maskTools.make(k === 'k' ? 'brush' : k === 'm' ? 'radial' : k === 'j' ? 'color' : 'luminance');
      } else if (!mod && k === 'q') {
        if (healing) setHealing(false);
        else openHealing();
      } else if (healing && (e.key === '[' || e.key === ']')) {
        setHealSize((v) => Math.min(0.3, Math.max(0.01, v * (e.key === ']' ? 1.2 : 1 / 1.2))));
      } else if (!mod && k === 'm') {
        if (masking) setMasking(false);
        else openMasking();
      } else if (masking && !mod && k === 'o') {
        setOverlay((v) => !v);
      } else if (!mod && k === 'r') {
        if (cropping) closeCrop();
        else openCrop();
      } else if (cropping && !mod && k === 'x') {
        chooseRatio(ratioId, !portrait);
      } else if (cropping && e.key === 'Enter') {
        closeCrop();
      } else if (e.key === 'Escape') {
        if (maskTools.boxing) maskTools.setBoxing(false);
        else if (leveling) setLeveling(false);
        else if (cropping) cancelCrop();
        else if (masking) setMasking(false);
        else if (healing) setHealing(false);
        setPicking(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const edited = photos.filter((p) => isEdited(edits[p.id]));
  const toExport = ticked.size > 1 ? photos.filter((p) => ticked.has(p.id)) : edited;
  const can = (list?: EditSettings[]) => !!list?.length;

  return (
    <div className="flex h-full flex-col">
      <TitleBar title={t('Edit foto')} />
      <header className="flex shrink-0 items-center gap-4 border-b border-line-soft px-4 py-2.5">
        <button type="button" onClick={() => (flush(), go(back))} aria-label={t('Kembali')} className="text-muted hover:text-fg">
          <ArrowLeft size={18} />
        </button>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-semibold">{session.name}</span>
          <span className="truncate text-[11px] text-faint">
            {photo?.name} · {t('{at} dari {count} foto', { at: num(at + 1), n: photos.length, count: num(photos.length) })}
          </span>
        </div>
        <div className="mx-auto flex gap-0.5 rounded-[10px] bg-panel p-[3px]">
          {(
            [
              ['after', ImageIcon, t('Sesudah'), t('Tekan \\ untuk melihat sebelum · Z zoom 1:1')],
              ['split', Columns2, t('Sebelum | Sesudah'), 'Y'],
            ] as const
          ).map(([m, Icon, label, tip]) => (
            <button
              key={m}
              type="button"
              title={tip}
              onClick={() => setMode(m)}
              className={cx(
                'flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs',
                (mode === m || (m === 'after' && mode === 'before')) ? 'bg-raised font-semibold text-fg' : 'text-muted hover:text-fg',
              )}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={undo} disabled={!can(past.current.get(photo?.id ?? -1))} title={`${t('Urungkan')} (⌘Z)`} className="flex size-8 items-center justify-center rounded-lg text-muted hover:text-fg disabled:opacity-30">
            <Undo2 size={16} />
          </button>
          <button type="button" onClick={redo} disabled={!can(future.current.get(photo?.id ?? -1))} title={`${t('Ulangi')} (⇧⌘Z)`} className="flex size-8 items-center justify-center rounded-lg text-muted hover:text-fg disabled:opacity-30">
            <Redo2 size={16} />
          </button>
          <Button icon={Copy} onClick={copy} disabled={!isEdited(a)} title="⌘⇧C">
            {t('Salin')}
          </Button>
          <Button icon={ClipboardPaste} onClick={paste} disabled={!copied} title="⌘⇧V">
            {t('Tempel')}
          </Button>
          <Button variant="primary" icon={Download} onClick={() => (flush(), setExporting(true))} disabled={!toExport.length}>
            {t('Ekspor')}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Presets
          photo={photo}
          a={a}
          onApply={(look) => photo && replace([photo.id], (old) => applyLook(look.adjust, old))}
          onHover={setTrying}
          viewport={viewport}
          onPan={(x, y) => panRef.current?.(x, y)}
        />

        <main className="relative flex min-w-0 flex-1 flex-col">
          {masking && maskTools.busy && (
            // The AI at work on this computer (a few seconds): said over the photo, as Lightroom's "Detecting…".
            <div className="pointer-events-none absolute inset-x-0 top-1/3 z-20 flex justify-center">
              <span className="flex items-center gap-2.5 rounded-full bg-black/75 px-4 py-2 text-[13px] text-white shadow-2xl backdrop-blur">
                <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                {maskTools.busy === 'sky'
                  ? t('Mencari langit…')
                  : maskTools.busy === 'object'
                    ? t('Memisahkan benda…')
                    : maskTools.busy === 'people'
                      ? t('Memisahkan orang…')
                      : t('Mendeteksi subjek…')}
              </span>
            </div>
          )}
          {masking && photo && (
            <MaskList
              m={maskTools}
              sel={selMask}
              part={selPart}
              overlay={overlay}
              onSelect={(m, p) => (setSelMask(m), setSelPart(p))}
              onCreating={setMaskCreate}
              onOverlay={setOverlay}
              onHover={setHoverMask}
              onDone={done}
            />
          )}
          {photo ? (
            <EditView
              root={root}
              id={photo.id}
              placeholder={photo.thumb ? thumbUrl(photo.thumb) : undefined}
              settings={shown}
              mode={mode}
              moving={moving}
              picking={picking}
              cropping={cropping}
              masking={masking || healing}
              zoomToggle={zoom}
              onViewport={setViewport}
              panRef={panRef}
              layer={
                healing ? (
                  <HealLayer a={a} size={healSize} onSize={setHealSize} onLive={live} onDone={done} />
                ) : (
                <MaskLayer
                  root={root}
                  photoId={photo.id}
                  a={a}
                  sel={selMask}
                  part={selPart}
                  overlay={overlay && !overlayRest}
                  preview={maskTools.preview}
                  hover={hoverMask}
                  boxing={maskTools.boxing}
                  onBox={maskTools.makeObject}
                  brush={brush}
                  onBrush={setBrush}
                  onLive={live}
                  onDone={done}
                />
                )
              }
              ratio={cropping ? ratioValue(ratioId, portrait, frame) : null}
              leveling={leveling}
              onLevel={(deg) => {
                setLeveling(false);
                setGeometry({ ...g, angle: Math.max(-45, Math.min(45, Math.round((g.angle - deg) * 10) / 10)) });
                done();
              }}
              onPicked={picked}
              onHistogram={setHist}
              onCrop={(crop) => setGeometry({ ...g, crop })}
              onAngle={(angle) => setGeometry({ ...g, angle })}
              onCropCommit={closeCrop}
              onCropDone={done}
              onSize={(w, h) => setSize({ w, h })}
            />
          ) : (
            <p className="m-auto text-sm text-faint">{t('Belum ada foto Pilih di sesi ini.')}</p>
          )}
          <Strip
            photos={photos}
            at={at}
            ticked={ticked}
            edits={edits}
            onClick={clickStrip}
            syncCount={others.length}
            onSync={sync}
            onMatch={cameras > 1 && photo?.camera ? matchColors : undefined}
            matching={matching}
          />
        </main>

        <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-line-soft px-4 py-3">
          {/* Lightroom's top of the panel: the histogram and the tool strip stay put while a tool is open below them. */}
          <HistogramView h={hist} root={root} photoId={photo?.id} />
          <span className="truncate pt-1 text-[11px] text-faint">{photo?.camera ?? ''}</span>
          {/* The tool strip: the open one lit (Edit when none), a dot under each one used on this photo; the open one again closes it. */}
          <div className="my-3 flex items-start justify-around rounded-lg border border-line-soft bg-panel-2 px-1 pt-1.5 pb-1">
            {(
              [
                [SlidersHorizontal, t('Edit'), '', !cropping && !healing && !masking, isEdited(adjustOnly(a)), closeTools],
                [Crop, t('Crop & luruskan'), 'R', cropping, hasGeometry(a.geometry), () => (cropping ? closeCrop() : openCrop())],
                [Eraser, t('Hapus objek'), 'Q', healing, !!a.heal?.length, () => (healing ? setHealing(false) : openHealing())],
                [CircleDashed, t('Masking'), 'M', masking, !!a.masks?.some(maskActive), () => (masking ? setMasking(false) : openMasking())],
              ] as const
            ).map(([Icon, label, key, on, used, click]) => (
              <button
                key={label}
                type="button"
                onClick={click}
                disabled={!photo}
                title={key ? `${label} (${key})` : label}
                aria-label={label}
                aria-pressed={on}
                className={cx('flex w-12 flex-col items-center gap-1 rounded-md pt-1.5 pb-1 disabled:opacity-40', on ? 'text-fg' : 'text-faint hover:text-fg')}
              >
                <Icon size={18} strokeWidth={on ? 2.25 : 1.75} />
                <span className={cx('size-1 rounded-full', used ? (on ? 'bg-gold' : 'bg-faint') : 'bg-transparent')} />
              </button>
            ))}
          </div>
          {healing && photo ? (
            <HealPanel root={root} photoId={photo.id} a={a} faces={photo.faces ?? []} size={healSize} onSize={setHealSize} onLive={live} onDone={done} onClose={() => setHealing(false)} />
          ) : masking && photo ? (
            <ToolBox title={t('Masking')}>
              <ToolRow>
                <MaskPanel m={maskTools} part={selPart} creating={maskCreate} brush={brush} onCreating={setMaskCreate} onBrush={setBrush} onDone={done} onClose={() => setMasking(false)} />
              </ToolRow>
            </ToolBox>
          ) : cropping ? (
            <CropPanel
              g={g}
              ratioId={ratioId}
              portrait={portrait}
              leveling={leveling}
              onRatio={(id) => chooseRatio(id)}
              onSwap={() => chooseRatio(ratioId, !portrait)}
              onChange={setGeometry}
              onDone={done}
              onLevel={() => setLeveling((v) => !v)}
              onAuto={autoStraighten}
              onUpright={autoUprightNow}
              others={others.length}
              applyAll={applyAll}
              onApplyAll={setApplyAll}
              onReset={() => (setGeometry(NO_GEOMETRY), done(), setRatioId('asli'))}
              onClose={closeCrop}
            />
          ) : (
          <>
          <Section title={t('Basic')} group="dasar" a={a} open={open.basic} onToggle={() => toggle('basic')} onLive={live} onDone={done} reset={BASIC_RESET}>
            <BasicPanel a={a} onLive={live} onDone={done} picking={picking} onPick={() => setPicking((v) => !v)} onAuto={auto} />
          </Section>
          <Section title={t('Tone Curve')} group="kurva" a={a} open={open.curve} onToggle={() => toggle('curve')} onLive={live} onDone={done} reset={{ curve: undefined }}>
            <CurvePanel a={a} onLive={live} onDone={done} />
          </Section>
          <Section title={t('Color Mixer')} group="warna" a={a} open={open.mixer} onToggle={() => toggle('mixer')} onLive={live} onDone={done} reset={{ hsl: undefined }}>
            <MixerPanel a={a} onLive={live} onDone={done} />
          </Section>
          <Section title={t('Color Grading')} group="warna" a={a} open={open.grade} onToggle={() => toggle('grade')} onLive={live} onDone={done} reset={{ grade: undefined }}>
            <GradePanel a={a} onLive={live} onDone={done} />
          </Section>
          <Section title={t('Detail')} group="detail" a={a} open={open.detail} onToggle={() => toggle('detail')} onLive={live} onDone={done} reset={DETAIL_RESET}>
            {photo && (
              <DenoiseBlock
                root={root}
                photoId={photo.id}
                a={a}
                others={others}
                onLive={live}
                onDone={done}
                onApplyOthers={(ids, amount) => replace(ids, (old) => ({ ...old, aiDenoise: { amount } }))}
              />
            )}
            <DetailPanel a={a} onLive={live} onDone={done} />
          </Section>
          <Section title={t('Lens Corrections')} a={a} open={open.lens} onToggle={() => toggle('lens')} onLive={live} onDone={done}>
            {photo && <LensPanel root={root} photoId={photo.id} a={a} onLive={live} onDone={done} />}
          </Section>
          <Section title={t('Effects')} group="efek" a={a} open={open.effects} onToggle={() => toggle('effects')} onLive={live} onDone={done} reset={EFFECTS_RESET}>
            <EffectsPanel a={a} onLive={live} onDone={done} />
          </Section>
          <Section title={t('Lens Blur')} a={a} open={open.lensblur} onToggle={() => toggle('lensblur')} onLive={live} onDone={done}>
            {photo && <LensBlurPanel root={root} photoId={photo.id} a={a} faces={photo.faces ?? []} onLive={live} onDone={done} />}
          </Section>
          <button
            type="button"
            onClick={() => photo && replace([photo.id], () => NO_ADJUST)}
            disabled={!isEdited(a)}
            className="mt-3 flex items-center justify-center gap-1.5 text-xs font-medium text-muted hover:text-reject disabled:opacity-40"
          >
            <RefreshCw size={12} /> {t('Kembalikan foto ini seperti aslinya')}
          </button>
          </>
          )}
        </aside>
      </div>

      {asking && (
        <CopyDialog
          title={asking === 'copy' ? t('Salin pengaturan') : t('Sinkronkan ke {count} foto', { n: others.length, count: num(others.length) })}
          action={asking === 'copy' ? t('Salin') : t('Sinkronkan')}
          initial={choice}
          onConfirm={confirmCopy}
          onClose={() => setAsking(null)}
        />
      )}
      {exporting && (
        <EditExportDialog root={root} sessionName={session.name} photos={toExport} edits={edits} onClose={() => setExporting(false)} />
      )}
    </div>
  );
}

// ── Presets ──

function Presets({
  photo,
  a,
  onApply,
  onHover,
  viewport,
  onPan,
}: {
  photo: PhotoEntry | undefined;
  a: EditSettings;
  onApply: (l: Look) => void;
  /** Pointed at: shown on the photo (and in the Navigator) until the pointer leaves. */
  onHover: (l: Look | null) => void;
  /** What the zoomed photo shows, drawn as a box; dragging it moves the view there. */
  viewport: Viewport | null;
  onPan: (x: number, y: number) => void;
}) {
  const [hover, setHover] = useState<Look | null>(null);
  const point = (l: Look | null) => {
    setHover(l);
    onHover(l);
  };
  const mine = useMyLooks((s) => s.looks);
  const { add, remove, rename, move, renameGroup, removeGroup } = useMyLooks.getState();
  const groups = [...new Set(mine.flatMap((l) => (l.group ? [l.group] : [])))];
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; items: MenuItem[] } | null>(null);
  // A preset or group being renamed in place.
  const [renaming, setRenaming] = useState<{ key: string; value: string; save: (v: string) => void } | null>(null);
  const [saving, setSaving] = useState(false);
  const lookMenu = (l: Look, at: { x: number; y: number }) =>
    setMenu({
      at,
      items: [
        { label: t('Terapkan'), onClick: () => onApply(l) },
        { label: t('Ubah nama…'), onClick: () => setRenaming({ key: l.id, value: l.name, save: (v) => rename(l.id, v) }) },
        {
          label: t('Pindahkan ke grup'),
          onClick: () => {},
          items: [
            { label: t('Preset saya'), onClick: () => move(l.id, undefined), disabled: !l.group },
            ...groups.map((g) => ({ label: g, onClick: () => move(l.id, g), disabled: l.group === g })),
          ],
        },
        { label: t('Hapus preset'), onClick: () => remove(l.id), danger: true },
      ],
    });
  const groupMenu = (g: string, at: { x: number; y: number }) =>
    setMenu({
      at,
      items: [
        { label: t('Ubah nama grup…'), onClick: () => setRenaming({ key: `g:${g}`, value: g, save: (v) => renameGroup(g, v) }) },
        { label: t('Hapus grup dan presetnya'), onClick: () => removeGroup(g), danger: true },
      ],
    });
  const renameField = (key: string) =>
    renaming?.key === key && (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          renaming.save(renaming.value);
          setRenaming(null);
        }}
        className="flex-1"
      >
        <input
          type="text"
          autoFocus
          value={renaming.value}
          onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
          onBlur={() => setRenaming(null)}
          onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
          className="h-7 w-full rounded-md border border-gold bg-bg px-2 text-[13px] outline-none"
        />
      </form>
    );
  const [query, setQuery] = useState('');
  // Groups folded shut, by name (all open at first).
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const q = query.trim().toLowerCase();
  const match = (l: Look) => !q || l.name.toLowerCase().includes(q);
  const group = (key: string, title: string, list: Look[], removable: boolean, own?: string) => (
    <div key={key} className="flex flex-col gap-0.5">
      {renameField(key) || (
        <button
          type="button"
          onClick={() => setShut((g) => (g.has(key) ? new Set([...g].filter((x) => x !== key)) : new Set([...g, key])))}
          onContextMenu={(e) => own && (e.preventDefault(), groupMenu(own, { x: e.clientX, y: e.clientY }))}
          className="flex items-center gap-1.5 px-1 py-1.5 text-left text-xs font-semibold"
        >
          <ChevronDown size={13} className={cx('text-faint transition-transform', shut.has(key) && '-rotate-90')} />
          <span className="truncate">{title}</span> <span className="font-normal text-faint">{num(list.length)}</span>
        </button>
      )}
      {!shut.has(key) &&
        list.filter(match).map((l) => (
          <div key={l.id} className="group relative pl-5">
            {renameField(l.id) || (
              <>
                <button
                  type="button"
                  onClick={() => (point(null), onApply(l))}
                  onMouseEnter={() => point(l)}
                  onMouseLeave={() => point(null)}
                  onContextMenu={(e) => removable && (e.preventDefault(), lookMenu(l, { x: e.clientX, y: e.clientY }))}
                  className="flex w-full items-center rounded-md py-1 pr-7 pl-1 text-left text-[13px] text-muted hover:bg-panel-2 hover:text-fg"
                >
                  <span className="truncate">{t(l.name)}</span>
                </button>
                {removable && (
                  <button
                    type="button"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      lookMenu(l, { x: r.left, y: r.bottom + 4 });
                    }}
                    title={t('Menu preset')}
                    className="absolute top-1/2 right-1 hidden size-6 -translate-y-1/2 items-center justify-center rounded text-faint group-hover:flex hover:text-fg"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                )}
              </>
            )}
          </div>
        ))}
    </div>
  );
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line-soft">
      {/* Navigator, as Lightroom's: the photo with the preset pointed at, or as edited. */}
      <div className="flex flex-col gap-1.5 border-b border-line-soft p-3">
        <span className="flex justify-between text-[11px] font-semibold tracking-wide text-faint uppercase">
          {t('Navigator')}
          {hover && <span className="truncate pl-2 font-normal tracking-normal text-gold-text normal-case">{t(hover.name)}</span>}
        </span>
        {photo && (
          <Navigator viewport={viewport} onPan={onPan}>
            {/* As edited (crop included), or with the preset pointed at. */}
            <EditedThumb photo={photo} settings={hover ? applyLook(hover.adjust, a) : a} size={320} delay={hover ? 0 : 200} />
          </Navigator>
        )}
      </div>
      <div className="flex flex-col gap-2 p-3">
        <span className="text-[11px] font-semibold tracking-wide text-faint uppercase">{t('Preset')}</span>
        <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-bg px-2.5">
          <Search size={13} className="text-faint" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Cari preset…')}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-faint"
          />
        </label>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2">
        {group('built', 'pilihfotomu', BUILT_IN, false)}
        {groups.map((g) => group(`g:${g}`, g, mine.filter((l) => l.group === g), true, g))}
        {group('mine', t('Preset saya'), mine.filter((l) => !l.group), true)}
      </div>
      <div className="flex flex-col gap-2 border-t border-line-soft p-3">
        <Button icon={Save} onClick={() => setSaving(true)} disabled={!isEdited(a)}>
          {t('Simpan sebagai preset')}
        </Button>
        <Button icon={FileUp} onClick={() => setImporting(true)}>
          {t('Impor preset Lightroom')}
        </Button>
      </div>
      {importing && <ImportPresetsDialog photo={photo} onClose={() => setImporting(false)} />}
      {saving && (
        <SavePresetDialog
          groups={groups}
          onSave={(name, g) => {
            add(name, a, g);
            setSaving(false);
          }}
          onClose={() => setSaving(false)}
        />
      )}
      {menu && <PopMenu at={menu.at} items={menu.items} onClose={() => setMenu(null)} />}
    </aside>
  );
}

/**
 * The Navigator's picture with, while zoomed, a box round what the photo
 * shows: drag it (or click anywhere) to look elsewhere.
 */
function Navigator({ viewport, onPan, children }: { viewport: Viewport | null; onPan: (x: number, y: number) => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = (e: React.PointerEvent) => {
    if (!viewport) return;
    e.preventDefault();
    const r = ref.current!.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) =>
      onPan(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const pct = (v: number) => `${v * 100}%`;
  return (
    <div className="flex aspect-[3/2] w-full items-center justify-center">
      <div
        ref={ref}
        onPointerDown={drag}
        className={cx('relative max-h-full max-w-full overflow-hidden rounded-md bg-bg', viewport && 'cursor-move')}
        style={{ aspectRatio: viewport?.aspect ?? 3 / 2, height: (viewport?.aspect ?? 1.5) < 1.5 ? '100%' : undefined, width: (viewport?.aspect ?? 1.5) >= 1.5 ? '100%' : undefined }}
      >
        {children}
        {viewport && (
          <>
            {/* Outside the box dimmed, as Lightroom's. */}
            <span
              className="pointer-events-none absolute border border-white"
              style={{ left: pct(viewport.x), top: pct(viewport.y), width: pct(viewport.w), height: pct(viewport.h), boxShadow: '0 0 0 999px rgb(0 0 0 / 0.45)' }}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ── The photos along the bottom ──

function Strip({
  photos,
  at,
  ticked,
  edits,
  onClick,
  syncCount,
  onSync,
  onMatch,
  matching,
}: {
  photos: PhotoEntry[];
  at: number;
  ticked: Set<number>;
  edits: Record<number, EditSettings>;
  onClick: (e: React.MouseEvent, i: number) => void;
  syncCount: number;
  onSync: () => void;
  /** Samakan warna antar kamera, when the photos come from more than one. */
  onMatch?: () => void;
  matching: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.children[at]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [at]);
  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-line-soft px-4 pt-2.5 pb-3">
      <div className="flex items-center gap-3">
        <span className="text-xs font-medium">{t('{count} foto', { n: photos.length, count: num(photos.length) })}</span>
        <span className="text-[11px] text-faint">{t('titik emas = sudah diedit · ⌘/Shift+klik untuk memilih beberapa')}</span>
        {onMatch && (
          <Button className="ml-auto" icon={Camera} onClick={onMatch} disabled={matching} title={t('Kamera foto yang sedang dibuka jadi acuan')}>
            {matching ? t('Menyamakan…') : t('Samakan warna antar kamera')}
          </Button>
        )}
        <Button className={onMatch ? '' : 'ml-auto'} icon={RefreshCw} onClick={onSync} disabled={!syncCount} title="⌘⇧S">
          {syncCount ? t('Sinkronkan ke {count} foto', { n: syncCount, count: num(syncCount) }) : t('Sinkronkan')}
        </Button>
      </div>
      <div ref={ref} className="-mx-1 flex gap-2 overflow-x-auto p-1">
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={(e) => onClick(e, i)}
            title={p.name}
            className={cx(
              'relative h-16 w-24 shrink-0 overflow-hidden rounded-md bg-line bg-cover bg-center',
              i === at ? 'ring-2 ring-gold' : ticked.has(p.id) ? 'ring-2 ring-gold/50' : 'opacity-80 hover:opacity-100',
            )}
            style={{ backgroundImage: p.thumb ? `url("${thumbUrl(p.thumb)}")` : undefined }}
          >
            {isEdited(edits[p.id]) && <EditedThumb photo={p} settings={edits[p.id]!} />}
            {isEdited(edits[p.id]) && <span className="absolute top-1 right-1 size-2 rounded-full bg-gold ring-1 ring-black/40" />}
          </button>
        ))}
      </div>
    </div>
  );
}
