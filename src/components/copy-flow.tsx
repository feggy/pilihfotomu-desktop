/**
 * "Salin ke folder" — shared by the export dialog (Picks) and client picks.
 * Either copies the original files (RAW + JPG pair) or writes new JPGs at a
 * chosen size.
 */

import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { Check, FolderInput, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api, type CopyReport, type JpegReport } from '../lib/api';
import { num } from '../lib/format';
import { lang, t, tRust } from '../lib/i18n';
import { useApp } from '../store';
import { Button, Segmented, cx } from './ui';

export type CopyFormat = 'original' | 'jpg';

export interface CopySettings {
  format: CopyFormat;
  scalePercent: number;
  quality: number;
  folder: string;
}

export type CopyResult = { kind: 'original'; report: CopyReport } | { kind: 'jpg'; report: JpegReport };

/** `label` is an i18n key. */
const QUALITY = [
  { value: '92', label: 'Tinggi' },
  { value: '85', label: 'Sedang' },
  { value: '75', label: 'Hemat' },
];
const SCALES = [100, 75, 50, 25];

export const defaultCopySettings = (folder: string): CopySettings => ({
  format: 'original',
  scalePercent: 100,
  quality: 92,
  folder,
});

/** What the chosen photos are made of; the wording below depends on it. */
export interface SourceMix {
  /** RAW with a camera JPG of the same name. */
  pairs: number;
  rawOnly: number;
  jpegOnly: number;
}

export function sourceMix(photos: { raw: string | null; jpeg: string | null }[]): SourceMix {
  const m = { pairs: 0, rawOnly: 0, jpegOnly: 0 };
  for (const p of photos) {
    if (p.raw && p.jpeg) m.pairs++;
    else if (p.raw) m.rawOnly++;
    else m.jpegOnly++;
  }
  return m;
}

function originalHint(m: SourceMix) {
  if (m.pairs) return t('Disalin apa adanya, tanpa diubah. File RAW ikut dengan JPG pasangannya (nama sama).');
  return t('Disalin apa adanya, tanpa diubah.');
}

function jpgHint(m: SourceMix) {
  const parts: string[] = [];
  if (m.jpegOnly || m.pairs) parts.push(t('Foto JPG diperkecil dan dikompres dari JPG aslinya.'));
  if (m.rawOnly)
    parts.push(
      m.jpegOnly || m.pairs
        ? t(
            'Foto RAW tanpa JPG dibuat dari preview kamera di dalam file RAW — warnanya sama dengan layar kamera, dan 100% = ukuran preview itu (beberapa kamera hanya menyimpan ±1600 px).',
          )
        : t(
            'Foto RAW dibuat dari preview kamera di dalam file RAW — warnanya sama dengan layar kamera, dan 100% = ukuran preview itu (beberapa kamera hanya menyimpan ±1600 px).',
          ),
    );
  parts.push(t('File asli tidak diubah.'));
  return parts.join(' ');
}

/**
 * Default folder for copied Picks. A name, not a sentence: the English one
 * must be one the scanner skips (`scan::SKIP_DIRS` has "picks").
 */
export const picksFolder = () => (lang() === 'en' ? 'Picks' : 'Dipilih');

/** The folder name follows the format until the user types their own. */
export function folderFor(base: string, format: CopyFormat) {
  return format === 'jpg' ? `${base} JPG` : base;
}

