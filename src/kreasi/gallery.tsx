import { ArrowLeft, ArrowRight, Bookmark, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cx } from '../components/ui';
import { num } from '../lib/format';
import { locale, t } from '../lib/i18n';
import type { FormatId } from './engine/document';
import { api } from '../lib/api';
import { useApp } from '../store';
import { listDrafts, reopenSource, templateOfDraft, type Draft } from './drafts';
import {
  BLANK_FORMATS,
  CATEGORIES,
  blankTemplate,
  formatLabel,
  loadMyTemplates,
  loadTemplates,
  slotShapes,
  templateDoc,
  type Template,
  type TemplateCategory,
} from './kit';
import { sessionSource } from './sources';
import { useKreasi } from './store';
import { DocPicture, SHAPE_LABEL, ShapeIcon, Steps } from './ui';

type FormatTab = 'semua' | FormatId;
const TABS: { id: FormatTab; label: string }[] = [
  { id: 'semua', label: 'Semua' },
  { id: 'story', label: 'Story 9:16' },
  { id: 'feed', label: 'Feed 4:5' },
  { id: 'square', label: 'Feed 1:1' },
  { id: 'carousel', label: 'Carousel' },
];

/** A format's outline, `k` times the cards' size. */
const blankShape = (f: FormatId, k = 1) => {
  const [w, h] = f === 'story' ? [20, 34] : f === 'feed' ? [26, 32] : f === 'carousel' ? [44, 22] : [28, 28];
  return { width: w * k, height: h * k };
};

/** How many photos a template takes, computed once per template. */
const photoCount = new Map<string, number>();
const countOf = (tp: Template) => {
  let n = photoCount.get(tp.id);
  if (n == null) photoCount.set(tp.id, (n = slotShapes(templateDoc(tp)).length));
  return n;
};

