import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { Aperture, Check, CloudUpload, FolderInput, Info, Upload, X, type LucideIcon } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import {
  CopyResultView,
  CopySettingsForm,
  ProgressBar,
  defaultCopySettings,
  runCopy,
  sourceMix,
  type CopyResult,
} from '../components/copy-flow';
import { Button, Chip, Dot, Segmented, Stars, cx } from '../components/ui';
import { api, type ExportReport } from '../lib/api';
import { num, STATUS } from '../lib/format';
import { useApp } from '../store';

type Target = 'xmp' | 'copy';
type Which = 'pick' | 'pickMaybe';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const session = useApp((s) => s.session)!;
  const markExported = useApp((s) => s.markExported);
  const fail = useApp((s) => s.fail);
  const [target, setTarget] = useState<Target>('xmp');
  const [withReasons, setWithReasons] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [which, setWhich] = useState<Which>('pick');
  const [copy, setCopy] = useState(() => defaultCopySettings('Dipilih'));
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
  const toCopy = session.photos.filter((p) => p.status === 'pick' || (which === 'pickMaybe' && p.status === 'maybe'));
  const copyIds = toCopy.map((p) => p.id);

  const run = async () => {
    setBusy({ done: 0, total: target === 'copy' ? copyIds.length : 0 });
    try {
      if (target === 'xmp') {
        const xmp = await api.exportXmp(overwrite ? 'overwrite' : 'skip', withReasons);
        if (xmp.written) markExported();
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
      ? `Ekspor ${num(rawCount)} file XMP`
      : copy.format === 'jpg'
        ? `Buat ${num(copyIds.length)} JPG`
        : `Salin ${num(copyIds.length)} foto`;

  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-label="Ekspor hasil pilihan"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-[640px] max-w-full flex-col gap-4 overflow-y-auto rounded-[18px] border border-line bg-panel p-7 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">Ekspor hasil pilihan</h2>
            <p className="text-xs text-faint">
              {session.name} · {num(counts.pick)} dipilih · {num(counts.maybe)} dicek · {num(counts.reject)} dilewati
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="text-faint hover:text-fg">
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
              title="Lightroom Classic (XMP)"
              sub="Buat file .xmp di samping tiap RAW. File asli tidak disentuh, langsung terbaca saat import."
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
                      {lbl}
                      <Stars value={stars} size={11} />
                    </span>
                  </div>
                ))}
                <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1.5">
                  <Checkbox on={withReasons} onChange={setWithReasons}>
                    Tambah keyword alasan (blur, duplikat…)
                  </Checkbox>
                  <Checkbox on={overwrite} onChange={setOverwrite}>
                    Timpa file .xmp yang sudah ada
                  </Checkbox>
                </div>
                {overwrite && <p className="text-[11px] text-reject">Edit Lightroom yang tersimpan di file .xmp lama akan hilang.</p>}
                {rawCount < session.photos.length && (
                  <p className="text-[11px] text-faint">
                    {num(session.photos.length - rawCount)} foto hanya JPEG dan dilewati: metadatanya harus ditulis ke dalam
                    file, dan file asli tidak diubah.
                  </p>
                )}
              </div>
            </Option>
            <Option
              icon={FolderInput}
              title="Salin ke folder"
              sub="Salin file asli, atau buat JPG baru dengan ukuran yang bisa diatur."
              active={target === 'copy'}
              onClick={() => setTarget('copy')}
            >
              <div className="flex flex-col gap-3 pt-2.5" onClick={(e) => e.stopPropagation()}>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted">Foto</span>
                  <Segmented<Which>
                    value={which}
                    onChange={setWhich}
                    options={[
                      { value: 'pick', label: `Dipilih (${num(counts.pick)})` },
                      { value: 'pickMaybe', label: `Dipilih + Dicek (${num(counts.pick + counts.maybe)})` },
                    ]}
                  />
                </div>
                <CopySettingsForm value={copy} onChange={setCopy} base="Dipilih" mix={sourceMix(toCopy)} />
              </div>
            </Option>
            <Option
              icon={CloudUpload}
              title="Kirim ke pilihfotomu"
              sub="Upload foto yang dipilih ke galeri booking supaya klien memilih dari foto yang sudah bersih. Butuh internet."
              active={false}
              disabled
            />
            {target === 'xmp' && (
              <div className="flex items-start gap-2.5 rounded-[10px] bg-maybe/10 p-3">
                <Info size={16} className="shrink-0 text-maybe" />
                <p className="text-xs text-muted">
                  Foto sudah terlanjur di-import ke Lightroom? Pilih semua fotonya lalu klik Metadata › Read Metadata from
                  Files.
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2.5">
              <Button variant="plain" onClick={onClose} disabled={!!busy}>
                Batal
              </Button>
              <Button
                variant="primary"
                icon={Upload}
                onClick={run}
                disabled={!!busy || (target === 'copy' && (!copyIds.length || !copy.folder.trim()))}
              >
                {busy ? 'Mengekspor…' : label}
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
    `${num(report.written)} file XMP ditulis.`,
    report.skippedExisting ? `${num(report.skippedExisting)} dilewati karena file .xmp sudah ada.` : '',
    report.skippedJpeg ? `${num(report.skippedJpeg)} foto JPEG-saja dilewati.` : '',
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
          <p className="mb-1 font-semibold">{num(report.failed.length)} gagal:</p>
          {report.failed.map((f) => (
            <p key={f}>{f}</p>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2.5">
        <Button onClick={() => revealItemInDir(root)}>Buka folder</Button>
        <Button variant="primary" onClick={onClose}>
          Selesai
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
          {title} {disabled && <Chip color="var(--color-faint)">Segera</Chip>}
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
