import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  Download,
  FlipHorizontal,
  Image as ImageIcon,
  Italic,
  Redo2,
  Replace,
  RotateCcw,
  Type,
  Undo2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { slotsFor, templateOf, type CollageDoc, type TextLayer } from './engine/document';
import { FONT_CATEGORIES, FONTS } from './engine/font-catalog';
import type { Selection } from './engine/render';
import { DocCanvas, useBox, useDocImages } from './canvas';
import { ExportDialog } from './export';
import { fontFamilies, formatLabel, photoIdOf, slotShapes } from './kit';
import { useKreasi } from './store';
import { SHAPE_LABEL, ShapeIcon, Steps } from './ui';

/** Layar 14 · Editor template: photos panned and zoomed in their places, texts edited. */
export function Editor() {
  const { doc, template, source, past, future } = useKreasi();
  const { setStep, setActive, live, commit, edit, undo, redo } = useKreasi.getState();
  const [selection, setSelection] = useState<Selection>(null);
  const [exporting, setExporting] = useState(false);
  const [stageRef, stage] = useBox<HTMLDivElement>();
  const images = useDocImages(doc, source?.root ?? null, true);

  // ⌘Z / ⇧⌘Z come from the menu bar (see app.tsx); Delete-free on purpose.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || exporting) return;
      if (e.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exporting]);

  if (!doc || !template) return null;
  const count = templateOf(doc).cells.length;
  const nameOf = (i: number) => {
    const s = doc.slots[i];
    const id = s ? photoIdOf(s.file) : null;
    return id != null ? (source?.photos.find((p) => p.id === id)?.name ?? null) : null;
  };

  const setText = (id: string, patch: Partial<TextLayer>, liveOnly = false) =>
    (liveOnly ? live : edit)((d) => ({ ...d, texts: d.texts.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const setSlot = (i: number, patch: Partial<NonNullable<CollageDoc['slots'][number]>>, liveOnly = false) =>
    (liveOnly ? live : edit)((d) => ({ ...d, slots: d.slots.map((s, j) => (j === i && s ? { ...s, ...patch } : s)) }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line-soft px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => setStep('isi')} aria-label={t('Kembali')} className="text-muted hover:text-fg">
            <ArrowLeft size={18} />
          </button>
          <span className="truncate text-[15px] font-semibold">{template.name}</span>
        </div>
        <Steps at={3} onGo={(n) => setStep(n === 1 ? 'galeri' : 'isi')} />
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={undo} disabled={!past.length} aria-label={t('Urungkan')} className="text-muted hover:text-fg disabled:opacity-30">
            <Undo2 size={17} />
          </button>
          <button type="button" onClick={redo} disabled={!future.length} aria-label={t('Ulangi')} className="text-muted hover:text-fg disabled:opacity-30">
            <Redo2 size={17} />
          </button>
          <span className="h-5 w-px bg-line" />
          <button
            type="button"
            onClick={() => setExporting(true)}
            className="flex h-9 items-center gap-2 rounded-[10px] bg-gold-gradient px-4 text-[13px] font-semibold text-white"
          >
            <Download size={15} /> {t('Ekspor')}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col gap-1 overflow-y-auto border-r border-line-soft bg-panel p-3.5">
          <span className="pb-1 text-[11px] font-semibold text-faint uppercase">{t('Lapisan')}</span>
          {doc.texts.map((x) => (
            <LayerRow
              key={x.id}
              on={selection?.kind === 'text' && selection.id === x.id}
              icon={<Type size={14} className="text-faint" />}
              label={x.text.split('\n')[0] || t('Teks')}
              onClick={() => setSelection({ kind: 'text', id: x.id })}
            />
          ))}
          {slotsFor(doc, count).map((s, i) => (
            <LayerRow
              key={i}
              on={selection?.kind === 'cell' && selection.index === i}
              icon={
                s && images.get(s.file.fileId) ? (
                  <img src={images.get(s.file.fileId)!.src} alt="" className="h-5 w-7 rounded-sm object-cover" />
                ) : (
                  <ImageIcon size={14} className="text-faint" />
                )
              }
              label={t('Foto {n}', { n: i + 1 })}
              onClick={() => setSelection({ kind: 'cell', index: i })}
            />
          ))}
        </aside>

        <div ref={stageRef} className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-[#08100d] p-8">
          {stage.w > 0 && (
            <DocCanvas
              doc={doc}
              images={images}
              box={{ w: stage.w - 64, h: stage.h - 90 }}
              selection={selection}
              handlers={{
                onSelect: setSelection,
                onPan: (i, ox, oy) => setSlot(i, { ox, oy }, true),
                onZoom: (i, zoom) => setSlot(i, { zoom }, true),
                onMoveText: (id, x, y) => setText(id, { x, y }, true),
                onCommit: commit,
              }}
            />
          )}
          <span className="text-[11px] text-faint">
            {formatLabel(doc.format)} · {t('Seret foto untuk menggeser, scroll untuk zoom, seret teks untuk memindah.')}
          </span>
        </div>

        <aside className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-line-soft bg-panel p-5">
          {selection?.kind === 'text' && doc.texts.find((x) => x.id === selection.id) ? (
            <TextInspector layer={doc.texts.find((x) => x.id === selection.id)!} doc={doc} onChange={(p) => setText(selection.id, p)} />
          ) : selection?.kind === 'cell' ? (
            <PhotoInspector
              index={selection.index}
              doc={doc}
              name={nameOf(selection.index)}
              onChange={(p, l) => setSlot(selection.index, p, l)}
              onCommit={commit}
              onReplace={() => (setActive(selection.index), setStep('isi'))}
            />
          ) : (
            <div className="flex flex-col gap-2 text-[13px] text-muted">
              <span className="text-[15px] font-semibold text-fg">{template.name}</span>
              {t('Klik foto atau teks di kanvas untuk mengubahnya.')}
            </div>
          )}
        </aside>
      </div>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}

function LayerRow({ on, icon, label, onClick }: { on: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-2 text-left', on ? 'bg-raised ring-1 ring-gold' : 'hover:bg-panel-2')}
    >
      <span className="flex w-7 justify-center">{icon}</span>
      <span className={cx('truncate text-xs', on ? 'font-semibold text-fg' : 'text-muted')}>{label}</span>
    </button>
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
        <span className="font-medium">{show}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onDone}
        onKeyUp={onDone}
        className="accent-[var(--color-gold)]"
      />
    </label>
  );
}

function PhotoInspector({
  index,
  doc,
  name,
  onChange,
  onCommit,
  onReplace,
}: {
  index: number;
  doc: CollageDoc;
  name: string | null;
  onChange: (p: Partial<NonNullable<CollageDoc['slots'][number]>>, liveOnly?: boolean) => void;
  onCommit: () => void;
  onReplace: () => void;
}) {
  const slot = doc.slots[index];
  const shape = slotShapes(doc)[index]?.shape ?? 'square';
  const hasPhoto = !!slot && slot.file.fileId.startsWith('foto-');
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold">{t('Foto {n}', { n: index + 1 })}</span>
        <span className="flex items-center gap-1 text-[11px] text-faint">
          <ShapeIcon shape={shape} size={12} /> {t(SHAPE_LABEL[shape])}
        </span>
      </div>
      <Section title={t('Foto')}>
        <span className="truncate text-xs text-muted">{name ?? t('Belum ada foto')}</span>
        <button type="button" onClick={onReplace} className="flex h-8 items-center justify-center gap-2 rounded-lg border border-line bg-panel-2 text-xs hover:bg-raised">
          <Replace size={13} /> {hasPhoto ? t('Ganti foto') : t('Pilih foto##isi')}
        </button>
      </Section>
      {hasPhoto && slot && (
        <Section title={t('Posisi di tempatnya')}>
          <Slider
            label={t('Zoom')}
            value={slot.zoom}
            min={1}
            max={3}
            step={0.01}
            show={`${Math.round(slot.zoom * 100)}%`}
            onChange={(zoom) => onChange({ zoom }, true)}
            onDone={onCommit}
          />
          <Slider
            label={t('Putar')}
            value={slot.rotate}
            min={-45}
            max={45}
            step={0.5}
            show={`${slot.rotate.toFixed(1).replace('.', ',')}°`}
            onChange={(rotate) => onChange({ rotate }, true)}
            onDone={onCommit}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => onChange({ flip: !slot.flip })} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel-2 text-xs hover:bg-raised">
              <FlipHorizontal size={13} /> {t('Balik')}
            </button>
            <button type="button" onClick={() => onChange({ zoom: 1, ox: 0, oy: 0, rotate: 0 })} className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel-2 text-xs hover:bg-raised">
              <RotateCcw size={13} /> {t('Atur ulang')}
            </button>
          </div>
          <p className="text-[11px] text-faint">{t('Seret foto di kanvas untuk menggeser.')}</p>
        </Section>
      )}
    </>
  );
}

/** Colors the design already uses, then a few neutrals. */
function palette(doc: CollageDoc): string[] {
  const used = [...doc.texts.map((x) => x.color), doc.style.background].map((c) => c.toLowerCase());
  return [...new Set([...used, '#ffffff', '#000000', '#2b3a33', '#c9a96e'])].slice(0, 10);
}

function TextInspector({ layer, doc, onChange }: { layer: TextLayer; doc: CollageDoc; onChange: (p: Partial<TextLayer>) => void }) {
  const [draft, setDraft] = useState(layer.text);
  useEffect(() => setDraft(layer.text), [layer.id, layer.text]);
  const fam = fontFamilies();
  const colors = useMemo(() => palette(doc), [doc]);
  return (
    <>
      <span className="text-[15px] font-semibold">{t('Teks')}</span>
      <Section title={t('Isi')}>
        <textarea
          value={draft}
          rows={3}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== layer.text && onChange({ text: draft })}
          className="resize-none rounded-lg border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-gold"
        />
      </Section>
      <Section title={t('Huruf')}>
        <select
          value={layer.font}
          onChange={(e) => onChange({ font: e.target.value })}
          className="h-9 rounded-lg border border-line bg-bg px-2 text-[13px] outline-none focus:border-gold"
          style={{ fontFamily: fam[layer.font] }}
        >
          {FONT_CATEGORIES.map((c) => (
            <optgroup key={c.id} label={t(c.label)}>
              {Object.entries(FONTS)
                .filter(([, f]) => f.category === c.id)
                .map(([id, f]) => (
                  <option key={id} value={id}>
                    {f.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <Slider label={t('Ukuran')} value={layer.size} min={0.02} max={0.3} step={0.002} show={`${Math.round(layer.size * 1080)} px`} onChange={(size) => onChange({ size })} />
        <div className="flex gap-1.5">
          <IconToggle on={layer.weight >= 600} onClick={() => onChange({ weight: layer.weight >= 600 ? 400 : 700 })} label={t('Tebal')}>
            <Bold size={14} />
          </IconToggle>
          <IconToggle on={layer.italic} onClick={() => onChange({ italic: !layer.italic })} label={t('Miring')}>
            <Italic size={14} />
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
        <div className="flex flex-wrap gap-2">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange({ color: c, fill: undefined })}
              aria-label={c}
              className={cx('size-7 rounded-full', layer.color.toLowerCase() === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-panel' : 'ring-1 ring-line')}
              style={{ background: c }}
            />
          ))}
          <label className="relative size-7 cursor-pointer overflow-hidden rounded-full ring-1 ring-line" title={t('Warna lain')}>
            <input type="color" value={layer.color} onChange={(e) => onChange({ color: e.target.value, fill: undefined })} className="absolute inset-0 size-full cursor-pointer opacity-0" />
            <span className="flex size-full items-center justify-center text-sm text-faint">+</span>
          </label>
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
      aria-label={label}
      aria-pressed={on}
      className={cx('flex size-8 items-center justify-center rounded-lg', on ? 'bg-raised text-fg ring-1 ring-line' : 'text-muted hover:bg-panel-2')}
    >
      {children}
    </button>
  );
}