/** Layar 12 · Pilih template. */
export function Gallery({ onBack }: { onBack: () => void }) {
  const choose = useKreasi((s) => s.choose);
  const [bundled, setAll] = useState<Template[] | null>(null);
  // The photographer's own, first: "Template saya".
  const [mine, setMine] = useState<Template[]>([]);
  useEffect(() => {
    loadMyTemplates().then(setMine);
  }, []);
  const all = useMemo(() => (bundled ? [...mine, ...bundled] : null), [bundled, mine]);
  /**
   * Starts a design. An empty canvas has no photo places to fill first: it
   * goes straight to the editor, photos come from its Foto panel.
   */
  const start = (tp: Template) => {
    choose(tp);
    if (countOf(tp) === 0) {
      const { source } = useKreasi.getState();
      useKreasi.setState({ step: 'edit', source: source ?? sessionSource() });
    }
  };
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FormatTab>('semua');
  const [category, setCategory] = useState<TemplateCategory | 'saya' | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const fail = useApp((s) => s.fail);
  useEffect(() => {
    loadTemplates().then(setAll, (e) => setError(String(e)));
  }, []);
  // Again once the design just left is saved, so its card shows the latest.
  const savedAt = useKreasi((s) => s.savedAt);
  useEffect(() => {
    listDrafts().then(setDrafts);
  }, [savedAt]);

  const resume = async (d: Draft) => {
    const tp = all && templateOfDraft(all, d);
    if (!tp) return fail(t('Template draf ini tidak ditemukan.'));
    try {
      const source = await reopenSource(d.source);
      useKreasi.getState().openDraft({ ...d, source, savedAt: d.updatedAt }, tp);
    } catch (e) {
      fail(e);
    }
  };
  // Deleting asks once more: a draft is the photographer's work.
  const [confirming, setConfirming] = useState<string | null>(null);
  const removeMine = async (tp: Template) => {
    await api.deleteMyTemplate(tp.id).catch(fail);
    setMine((list) => list.filter((x) => x.id !== tp.id));
  };
  const forget = async (d: Draft) => {
    if (confirming !== d.id) return setConfirming(d.id);
    await api.deleteDraft(d.id).catch(fail);
    setDrafts((list) => list.filter((x) => x.id !== d.id));
    setConfirming(null);
  };
  const [photoFilter, setPhotoFilter] = useState<number | null>(null);
  const filterCount = (n: number) => photoFilter === null || (photoFilter === 4 ? n >= 4 : n === photoFilter);

  const counts = useMemo(() => {
    const c = new Map<TemplateCategory, number>();
    for (const tp of bundled ?? []) if (tab === 'semua' || tp.format === tab) c.set(tp.category, (c.get(tp.category) ?? 0) + 1);
    return c;
  }, [bundled, tab]);

  const mineCount = mine.filter((tp) => tab === 'semua' || tp.format === tab).length;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (all ?? []).filter(
      (tp) =>
        (tab === 'semua' || tp.format === tab) &&
        (!category || (category === 'saya' ? tp.mine : !tp.mine && tp.category === category)) &&
        filterCount(countOf(tp)) &&
        (!q || tp.name.toLowerCase().includes(q) || tp.description.toLowerCase().includes(q)),
    );
  }, [all, tab, category, query, photoFilter]);

  const preview = shown.find((tp) => tp.id === picked) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-line-soft px-6 py-4 lg:px-8">
        <div className="flex items-center gap-3.5">
          <button type="button" onClick={onBack} aria-label={t('Kembali')} className="text-muted hover:text-fg">
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-[20px] font-semibold">{t('Mulai desain')}</h1>
        </div>
        <Steps at={1} />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Every filter in one column, so the templates start at the top. */}
        <nav className="flex w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line-soft bg-panel px-3 py-5">
          <FilterGroup title={t('Format')}>
            {TABS.map((x) => (
              <FilterItem key={x.id} on={tab === x.id} onClick={() => setTab(x.id)} icon={<FormatGlyph format={x.id} />}>
                {t(x.label)}
              </FilterItem>
            ))}
          </FilterGroup>
          <FilterGroup title={t('Kategori')}>
            <FilterItem on={!category} onClick={() => setCategory(null)}>
              {t('Semua')}
            </FilterItem>
            <FilterItem on={category === 'saya'} onClick={() => setCategory('saya')} count={mineCount} icon={<Bookmark size={13} className="text-gold-text" />}>
              {t('Template saya')}
            </FilterItem>
            {CATEGORIES.filter((c) => counts.get(c.id)).map((c) => (
              <FilterItem key={c.id} on={category === c.id} onClick={() => setCategory(c.id)} count={counts.get(c.id)!}>
                {t(c.label)}
              </FilterItem>
            ))}
          </FilterGroup>
          <FilterGroup title={t('Jumlah foto')}>
            <div className="flex gap-1.5 px-2">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPhotoFilter(photoFilter === n ? null : n)}
                  className={cx(
                    'h-7 flex-1 rounded-md text-xs font-medium',
                    photoFilter === n ? 'bg-raised text-fg ring-1 ring-gold' : 'bg-panel-2 text-muted hover:text-fg',
                  )}
                >
                  {n === 4 ? '4+' : n}
                </button>
              ))}
            </div>
          </FilterGroup>
        </nav>

        <section className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pt-5 pb-10 lg:px-8">
          {/* First: a design of one's own — the way to a template of one's own too. */}
          {category !== 'saya' && (
            <section className="flex shrink-0 flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-[17px] font-semibold">{t('Buat desain sendiri')}</h2>
                <p className="text-xs text-muted">{t('Mulai dari kanvas kosong: susun foto, teks, dan elemen sendiri, lalu simpan jadi template saya.')}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {BLANK_FORMATS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => start(blankTemplate(f))}
                    className="group flex h-[132px] flex-col items-center justify-center gap-3 rounded-xl border border-line bg-panel text-muted transition-colors hover:border-gold hover:bg-gold/[0.06] hover:text-fg"
                  >
                    <span className="flex items-center justify-center rounded-[4px] border-[1.5px] border-current" style={blankShape(f, 1.3)}>
                      <Plus size={16} className="text-gold-text" />
                    </span>
                    <span className="flex flex-col items-center gap-0.5">
                      <span className="text-[13px] font-semibold text-fg">{t(TABS.find((x) => x.id === f)?.label ?? '')}</span>
                      <span className="text-[11px] text-faint">{t('Kanvas kosong')}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {drafts.length > 0 && !query && (
            <section className="flex flex-col gap-2.5">
              <h2 className="text-[13px] font-semibold">{t('Lanjutkan desain')}</h2>
              <div className="-mx-1 -mt-1 flex gap-3 overflow-x-auto px-1 pt-1 pb-1">
                {drafts.map((d) => (
                  <div key={d.id} className="group relative flex w-[132px] shrink-0 flex-col gap-1.5">
                    <button type="button" onClick={() => resume(d)} className="flex h-[132px] items-center justify-center rounded-xl bg-panel-2 p-2.5 ring-1 ring-line-soft hover:ring-gold">
                      {d.cover ? <img src={d.cover} alt="" className="max-h-full max-w-full rounded-[3px] object-contain" /> : null}
                    </button>
                    <span className="truncate text-xs font-medium">{d.name}</span>
                    <span className="text-[11px] text-faint">{new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d.updatedAt)}</span>
                    <button
                      type="button"
                      onClick={() => forget(d)}
                      onMouseLeave={() => setConfirming(null)}
                      title={t('Hapus draf')}
                      aria-label={t('Hapus draf')}
                      className={cx(
                        'absolute top-1.5 right-1.5 h-7 items-center justify-center gap-1 rounded-lg px-1.5 text-[11px] font-medium group-hover:flex',
                        confirming === d.id ? 'flex bg-reject text-white' : 'hidden bg-bg/85 text-faint hover:text-reject',
                      )}
                    >
                      <Trash2 size={13} /> {confirming === d.id && t('Hapus?')}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[17px] font-semibold">
                {category === 'saya' ? t('Template saya') : t('Atau pakai template')} <span className="text-[13px] font-normal text-faint">{num(shown.length)}</span>
              </h2>
              <label className="flex h-9 w-64 items-center gap-2 rounded-[10px] border border-line bg-panel px-3 focus-within:border-gold">
                <Search size={14} className="shrink-0 text-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('Cari template…')}
                  className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
                />
                {query && (
                  <button type="button" onClick={() => setQuery('')} aria-label={t('Hapus')}>
                    <X size={14} className="text-faint" />
                  </button>
                )}
              </label>
            </div>
            {error && <p className="text-sm text-reject">{error}</p>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-5">
              {shown.map((tp) => {
                const n = countOf(tp);
                return (
                  <div key={tp.id} className="group flex flex-col gap-2">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setPicked(tp.id)}
                        className="flex aspect-[200/248] w-full items-center justify-center rounded-xl bg-panel-2 p-3 ring-1 ring-line-soft hover:ring-gold"
                      >
                        <DocPicture id={tp.id} doc={templateDoc(tp)} width={tp.format === 'carousel' ? 120 : 180} className="max-h-full max-w-full" />
                      </button>
                      {/* Straight to it, without the preview. */}
                      <button
                        type="button"
                        onClick={() => start(tp)}
                        className="absolute right-2 bottom-2 left-2 hidden h-9 items-center justify-center gap-1.5 rounded-lg bg-gold-gradient text-xs font-semibold text-white shadow-lg group-hover:flex"
                      >
                        {t('Pakai')} <ArrowRight size={14} />
                      </button>
                    </div>
                    <span className="flex flex-col gap-0.5 px-0.5">
                      <span className="truncate text-[13px] font-medium">{tp.name}</span>
                      <span className="text-[11px] text-faint">
                        {formatLabel(tp.format)}
                        {tp.format === 'carousel' ? ` · ${t('{n} slide', { n: tp.slides })}` : ''} · {t('{count} foto', { n, count: num(n) })}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
            {all && shown.length === 0 && category === 'saya' && !query ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
                <Bookmark size={22} className="text-gold-text" />
                <span className="text-[15px] font-semibold">{t('Belum ada template sendiri')}</span>
                <p className="max-w-[440px] text-xs text-muted">
                  {t('Buat desain dari kanvas kosong, atau ubah template mana pun, lalu klik Simpan template di editor. Template itu muncul di sini untuk dipakai lagi dengan foto lain.')}
                </p>
                <NewDesignButton formats={BLANK_FORMATS} onStart={(f) => start(blankTemplate(f))} />
              </div>
            ) : (
              all && shown.length === 0 && <p className="py-16 text-center text-sm text-faint">{t('Tidak ada template yang cocok.')}</p>
            )}
          </section>
        </section>
      </div>

      {preview && (
        <TemplatePreview
          key={preview.id}
          template={preview}
          onClose={() => setPicked(null)}
          onUse={() => start(preview)}
          onDelete={preview.mine ? () => (removeMine(preview), setPicked(null)) : undefined}
        />
      )}
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="px-2 pb-1 text-[11px] font-semibold text-faint uppercase">{title}</span>
      {children}
    </div>
  );
}

function FilterItem({ on, onClick, icon, count, children }: { on: boolean; onClick: () => void; icon?: React.ReactNode; count?: number; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('flex h-8 items-center gap-2.5 rounded-lg px-2 text-left text-[13px]', on ? 'bg-raised font-semibold text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg')}
    >
      {icon && <span className="flex w-4 shrink-0 justify-center">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {count != null && <span className="text-[11px] font-normal text-faint">{num(count)}</span>}
    </button>
  );
}

/** A format's outline, small: what shape the canvas is. */
function FormatGlyph({ format }: { format: FormatTab }) {
  const size = format === 'semua' ? { width: 12, height: 12 } : blankShape(format, 0.5);
  return <span className={cx('block rounded-[2px] border-[1.5px] border-current', format === 'semua' && 'border-dashed')} style={size} />;
}

/** "Buat desain sendiri": the canvases to start from, in a small menu. */
function NewDesignButton({ formats, onStart }: { formats: FormatId[]; onStart: (f: FormatId) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-10 items-center gap-2 rounded-[10px] bg-gold-gradient px-4 text-[13px] font-semibold text-white"
      >
        <Plus size={16} /> {t('Buat desain sendiri')}
      </button>
      {open && (
        <div className="absolute top-12 right-0 z-30 flex w-64 flex-col gap-0.5 rounded-xl border border-line bg-panel-2 p-1.5 text-left shadow-2xl">
          <span className="px-2.5 pt-1.5 pb-1 text-[11px] text-faint">{t('Kanvas kosong · bisa disimpan jadi template saya')}</span>
          {formats.map((f) => (
            <button key={f} type="button" onClick={() => (setOpen(false), onStart(f))} className="flex items-center gap-3 rounded-lg p-2.5 text-[13px] hover:bg-raised">
              <span className="flex w-6 justify-center text-muted">
                <span className="block rounded-[2px] border-[1.5px] border-current" style={blankShape(f, 0.6)} />
              </span>
              {t(TABS.find((x) => x.id === f)?.label ?? '')}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A template large, with what it needs; opened by clicking its card. */
function TemplatePreview({ template, onUse, onClose, onDelete }: { template: Template; onUse: () => void; onClose: () => void; onDelete?: () => void }) {
  const doc = templateDoc(template);
  const shapes = slotShapes(doc);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' ? onClose() : e.key === 'Enter' && onUse());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onUse]);
  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-6" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={template.name}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-[860px] max-w-full gap-6 overflow-hidden rounded-[18px] border border-line bg-panel p-6 shadow-2xl"
      >
        <div className="flex min-h-[420px] flex-1 items-center justify-center rounded-xl bg-panel-2 p-5">
          <DocPicture id={template.id} doc={doc} width={template.format === 'carousel' ? 180 : 340} numbered className="max-h-[60vh] max-w-full" />
        </div>
        <div className="flex w-[280px] shrink-0 flex-col gap-4 overflow-y-auto">
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <h2 className="text-[17px] font-semibold">{template.name}</h2>
              <p className="text-xs text-faint">
                {formatLabel(template.format)} · {template.mine ? t('Template saya') : t(CATEGORIES.find((c) => c.id === template.category)?.label ?? '')}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label={t('Tutup')} className="text-faint hover:text-fg">
              <X size={18} />
            </button>
          </div>
          {template.description && <p className="text-xs text-muted">{template.description}</p>}
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">{t('Butuh {count} foto', { n: shapes.length, count: num(shapes.length) })}</span>
            {shapes.slice(0, 8).map((s, i) => (
              <span key={i} className="flex h-9 items-center gap-2.5 rounded-lg bg-panel-2 px-3">
                <span className="flex size-[22px] items-center justify-center rounded-md bg-raised text-[11px] font-semibold text-gold-text">{i + 1}</span>
                <ShapeIcon shape={s.shape} className="text-faint" />
                <span className="text-xs text-muted">{t(SHAPE_LABEL[s.shape])}</span>
              </span>
            ))}
            {shapes.length > 8 && <span className="text-xs text-faint">{t('dan {n} lagi', { n: shapes.length - 8 })}</span>}
          </div>
          <div className="flex-1" />
          {onDelete && (
            <button
              type="button"
              onClick={() => (confirm ? onDelete() : setConfirm(true))}
              onMouseLeave={() => setConfirm(false)}
              className={cx(
                'flex h-9 shrink-0 items-center justify-center gap-2 rounded-[10px] text-[13px] font-medium',
                confirm ? 'bg-reject text-white' : 'border border-line text-muted hover:text-reject',
              )}
            >
              <Trash2 size={14} /> {confirm ? t('Hapus template ini?') : t('Hapus dari Template saya')}
            </button>
          )}
          <button
            type="button"
            onClick={onUse}
            className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-gold-gradient text-sm font-semibold text-white"
          >
            {t('Pakai template ini')} <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
