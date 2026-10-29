import { ArrowLeft, ArrowRight, Bookmark, Check, Layers, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { cx } from '../components/ui';
import { num } from '../lib/format';
import { locale, t } from '../lib/i18n';
import { FORMATS, type FormatId } from './engine/document';
import { api } from '../lib/api';
import { useApp } from '../store';
import { BatchDialog } from './batch';
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
  // Print sizes are portrait, 26 px wide at their own ratio.
  const [w, h] =
    f === 'story' ? [20, 34] : f === 'feed' ? [26, 32] : f === 'carousel' ? [44, 22] : FORMATS[f]?.printInches ? [24, 24 * FORMATS[f].ratio] : [28, 28];
  return { width: w * k, height: h * k };
};

/** The start screen's picture of templates: each format once, at a size that fits the card. */
const SAMPLE_FORMATS: { format: FormatId; width: number; turn: number; lift: number }[] = [
  { format: 'story', width: 72, turn: -7, lift: 6 },
  { format: 'feed', width: 92, turn: -2, lift: -4 },
  { format: 'square', width: 100, turn: 3, lift: -4 },
  { format: 'carousel', width: 168, turn: 7, lift: 8 },
];

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
  // First the choice: a template, or a canvas of one's own; drafts under it.
  const [mode, setMode] = useState<'awal' | 'kosong' | 'template'>('awal');
  const back = () => (mode === 'awal' ? onBack() : (setMode('awal'), setBatch(null), setPicked(null)));
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

  // The design just left in the editor (still open in the store): first in the list, marked.
  const justEdited = useKreasi((s) => (s.doc ? s.draftId : null));
  const resume = async (d: Draft) => {
    // Still open: back to it as it is, undo history and all.
    if (d.id === justEdited && useKreasi.getState().template) return useKreasi.setState({ step: 'edit', resumed: true });
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

  // A new filter shows its templates from the first one: back up to the list's
  // heading when it has been scrolled past.
  const scroller = useRef<HTMLElement>(null);
  const list = useRef<HTMLElement>(null);
  useEffect(() => {
    const box = scroller.current, head = list.current;
    if (!box || !head) return;
    const top = head.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 20;
    if (box.scrollTop > top) box.scrollTo({ top, behavior: 'smooth' });
  }, [tab, category, photoFilter, query]);

  // Buat sekaligus: templates ticked, in the order ticked.
  const [batch, setBatch] = useState<string[] | null>(null);
  const [making, setMaking] = useState(false);
  const toggle = (id: string) => setBatch((b) => (b ? (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]) : b));
  const chosen = (batch ?? []).map((id) => all?.find((tp) => tp.id === id)).filter((tp): tp is Template => !!tp);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-line-soft px-6 py-4 lg:px-8">
        <div className="flex items-center gap-3.5">
          <button type="button" onClick={back} aria-label={t('Kembali')} className="text-muted hover:text-fg">
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-[20px] font-semibold">{t(mode === 'awal' ? 'Mulai desain' : mode === 'kosong' ? 'Buat desain sendiri' : 'Pilih template')}</h1>
        </div>
        {/* Nothing chosen yet on the first screen: no steps to show. */}
        {mode !== 'awal' && <Steps at={1} noPhotos={mode === 'kosong'} />}
      </div>

      {mode === 'awal' ? (
        <section className="flex min-h-0 flex-1 flex-col gap-10 overflow-y-auto px-6 pt-10 pb-10 lg:px-8">
          <div className="mx-auto grid w-full max-w-[920px] grid-cols-1 gap-4 sm:grid-cols-2">
            <StartChoice
              title={t('Pakai template')}
              text={t('{count} desain siap pakai. Pilih, isi foto, langsung ekspor.', { n: bundled?.length ?? 0, count: num(bundled?.length ?? 0) })}
              onClick={() => setMode('template')}
            >
              {/* One of each format, fanned: the ways a template can come. */}
              <span className="flex items-center pl-5">
                {SAMPLE_FORMATS.map(({ format, width, turn, lift }) => {
                  const tp = bundled?.find((x) => x.format === format);
                  return tp ? (
                    // `width` is the whole picture's; a carousel's slides share it. Each overlaps the last a little.
                    <span
                      key={format}
                      className="-ml-5 rounded-[4px] shadow-[0_10px_24px_-8px_rgb(0_0_0/0.6)] ring-1 ring-black/30"
                      style={{ width, transform: `rotate(${turn}deg) translateY(${lift}px)` }}
                    >
                      <DocPicture id={tp.id} doc={templateDoc(tp)} width={Math.round(width / tp.slides)} className="block w-full shadow-none" />
                    </span>
                  ) : null;
                })}
              </span>
            </StartChoice>
            <StartChoice
              title={t('Buat desain sendiri')}
              text={t('Mulai dari kanvas kosong: susun foto, teks, dan elemen sendiri, lalu simpan jadi template saya.')}
              onClick={() => setMode('kosong')}
            >
              {(['story', 'feed', 'square'] as const).map((f) => (
                <span key={f} className="flex items-center justify-center rounded-md border-[1.5px] border-dashed border-current text-faint" style={blankShape(f, 2.6)}>
                  {f === 'feed' && <Plus size={20} className="text-gold-text" />}
                </span>
              ))}
            </StartChoice>
          </div>
          {drafts.length > 0 && (
            <div className="mx-auto w-full max-w-[920px]">
              <section className="flex flex-col gap-2.5">
                <h2 className="text-[15px] font-semibold">{t('Lanjutkan desain')}</h2>
                <div className="-mx-1 -mt-1 flex gap-3 overflow-x-auto px-1 pt-1 pb-1">
                  {drafts.map((d) => (
                    <div key={d.id} className="group relative flex w-[132px] shrink-0 flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => resume(d)}
                        className={cx(
                          'relative flex h-[132px] items-center justify-center rounded-xl bg-panel-2 p-2.5 hover:ring-gold',
                          d.id === justEdited ? 'ring-2 ring-gold' : 'ring-1 ring-line-soft',
                        )}
                      >
                        {d.cover ? <img src={d.cover} alt="" className="max-h-full max-w-full rounded-[3px] object-contain" /> : null}
                        {/* The design just left: saved, and here to carry on with. */}
                        {d.id === justEdited && (
                          <span className="absolute bottom-1.5 left-1.5 rounded-md bg-gold px-1.5 py-0.5 text-[10px] font-semibold text-bg">{t('Baru diedit')}</span>
                        )}
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
            </div>
          )}
        </section>
      ) : mode === 'kosong' ? (
        <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-8 pb-10 lg:px-8">
          <div className="mx-auto flex w-full max-w-[920px] flex-col gap-4">
            <p className="text-xs text-muted">{t('Pilih ukuran kanvas. Foto, teks, dan elemen ditambahkan di editor; hasilnya bisa disimpan jadi template saya.')}</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {BLANK_FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => start(blankTemplate(f))}
                  className="group flex h-[150px] flex-col items-center justify-center gap-3 rounded-xl border border-line bg-panel text-muted transition-colors hover:border-gold hover:bg-gold/[0.06] hover:text-fg"
                >
                  <span className="flex items-center justify-center rounded-[4px] border-[1.5px] border-current" style={blankShape(f, 1.3)}>
                    <Plus size={16} className="text-gold-text" />
                  </span>
                  <span className="flex flex-col items-center gap-0.5">
                    <span className="text-[13px] font-semibold text-fg">{t(TABS.find((x) => x.id === f)?.label ?? formatLabel(f))}</span>
                    <span className="text-[11px] text-faint">{t(FORMATS[f].hint)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : (
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
              <FilterItem on={!category || category === 'saya'} onClick={() => setCategory(null)}>
                {t('Semua')}
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

          <section ref={scroller} className="flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pt-5 pb-10 lg:px-8">
            <section ref={list} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <h2 className="text-[17px] font-semibold">{t('Template')}</h2>
                  {/* Ready-made, or the photographer's own: two collections, not a category. */}
                  <div className="flex gap-0.5 rounded-[10px] bg-panel p-[3px]">
                    {(
                      [
                        [false, t('Semua template'), bundled?.length ?? 0],
                        [true, t('Template saya'), mine.length],
                      ] as const
                    ).map(([own, label, n]) => (
                      <button
                        key={String(own)}
                        type="button"
                        onClick={() => setCategory(own ? 'saya' : null)}
                        className={cx(
                          'flex h-[30px] items-center gap-1.5 rounded-lg px-3 text-xs',
                          (category === 'saya') === own ? 'border border-line bg-raised font-semibold text-fg' : 'font-medium text-muted hover:text-fg',
                        )}
                      >
                        {own && <Bookmark size={12} className="text-gold-text" />} {label} <span className="font-normal text-faint">{num(n)}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setBatch((b) => (b ? null : []))}
                    title={t('Pilih beberapa template, lalu buat semuanya sekaligus dengan foto dan data klien')}
                    className={cx(
                      'flex h-9 items-center gap-2 rounded-[10px] border px-3 text-xs font-medium',
                      batch ? 'border-gold bg-gold/[0.08] text-fg' : 'border-line bg-panel text-muted hover:text-fg',
                    )}
                  >
                    <Layers size={14} className="text-gold-text" /> {batch ? t('Batal pilih##sekaligus') : t('Buat sekaligus')}
                  </button>
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
              </div>
              {batch && (
                <p className="-mt-1 text-xs text-muted">{t('Klik template yang mau dibuat. Semuanya diisi foto dan data klien yang sama, lalu diekspor ke satu folder.')}</p>
              )}
              {error && <p className="text-sm text-reject">{error}</p>}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-5">
                {shown.map((tp) => {
                  const n = countOf(tp);
                  const order = batch ? batch.indexOf(tp.id) : -1;
                  return (
                    <div key={tp.id} className="group flex flex-col gap-2">
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => (batch ? toggle(tp.id) : setPicked(tp.id))}
                          aria-pressed={batch ? order >= 0 : undefined}
                          className={cx(
                            // Pointed at: the card lifts and its design comes a little closer.
                            'relative block aspect-[200/248] w-full rounded-xl bg-panel-2 transition-[transform,box-shadow,background-color] duration-200 ease-out group-hover:-translate-y-1 group-hover:bg-raised group-hover:shadow-[0_14px_30px_-12px_rgba(0,0,0,0.7)]',
                            order >= 0 ? 'ring-2 ring-gold' : 'ring-1 ring-line-soft group-hover:ring-gold/70',
                          )}
                        >
                          <DocPicture
                            id={tp.id}
                            doc={templateDoc(tp)}
                            width={tp.format === 'carousel' ? 120 : 180}
                            // Centred against the card's own box: a tall story fits inside it, whole, at any width.
                            className="absolute inset-0 m-auto max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                          />
                        </button>
                        {batch && (
                          <span
                            className={cx(
                              'pointer-events-none absolute top-2 right-2 flex size-6 items-center justify-center rounded-full text-[11px] font-semibold',
                              order >= 0 ? 'bg-gold text-white' : 'border-[1.5px] border-white/70 bg-black/30',
                            )}
                          >
                            {order >= 0 && (order < 9 ? order + 1 : <Check size={13} />)}
                          </span>
                        )}
                      </div>
                      <span className="flex flex-col gap-0.5 px-0.5">
                        <span className="truncate text-[13px] font-medium transition-colors group-hover:text-gold-text">{tp.name}</span>
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
      )}

      {batch && (
        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-line-soft bg-panel px-6 py-3 lg:px-8">
          <span className="mr-auto text-[13px] text-muted">
            {chosen.length ? t('{count} template dipilih', { n: chosen.length, count: num(chosen.length) }) : t('Belum ada template dipilih')}
          </span>
          <button type="button" onClick={() => setBatch(null)} className="h-9 rounded-[10px] px-3 text-[13px] font-medium text-muted hover:text-fg">
            {t('Batal')}
          </button>
          <button
            type="button"
            onClick={() => setMaking(true)}
            disabled={!chosen.length}
            className="flex h-9 items-center gap-2 rounded-[10px] bg-gold-gradient px-4 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            <Layers size={15} /> {t('Lanjut')}
          </button>
        </div>
      )}

      {making && (
        <BatchDialog
          templates={chosen}
          onClose={() => setMaking(false)}
          onDone={() => {
            setBatch(null);
            listDrafts().then(setDrafts);
          }}
        />
      )}

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

/** One of the two ways to start, large, with a picture of what it leads to. */
function StartChoice({ title, text, onClick, children }: { title: string; text: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-panel text-left transition-colors hover:border-gold"
    >
      <span className="flex h-[190px] items-center justify-center gap-4 bg-panel-2/60 text-muted">{children}</span>
      <span className="flex items-center gap-3 p-5">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[16px] font-semibold text-fg">{title}</span>
          <span className="text-xs text-muted">{text}</span>
        </span>
        <ArrowRight size={18} className="shrink-0 text-faint transition-colors group-hover:text-gold-text" />
      </span>
    </button>
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
