/**
 * Buat sekaligus: several templates made into designs in one go — the
 * client's name and date put in, the session's photos placed (a different
 * photo in each design while there are enough), every design exported into
 * one folder and kept as a draft to touch up later.
 */

import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { Check, FolderOpen, Info, Layers, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { DateInput } from '../components/date-picker';
import { Button, Segmented, Switch } from '../components/ui';
import { api, thumbUrl } from '../lib/api';
import { num } from '../lib/format';
import { t, tRust } from '../lib/i18n';
import { useApp } from '../store';
import { useBrand } from './brand';
import { newDraftId, saveDraft } from './drafts';
import { FORMATS } from './engine/document';
import { exportDoc, exportWidth, saveBlobs, slug, type Format } from './export';
import { templateDoc, type Template } from './kit';
import { personalize } from './personalize';
import { folderSource, sessionSource } from './sources';
import { fillDoc, placed, ranked, useKreasi, type Source } from './store';
import { DocPicture } from './ui';

/** How many of the best photos get their shape learned before filling. */
const LEARN = 240;

/** `source` with the shape (width ÷ height) of its likeliest photos, from their thumbnails. */
async function withRatios(source: Source): Promise<Source> {
  const todo = ranked(source.photos.filter((p) => p.status !== 'reject')).slice(0, LEARN);
  // A scanned folder has no thumbnails yet.
  const missing = todo.filter((p) => !p.thumb).map((p) => p.id);
  const thumbs = missing.length ? await api.thumbnails(source.root, missing).catch(() => ({}) as Record<number, string | null>) : {};
  const ratios = new Map<number, number>();
  await Promise.all(
    todo.map(
      (p) =>
        new Promise<void>((done) => {
          const src = thumbUrl(p.thumb ?? thumbs[p.id] ?? null);
          if (p.ratio != null || !src) return done();
          const img = new Image();
          img.onload = () => (ratios.set(p.id, img.naturalWidth / Math.max(1, img.naturalHeight)), done());
          img.onerror = () => done();
          img.src = src;
        }),
    ),
  );
  return {
    ...source,
    photos: source.photos.map((p) => ({ ...p, thumb: p.thumb ?? thumbs[p.id] ?? null, ratio: p.ratio ?? ratios.get(p.id) })),
  };
}

export function BatchDialog({ templates, onClose, onDone }: { templates: Template[]; onClose: () => void; onDone: () => void }) {
  const fail = useApp((s) => s.fail);
  const studio = useBrand((s) => s.studio);
  const [source, setSource] = useState<Source | null>(() => useKreasi.getState().source ?? sessionSource());
  const [name, setName] = useState(() => useKreasi.getState().client.name);
  const [date, setDate] = useState<number | null>(() => useKreasi.getState().client.date ?? source?.shotAt ?? null);
  const [format, setFormat] = useState<Exclude<Format, 'pdf'>>('jpg');
  const [folder, setFolder] = useState(() => t('Konten'));
  const [keep, setKeep] = useState(true);
  const [done, setDone] = useState<number | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  const busy = done != null && !saved;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const dateValue = date != null ? new Date(date * 1000).toISOString().slice(0, 10) : '';
  const photos = source?.photos.filter((p) => p.status !== 'reject').length ?? 0;
  const needed = templates.reduce((n, tp) => n + placed(templateDoc(tp)).length, 0);

  const pickFolder = async () => {
    const s = await folderSource().catch((e) => (fail(e), null));
    if (!s) return;
    setSource(s);
    if (date == null) setDate(s.shotAt ?? null);
  };

  const run = async () => {
    if (!source) return;
    setDone(0);
    try {
      const client = { name: name.trim(), date };
      useKreasi.getState().setClient({ ...client, applied: client.name });
      const src = await withRatios(source);
      const used = new Set<number>();
      const paths: string[] = [];
      const who = slug(client.name);
      for (const tp of templates) {
        const start = personalize(structuredClone(templateDoc(tp)), client, studio);
        const doc = fillDoc(start, src, used);
        for (const id of placed(doc)) if (id != null) used.add(id);
        const blobs = await exportDoc(doc, src, format, exportWidth(doc, FORMATS[doc.format].printInches ? 2 : 1));
        const file = who && client.name ? `${who}-${slug(tp.name)}` : slug(tp.name);
        paths.push(...(await saveBlobs(src, folder, file, format, blobs)));
        if (keep) {
          const title = client.name ? `${tp.name} · ${client.name}` : tp.name;
          await saveDraft({ id: newDraftId(), name: title, templateId: tp.id, templateName: tp.name, doc, source: src });
        }
        setDone((n) => (n ?? 0) + 1);
      }
      setSaved(paths);
      onDone();
    } catch (e) {
      fail(tRust(String(e)));
      setDone(null);
    }
  };

  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-label={t('Buat sekaligus')}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-[600px] max-w-full flex-col gap-5 overflow-y-auto rounded-[18px] border border-line bg-panel p-7 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">{t('Buat sekaligus')}</h2>
            <p className="text-xs text-faint">{t('{count} template jadi desain, foto dan data klien terisi otomatis.', { n: templates.length, count: num(templates.length) })}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <div className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-1">
          {templates.map((tp) => (
            <div key={tp.id} className="flex h-[92px] w-[76px] shrink-0 items-center justify-center rounded-lg bg-panel-2 p-1.5 ring-1 ring-line-soft">
              <DocPicture id={tp.id} doc={templateDoc(tp)} width={tp.format === 'carousel' ? 60 : 90} className="max-h-full max-w-full" />
            </div>
          ))}
        </div>

        {saved ? (
          <>
            <div className="flex items-start gap-3 rounded-xl bg-pick/10 p-4">
              <Check size={18} className="mt-0.5 shrink-0 text-pick" />
              <div className="flex min-w-0 flex-col gap-1 text-[13px]">
                <span className="font-medium">{t('{count} desain tersimpan, {files} file', { n: templates.length, count: num(templates.length), files: num(saved.length) })}</span>
                <span className="truncate text-[11px] text-faint">{saved[0]!.replace(/[\\/][^\\/]*$/, '')}</span>
                {keep && <span className="text-xs text-muted">{t('Masih bisa dirapikan satu per satu dari Lanjutkan desain.')}</span>}
              </div>
            </div>
            <div className="flex justify-end gap-2.5">
              <Button icon={FolderOpen} onClick={() => revealItemInDir(saved[0]!)}>
                {t('Buka folder')}
              </Button>
              <Button variant="primary" onClick={onClose}>
                {t('Selesai')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Field label={t('Foto dari')}>
              <div className="flex h-[38px] items-center gap-3 rounded-[10px] bg-panel-2 px-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate">
                  {source ? `${source.name} · ${t('{count} foto', { n: photos, count: num(photos) })}` : t('Belum ada sesi yang dibuka')}
                </span>
                <button type="button" onClick={pickFolder} disabled={busy} className="shrink-0 text-xs font-medium text-gold-text hover:underline">
                  {t('Pilih folder lain')}
                </button>
              </div>
            </Field>
            <div className="grid grid-cols-[1fr_180px] gap-3">
              <Field label={t('Nama klien')}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('mis. Rina & Dimas')}
                  className="h-[38px] rounded-[10px] border border-line bg-bg px-3 text-[13px] outline-none placeholder:text-faint focus:border-gold"
                />
              </Field>
              <Field label={t('Tanggal acara')}>
                <DateInput value={dateValue} onChange={(v) => setDate(v ? Date.parse(`${v}T00:00:00Z`) / 1000 : null)} className="h-[38px] rounded-[10px]" />
              </Field>
            </div>
            <div className="grid grid-cols-[180px_1fr] gap-3">
              <Field label={t('Format')}>
                <Segmented<Exclude<Format, 'pdf'>>
                  value={format}
                  onChange={setFormat}
                  options={[
                    { value: 'jpg', label: 'JPG' },
                    { value: 'png', label: 'PNG' },
                  ]}
                />
              </Field>
              <Field label={t('Simpan ke')} hint={source ? t('di dalam {folder}', { folder: source.saveDir.split(/[\\/]/).pop() ?? '' }) : undefined}>
                <input value={folder} onChange={(e) => setFolder(e.target.value)} className="h-[38px] rounded-[10px] border border-line bg-bg px-3 text-[13px] outline-none focus:border-gold" />
              </Field>
            </div>
            <label className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex flex-col">
                {t('Simpan juga sebagai draf')}
                <span className="text-[11px] text-faint">{t('Supaya tiap desain masih bisa dirapikan nanti.')}</span>
              </span>
              <Switch label={t('Simpan juga sebagai draf')} checked={keep} onChange={setKeep} />
            </label>
            <p className="flex gap-2 rounded-[10px] bg-panel-2 p-3 text-[11px] text-faint">
              <Info size={13} className="mt-px shrink-0" />
              {photos > 0 && photos < needed
                ? t('Desain butuh {need} foto, tersedia {have}: sebagian foto dipakai di lebih dari satu desain.', { need: num(needed), have: num(photos) })
                : t('Foto Pilih dipakai lebih dulu, berbeda di tiap desain, dan dipilih yang bentuknya pas. Ukuran Instagram 1080 px; template cetak 300 dpi.')}
            </p>
            <div className="flex items-center justify-end gap-2.5">
              {busy && <span className="mr-auto text-xs text-muted">{t('Membuat {done} dari {total}…', { done: num(done ?? 0), total: num(templates.length) })}</span>}
              <Button variant="plain" onClick={onClose} disabled={busy}>
                {t('Batal')}
              </Button>
              <Button variant="primary" icon={Layers} onClick={run} disabled={busy || !source || !photos || !folder.trim()}>
                {busy ? t('Membuat…') : t('Buat {count} desain', { n: templates.length, count: num(templates.length) })}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex justify-between text-xs font-medium text-muted">
        {label}
        {hint && <span className="font-normal text-faint">{hint}</span>}
      </span>
      {children}
    </div>
  );
}