export function CopySettingsForm({
  value,
  onChange,
  base,
  mix,
}: {
  value: CopySettings;
  onChange: (v: CopySettings) => void;
  base: string;
  mix: SourceMix;
}) {
  const set = (patch: Partial<CopySettings>) => onChange({ ...value, ...patch });
  const autoName = value.folder === folderFor(base, value.format);
  return (
    <div className="flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
      <Field label={t('Yang disalin')}>
        <Segmented<CopyFormat>
          value={value.format}
          onChange={(format) => set({ format, folder: autoName ? folderFor(base, format) : value.folder })}
          options={[
            { value: 'original', label: t('Salin file asli') },
            { value: 'jpg', label: t('Buat JPG baru') },
          ]}
        />
        <p className="flex gap-2 text-[11px] text-faint">
          <Info size={13} className="mt-px shrink-0" />
          {value.format === 'original' ? originalHint(mix) : jpgHint(mix)}
        </p>
      </Field>
      {value.format === 'jpg' && (
        <>
          <Field label={t('Ukuran')} hint={`${value.scalePercent}%`}>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={10}
                max={100}
                step={5}
                value={value.scalePercent}
                onChange={(e) => set({ scalePercent: Number(e.target.value) })}
                className="flex-1 accent-[var(--color-gold)]"
                aria-label={t('Ukuran dalam persen')}
              />
              <div className="flex gap-1">
                {SCALES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => set({ scalePercent: s })}
                    className={cx(
                      'h-7 rounded-md px-2 text-xs font-medium',
                      value.scalePercent === s ? 'bg-gold text-ink' : 'bg-raised text-muted hover:text-fg',
                    )}
                  >
                    {s}%
                  </button>
                ))}
              </div>
            </div>
          </Field>
          <Field label={t('Kualitas')}>
            <Segmented
              value={String(value.quality)}
              onChange={(q) => set({ quality: Number(q) })}
              options={QUALITY.map((q) => ({ value: q.value, label: t(q.label) }))}
            />
          </Field>
        </>
      )}
      <Field label={t('Nama folder')} hint={t('dibuat di dalam folder sesi')}>
        <input
          aria-label={t('Nama folder')}
          value={value.folder}
          onChange={(e) => set({ folder: e.target.value })}
          className="h-[34px] rounded-[10px] border border-line bg-bg px-3 text-[13px] outline-none focus:border-gold"
        />
      </Field>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex justify-between text-xs font-medium text-muted">
        {label}
        {hint && <span className="font-normal text-faint">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

export async function runCopy(
  root: string,
  ids: number[],
  s: CopySettings,
  onProgress: (done: number, total: number) => void,
): Promise<CopyResult> {
  if (s.format === 'original') {
    return { kind: 'original', report: await api.copyToFolder(root, ids, s.folder) };
  }
  const report = await api.exportJpegs(root, ids, s.folder, { scalePercent: s.scalePercent, quality: s.quality }, (p) =>
    onProgress(p.done, p.total),
  );
  return { kind: 'jpg', report };
}

export function CopyResultView({ result, onDone }: { result: CopyResult; onDone: () => void }) {
  const r = result.report;
  const lines =
    result.kind === 'original'
      ? [
          t('{count} file disalin.', { n: result.report.copied, count: num(result.report.copied) }),
          result.report.alreadyThere
            ? t('{count} file sudah ada di sana, tidak disalin ulang.', {
                n: result.report.alreadyThere,
                count: num(result.report.alreadyThere),
              })
            : '',
        ]
      : [
          t('{count} JPG dibuat.', { n: result.report.written, count: num(result.report.written) }),
          result.report.largest
            ? t('Ukuran hasil: {size} px.', { size: sizeRange(result.report.smallest!, result.report.largest) })
            : '',
          result.report.alreadyThere
            ? t('{count} JPG sudah ada dengan nama sama, dilewati.', {
                n: result.report.alreadyThere,
                count: num(result.report.alreadyThere),
              })
            : '',
        ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-xl bg-pick/10 p-4">
        <Check size={18} className="mt-0.5 shrink-0 text-pick" />
        <div className="flex flex-col gap-1 text-[13px]">
          {lines.filter(Boolean).map((l) => (
            <span key={l}>{l}</span>
          ))}
          <span className="text-xs text-faint">{r.folder}</span>
        </div>
      </div>
      {r.failed.length > 0 && (
        <div className="max-h-32 overflow-y-auto rounded-xl bg-reject/10 p-3 text-xs text-reject">
          <p className="mb-1 font-semibold">{t('{count} gagal:', { count: num(r.failed.length) })}</p>
          {r.failed.map((f) => (
            <p key={f}>{failedLine(f)}</p>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2.5">
        <Button onClick={() => revealItemInDir(r.folder)}>{t('Buka folder')}</Button>
        <Button variant="primary" onClick={onDone}>
          {t('Selesai')}
        </Button>
      </div>
    </div>
  );
}

/** "IMG_0101.JPG: <message from Rust>" — the message part in the current language. */
export const failedLine = (f: string) => {
  const at = f.indexOf(': ');
  return at < 0 ? tRust(f) : `${f.slice(0, at)}: ${tRust(f.slice(at + 2))}`;
};

const sizeRange = (a: [number, number], b: [number, number]) =>
  a[0] === b[0] && a[1] === b[1] ? `${a[0]}×${a[1]}` : `${a[0]}×${a[1]} – ${b[0]}×${b[1]}`;

export function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] text-muted">
        {t('Membuat JPG… {done} dari {total}', { done: num(done), total: num(total) })}
      </span>
      <div className="h-2 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,#8c6a30,#d9bd88)] transition-[width]"
          style={{ width: `${total ? (done / total) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

/** Standalone dialog, used by client picks. */
export function CopyDialog({
  root,
  ids,
  mix,
  base,
  onClose,
}: {
  root: string;
  ids: number[];
  mix: SourceMix;
  base: string;
  onClose: () => void;
}) {
  const fail = useApp((s) => s.fail);
  const [settings, setSettings] = useState(() => defaultCopySettings(base));
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<CopyResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const run = async () => {
    setBusy({ done: 0, total: ids.length });
    try {
      setResult(await runCopy(root, ids, settings, (done, total) => setBusy({ done, total })));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-label={t('Salin ke folder')}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-[560px] max-w-full flex-col gap-4 overflow-y-auto rounded-[18px] border border-line bg-panel p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">
              {t('Salin {count} foto ke folder', { n: ids.length, count: num(ids.length) })}
            </h2>
            <p className="text-xs text-faint">{t('Folder baru dibuat di dalam folder sesi.')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>
        {result ? (
          <CopyResultView result={result} onDone={onClose} />
        ) : busy ? (
          <ProgressBar {...busy} />
        ) : (
          <>
            <CopySettingsForm value={settings} onChange={setSettings} base={base} mix={mix} />
            <div className="flex justify-end gap-2.5">
              <Button variant="plain" onClick={onClose}>
                {t('Batal')}
              </Button>
              <Button variant="primary" icon={FolderInput} onClick={run} disabled={!settings.folder.trim()}>
                {settings.format === 'jpg'
                  ? t('Buat {count} JPG', { n: ids.length, count: num(ids.length) })
                  : t('Salin {count} foto', { n: ids.length, count: num(ids.length) })}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
