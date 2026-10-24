import { ArrowLeft, ArrowRight, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cx } from '../components/ui';
import { num } from '../lib/format';
import { t } from '../lib/i18n';
import type { FormatId } from './engine/document';
import { api } from '../lib/api';
import { useApp } from '../store';
import { listDrafts, reopenSource, templateOfDraft, type Draft } from './drafts';
import { CATEGORIES, formatLabel, loadTemplates, slotShapes, templateDoc, type Template, type TemplateCategory } from './kit';
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
  const [all, setAll] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<FormatTab>('semua');
  const [category, setCategory] = useState<TemplateCategory | null>(null);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const fail = useApp((s) => s.fail);
  useEffect(() => {
    loadTemplates().then(setAll, (e) => setError(String(e)));
    listDrafts().then(setDrafts);
  }, []);

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
    for (const tp of all ?? []) if (tab === 'semua' || tp.format === tab) c.set(tp.category, (c.get(tp.category) ?? 0) + 1);
    return c;
  }, [all, tab]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (all ?? []).filter(
      (tp) =>
        (tab === 'semua' || tp.format === tab) &&
        (!category || tp.category === category) &&
        filterCount(countOf(tp)) &&
        (!q || tp.name.toLowerCase().includes(q) || tp.description.toLowerCase().includes(q)),
    );
  }, [all, tab, category, query, photoFilter]);

  const current = shown.find((tp) => tp.id === picked) ?? shown[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pt-6 pb-10 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <button type="button" onClick={onBack} aria-label={t('Kembali')} className="text-muted hover:text-fg">
              <ArrowLeft size={18} />
            </button>
            <h1 className="text-[22px] font-semibold">{t('Pilih template')}</h1>
          </div>
          <Steps at={1} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-[10px] bg-panel p-[3px]">
            {TABS.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setTab(x.id)}
                className={cx(
                  'h-[30px] rounded-lg px-3.5 text-[13px]',
                  tab === x.id ? 'border border-line bg-raised font-semibold text-fg' : 'font-medium text-muted hover:text-fg',
                )}
              >
                {t(x.label)}
              </button>
            ))}
          </div>
          <label className="flex h-9 w-60 items-center gap-2 rounded-[10px] border border-line bg-panel px-3 focus-within:border-gold">
            <Search size={15} className="shrink-0 text-faint" />
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

        <div className="flex flex-wrap gap-2">
          <Chip on={!category} onClick={() => setCategory(null)}>
            {t('Semua')}
          </Chip>
          {CATEGORIES.filter((c) => counts.get(c.id)).map((c) => (
            <Chip key={c.id} on={category === c.id} onClick={() => setCategory(category === c.id ? null : c.id)}>
              {t(c.label)} <span className="opacity-60">{num(counts.get(c.id)!)}</span>
            </Chip>
          ))}
        </div>

        <div className="-mt-1 flex items-center gap-2 text-xs text-faint">
          {t('Jumlah foto')}
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setPhotoFilter(photoFilter === n ? null : n)}
              className={cx(
                'h-6 min-w-8 rounded-md px-2 font-medium',
                photoFilter === n ? 'bg-raised text-fg ring-1 ring-gold' : 'bg-panel-2 text-muted hover:text-fg',
              )}
            >
              {n === 4 ? '4+' : n}
            </button>
          ))}
        </div>

        {drafts.length > 0 && !query && (
          <section className="flex flex-col gap-2.5">
            <h2 className="text-[13px] font-semibold">{t('Lanjutkan desain')}</h2>
            <div className="-mx-1 -mt-1 flex gap-3 overflow-x-auto px-1 pt-1 pb-1">
              {drafts.map((d) => (
                <div key={d.id} className="group relative flex w-[150px] shrink-0 flex-col gap-1.5">
                  <button type="button" onClick={() => resume(d)} className="flex h-[150px] items-center justify-center rounded-xl bg-panel-2 p-2.5 ring-1 ring-line-soft hover:ring-gold">
                    {d.cover ? <img src={d.cover} alt="" className="max-h-full max-w-full rounded-[3px] object-contain" /> : null}
                  </button>
                  <span className="truncate text-xs font-medium">{d.name}</span>
                  <span className="text-[11px] text-faint">{new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d.updatedAt)}</span>
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

        {error && <p className="text-sm text-reject">{error}</p>}
        {all && shown.length === 0 && (
          <p className="py-16 text-center text-sm text-faint">{t('Tidak ada template yang cocok.')}</p>
        )}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-5">
          {shown.map((tp) => {
            const on = tp.id === current?.id;
            const n = countOf(tp);
            return (
              <button
                key={tp.id}
                type="button"
                onClick={() => setPicked(tp.id)}
                onDoubleClick={() => choose(tp)}
                className="flex flex-col gap-2 text-left"
              >
                <span
                  className={cx(
                    'flex aspect-[200/248] w-full items-center justify-center rounded-xl bg-panel-2 p-3',
                    on ? 'ring-2 ring-gold' : 'ring-1 ring-line-soft hover:ring-line',
                  )}
                >
                  <DocPicture id={tp.id} doc={templateDoc(tp)} width={tp.format === 'carousel' ? 120 : 180} className="max-h-full max-w-full" />
                </span>
                <span className="flex flex-col gap-0.5 px-0.5">
                  <span className="truncate text-[13px] font-medium">{tp.name}</span>
                  <span className="text-[11px] text-faint">
                    {formatLabel(tp.format)}
                    {tp.format === 'carousel' ? ` · ${t('{n} slide', { n: tp.slides })}` : ''} · {t('{count} foto', { n, count: num(n) })}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {current && <TemplatePanel key={current.id} template={current} onUse={() => choose(current)} />}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium',
        on ? 'bg-gold text-bg' : 'border border-line bg-panel-2 text-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

/** Right panel: the selected template large, with what it needs. */
function TemplatePanel({ template, onUse }: { template: Template; onUse: () => void }) {
  const doc = templateDoc(template);
  const shapes = slotShapes(doc);
  return (
    <aside className="flex w-[360px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-line-soft bg-panel p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-[17px] font-semibold">{template.name}</h2>
        <p className="text-xs text-faint">
          {formatLabel(template.format)} · {t(CATEGORIES.find((c) => c.id === template.category)?.label ?? '')}
        </p>
      </div>
      <div className="flex h-[340px] shrink-0 items-center justify-center rounded-xl bg-panel-2 p-4">
        <DocPicture id={template.id} doc={doc} width={template.format === 'carousel' ? 150 : 300} numbered className="max-h-full max-w-full" />
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
      <button
        type="button"
        onClick={onUse}
        className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] bg-gold-gradient text-sm font-semibold text-white"
      >
        {t('Pakai template ini')} <ArrowRight size={16} />
      </button>
    </aside>
  );
}
