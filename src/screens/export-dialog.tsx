import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { Aperture, Check, CloudUpload, FolderInput, Info, Upload, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import {
  CopyResultView,
  CopySettingsForm,
  ProgressBar,
  defaultCopySettings,
  failedLine,
  picksFolder,
  runCopy,
  sourceMix,
  type CopyResult,
} from '../components/copy-flow';
import { Button, Chip, Dot, Segmented, Stars, cx } from '../components/ui';
import { toCrs } from '../edit/lightroom';
import { isEdited } from '../edit/looks';
import type { PhotoAdjust } from '../kreasi/engine/document';
import { api, type ExportReport } from '../lib/api';
import { num, STATUS } from '../lib/format';
import { t } from '../lib/i18n';
import { useApp } from '../store';

/** Mirrors `scan::JPEG_MARKED_DIR` (fixed in Rust, same in every language). */
const JPEG_MARKED_DIR = 'JPG bertanda';

type Target = 'xmp' | 'copy';
type Which = 'pick' | 'pickMaybe';
type App = 'lightroom' | 'captureOne' | 'photoMechanic';

/** One .xmp works for all three; what differs is how each app picks it up. `tip` is an i18n key. */
const APPS: { value: App; label: string; tip: string }[] = [
  {
    value: 'lightroom',
    label: 'Lightroom Classic',
    tip: 'Terbaca otomatis saat import. Foto sudah terlanjur di-import? Pilih semua fotonya lalu klik Metadata › Read Metadata from Files.',
  },
  {
    value: 'captureOne',
    label: 'Capture One',
    tip: 'Nyalakan Settings › Image › Metadata › Auto Sync Sidecar XMP: Load (atau Full Sync). Label warna jadi Color Tag, bintang jadi Rating. Foto yang sudah ada di katalog: muat ulang metadatanya dari menu Image.',
  },
  {
    value: 'photoMechanic',
    label: 'Photo Mechanic',
    tip: 'Foto Pilih otomatis ber-Tag, bintang terbaca. Label warna dibaca dari namanya (Green / Yellow / Red): samakan nama Color Class di Photo Mechanic supaya warnanya tampil.',
  },
];

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const session = useApp((s) => s.session)!;
  const markExported = useApp((s) => s.markExported);
  const fail = useApp((s) => s.fail);
  const [target, setTarget] = useState<Target>('xmp');
  const [withReasons, setWithReasons] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [jpegCopies, setJpegCopies] = useState(true);
  const [app, setApp] = useState<App>('lightroom');
  const [which, setWhich] = useState<Which>('pick');
  const [copy, setCopy] = useState(() => defaultCopySettings(picksFolder()));
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [xmpDone, setXmpDone] = useState<ExportReport | null>(null);
  const [copyDone, setCopyDone] = useState<CopyResult | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const counts = { pick: 0, maybe: 0, reject: 0 };
  for (const p of session.photos) counts[p.status]++;
  const rawCount = session.photos.filter((p) => p.raw).length;
  const jpegOnly = session.photos.length - rawCount;
  const toCopy = session.photos.filter((p) => p.status === 'pick' || (which === 'pickMaybe' && p.status === 'maybe'));
  const copyIds = toCopy.map((p) => p.id);

  const run = async () => {
    setBusy({ done: 0, total: target === 'copy' ? copyIds.length : 0 });
    try {
      if (target === 'xmp') {
        const xmp = await api.exportXmp(overwrite ? 'overwrite' : 'skip', withReasons, jpegOnly > 0 && jpegCopies);
        // Photos edited in Edit foto: their settings go into the same sidecars
        // (only ones this app wrote; Lightroom's own stay as they are).
        const edited = session.photos.filter((p) => p.raw && isEdited(session.edits?.[p.id] as PhotoAdjust | undefined));
        if (edited.length) {
          await api.writeDevelopXmp(
            edited.map((p) => ({ id: p.id, develop: toCrs(session.edits![p.id] as PhotoAdjust, true) })),
            withReasons,
          );
        }
        if (xmp.written || xmp.markedJpeg) markExported();
        setXmpDone(xmp);
      } else {
        setCopyDone(await runCopy(session.root, copyIds, copy, (done, total) => setBusy({ done, total })));
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const label =
    target === 'xmp'
      ? rawCount
        ? t('Ekspor {count} file XMP', { n: rawCount, count: num(rawCount) }) +
          (jpegOnly && jpegCopies ? ` + ${num(jpegOnly)} JPG` : '')
        : t('Salin {count} JPG bertanda', { n: jpegOnly, count: num(jpegOnly) })
      : copy.format === 'jpg'
        ? t('Buat {count} JPG', { n: copyIds.length, count: num(copyIds.length) })
        : t('Salin {count} foto', { n: copyIds.length, count: num(copyIds.length) });

  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-label={t('Ekspor hasil pilihan')}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-[640px] max-w-full flex-col gap-4 overflow-y-auto rounded-[18px] border border-line bg-panel p-7 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">{t('Ekspor hasil pilihan')}</h2>
            <p className="text-xs text-faint">
              {session.name} ·{' '}
              {t('{pick} dipilih · {maybe} dicek · {reject} dilewati', {
                pick: num(counts.pick),
                maybe: num(counts.maybe),
                reject: num(counts.reject),
              })}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>

        {xmpDone ? (
          <XmpResult report={xmpDone} root={session.root} onClose={onClose} />
        ) : copyDone ? (
          <CopyResultView result={copyDone} onDone={onClose} />
        ) : busy && target === 'copy' && copy.format === 'jpg' ? (
          <ProgressBar {...busy} />
        ) : (
          <>
            <Option
              icon={Aperture}
              title="Lightroom · Capture One · Photo Mechanic (XMP)"
              sub={t('Buat file .xmp di samping tiap RAW. Satu file terbaca di ketiga aplikasi. File asli tidak disentuh.')}
              active={target === 'xmp'}
              onClick={() => setTarget('xmp')}
            >
              <div className="flex flex-col gap-1.5 pt-2.5">
                {(
                  [
                    ['pick', 'Label hijau', 5],
                    ['maybe', 'Label kuning', 3],
                    ['reject', 'Label merah', 1],
                  ] as const
                ).map(([st, lbl, stars]) => (
                  <div key={st} className="flex h-9 items-center gap-4 rounded-lg bg-panel-2 px-3">
                    <span className="flex w-28 items-center gap-2 text-[13px] font-medium">
                      <Dot color={STATUS[st].color} /> {STATUS[st].label}
                    </span>
                    <span className="text-faint">→</span>
                    <span className="flex items-center gap-2.5 text-xs text-muted">
                      <span className="size-3.5 rounded-[3px]" style={{ background: STATUS[st].color }} />
                      {t(lbl)}
                      <Stars value={stars} size={11} />
                    </span>
                  </div>
                ))}
                <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1.5">
                  <Checkbox on={withReasons} onChange={setWithReasons}>
                    {t('Tambah keyword alasan (blur, duplikat…)')}
                  </Checkbox>
                  <Checkbox on={overwrite} onChange={setOverwrite}>
                    {t('Timpa file .xmp yang sudah ada')}
                  </Checkbox>
                </div>
                {overwrite && <p className="text-[11px] text-reject">{t('Edit Lightroom yang tersimpan di file .xmp lama akan hilang.')}</p>}
                {jpegOnly > 0 && (
                  <div className="flex flex-col gap-1 rounded-lg bg-panel-2 p-2.5">
                    <Checkbox on={jpegCopies} onChange={setJpegCopies}>
                      {t('{count} foto hanya JPEG: salin ke folder “{folder}” dengan label & bintang di dalamnya', {
                        n: jpegOnly,
                        count: num(jpegOnly),
                        folder: JPEG_MARKED_DIR,
                      })}
                    </Checkbox>
                    <p className="pl-6 text-[11px] text-faint">
                      {t(
                        'Aplikasi foto membaca label JPEG dari dalam file, bukan dari .xmp, dan file asli tidak pernah diubah. Import folder itu sebagai ganti JPEG aslinya. Ekspor ulang memperbarui salinannya.',
                      )}
                      {!jpegCopies && ` ${t('Kalau tidak dicentang, foto JPEG dilewati.')}`}
                    </p>
                  </div>
                )}
              </div>
            </Option>
            <Option
              icon={FolderInput}
              title={t('Salin ke folder')}
              sub={t('Salin file asli, atau buat JPG baru dengan ukuran yang bisa diatur.')}
              active={target === 'copy'}
              onClick={() => setTarget('copy')}
            >
              <div className="flex flex-col gap-3 pt-2.5" onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted">{t('Foto')}</span>
                  <Segmented<Which>
                    value={which}
                    onChange={setWhich}
                    options={[
                      { value: 'pick', label: `${STATUS.pick.label} (${num(counts.pick)})` },
                      { value: 'pickMaybe', label: `${STATUS.pick.label} + ${STATUS.maybe.label} (${num(counts.pick + counts.maybe)})` },
                    ]}
                  />
                </div>
                <CopySettingsForm value={copy} onChange={setCopy} base={picksFolder()} mix={sourceMix(toCopy)} />
              </div>
            </Option>
            <Option
              icon={CloudUpload}
              title={t('Kirim ke pilihfotomu')}
              sub={t('Upload foto yang dipilih ke galeri booking supaya klien memilih dari foto yang sudah bersih. Butuh internet.')}
              active={false}
              disabled
            />
            {target === 'xmp' && (
              <div className="flex flex-col gap-2.5 rounded-[10px] bg-maybe/10 p-3">
                <Segmented<App> value={app} onChange={setApp} options={APPS.map(({ value, label }) => ({ value, label }))} />
                <p className="flex items-start gap-2.5 text-xs text-muted">
                  <Info size={16} className="shrink-0 text-maybe" />
                  {t(APPS.find((a) => a.value === app)!.tip)}
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2.5">
              <Button variant="plain" onClick={onClose} disabled={!!busy}>
                {t('Batal')}
              </Button>
              <Button
                variant="primary"
                icon={Upload}
                onClick={run}
                disabled={
                  !!busy ||
                  (target === 'copy' && (!copyIds.length || !copy.folder.trim())) ||
                  (target === 'xmp' && !rawCount && !jpegCopies)
                }
              >
                {busy ? t('Mengekspor…') : label}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function XmpResult({ report, root, onClose }: { report: ExportReport; root: string; onClose: () => void }) {
  const lines = [
    t('{count} file XMP ditulis.', { n: report.written, count: num(report.written) }),
    report.skippedExisting
      ? t('{count} dilewati karena file .xmp sudah ada.', { n: report.skippedExisting, count: num(report.skippedExisting) })
      : '',
    report.markedJpeg
      ? t('{count} JPG disalin dengan label & bintang ke “{folder}”.', {
          n: report.markedJpeg,
          count: num(report.markedJpeg),
          folder: JPEG_MARKED_DIR,
        })
      : '',
    report.skippedJpeg ? t('{count} foto JPEG-saja dilewati.', { n: report.skippedJpeg, count: num(report.skippedJpeg) }) : '',
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-xl bg-pick/10 p-4">
        <Check size={18} className="mt-0.5 shrink-0 text-pick" />
        <div className="flex flex-col gap-1 text-[13px]">
          {lines.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      </div>
      {report.failed.length > 0 && (
        <div className="max-h-32 overflow-y-auto rounded-xl bg-reject/10 p-3 text-xs text-reject">
          <p className="mb-1 font-semibold">{t('{count} gagal:', { count: num(report.failed.length) })}</p>
          {report.failed.map((f) => (
            <p key={f}>{failedLine(f)}</p>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2.5">
        <Button onClick={() => revealItemInDir(report.markedFolder ?? root)}>{t('Buka folder')}</Button>
        <Button variant="primary" onClick={onClose}>
          {t('Selesai')}
        </Button>
      </div>
    </div>
  );
}

function Option({
  icon: Icon,
  title,
  sub,
  active,
  disabled,
  onClick,
  children,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  active: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      role="radio"
      aria-checked={active}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => !disabled && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ') && onClick?.()}
      className={cx(
        'flex gap-3 rounded-xl border p-3.5',
        active ? 'border-2 border-gold bg-gold/[0.08]' : 'border-line-soft bg-panel',
        disabled ? 'opacity-55' : !active && 'cursor-pointer hover:border-line',
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-raised">
        <Icon size={18} className={active ? 'text-gold-text' : 'text-muted'} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {title} {disabled && <Chip color="var(--color-faint)">{t('Segera')}</Chip>}
        </span>
        <span className="text-xs text-muted">{sub}</span>
        {active && children}
      </div>
      <span className={cx('size-[18px] shrink-0 rounded-full border-[1.5px]', active ? 'border-gold bg-gold' : 'border-faint')} />
    </div>
  );
}

function Checkbox({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        className={cx(
          'flex size-4 items-center justify-center rounded border peer-focus-visible:outline-2 peer-focus-visible:outline-gold',
          on ? 'border-gold bg-gold' : 'border-faint',
        )}
      >
        {on && <Check size={11} strokeWidth={3} className="text-bg" />}
      </span>
      {children}
    </label>
  );
}
