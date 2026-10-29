/**
 * Edit foto › Ekspor: the edited photos as JPGs, developed from the full-size
 * picture (the RAW's own resolution), into a folder of the session. The
 * files themselves never change.
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { Aperture, Check, Download, FileImage, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, Segmented, cx } from '../components/ui';
import { api, type ExportReport, type PhotoEntry } from '../lib/api';
import { num } from '../lib/format';
import { t, tRust } from '../lib/i18n';
import { NO_ADJUST, shownAdjust } from '../kreasi/engine/document';
import { developed, setDevelopFullSize } from '../kreasi/engine/develop';
import { drawAdjustOverlays } from '../kreasi/engine/render';
import { NO_GEOMETRY, drawGeometry, outputSize, type EditSettings } from './geometry';
import { cleanedImage, preparedReady } from './source';
import { depthOf } from './lens-blur';
import { toCrsFor } from './lightroom';

type Size = 'asli' | '2048' | '1080';
type Quality = 'tinggi' | 'sedang' | 'hemat';
const QUALITY: Record<Quality, number> = { tinggi: 0.95, sedang: 0.88, hemat: 0.78 };

/**
 * A picture read once, not kept (full-size pictures are large). Through a
 * blob, as `loadLocalImage`, so the GPU may read it.
 */
async function loadOnce(url: string): Promise<HTMLImageElement> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(t('Foto tidak bisa dibaca.'));
  const src = URL.createObjectURL(await r.blob());
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t('Foto tidak bisa dibaca.')));
      img.src = src;
    });
  } finally {
    URL.revokeObjectURL(src);
  }
}

const stem = (name: string) => name.replace(/\.[^.]+$/, '');

export function EditExportDialog({
  root,
  sessionName,
  photos,
  edits,
  onClose,
}: {
  root: string;
  sessionName: string;
  /** What goes out: the edited photos (or the ones chosen). */
  photos: PhotoEntry[];
  edits: Record<number, EditSettings>;
  onClose: () => void;
}) {
  const [size, setSize] = useState<Size>('asli');
  const [quality, setQuality] = useState<Quality>('tinggi');
  const [folder, setFolder] = useState(() => t('Edit JPG'));
  const [done, setDone] = useState<number | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [jpg, setJpg] = useState(true);
  /** Super Resolution 2×: each JPG, once saved, enlarged by the model (slow). */
  const [superRes, setSuperRes] = useState(false);
  const [srProgress, setSrProgress] = useState<{ done: number; total: number } | null>(null);
  const hasRaw = photos.some((p) => p.raw);
  const [xmp, setXmp] = useState(hasRaw);
  const [report, setReport] = useState<ExportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = done != null && !saved;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const run = async () => {
    setDone(0);
    setError(null);
    const paths: string[] = [];
    setDevelopFullSize(true);
    try {
      if (xmp) {
        setReport(
          await api.writeDevelopXmp(
            await Promise.all(photos.map(async (p) => ({ id: p.id, develop: await toCrsFor(root, p.id, edits[p.id] ?? NO_ADJUST, !!p.raw) }))),
          ),
        );
      }
      for (const p of jpg ? photos : []) {
        const full = await api.fullResImage(root, p.id);
        const img = await loadOnce(convertFileSrc(full.path));
        const a = shownAdjust(edits[p.id]);
        const s = edits[p.id];
        const clean = (s?.aiDenoise?.amount ?? 0) > 0 ? await cleanedImage(root, p.id, true) : null;
        const depth = (s?.lensBlur?.amount ?? 0) > 0 ? await depthOf(root, p.id).catch(() => null) : null;
        const base = await preparedReady(img, full.width, full.height, s, clean, depth);
        const dev = developed(base, a);
        // Turned and cropped as in the editor; then the size asked.
        const g = edits[p.id]?.geometry ?? NO_GEOMETRY;
        const out = outputSize(full.width, full.height, g);
        const long = size === 'asli' ? Math.max(out.w, out.h) : Number(size);
        const k = Math.min(1, long / Math.max(out.w, out.h));
        const c = document.createElement('canvas');
        c.width = Math.round(out.w * k);
        c.height = Math.round(out.h * k);
        const ctx = c.getContext('2d')!;
        ctx.imageSmoothingQuality = 'high';
        drawGeometry(ctx, dev ?? base, full.width, full.height, g, c.width, c.height);
        drawAdjustOverlays(ctx, { x: 0, y: 0, w: c.width, h: c.height }, a, !!dev);
        const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', QUALITY[quality]));
        if (!blob) throw new Error(t('Foto tidak bisa disimpan.'));
        const path = await api.saveExport(root, folder.trim(), `${stem(p.name)}.jpg`, new Uint8Array(await blob.arrayBuffer()));
        c.width = c.height = 0;
        if (superRes && size === 'asli') {
          setSrProgress({ done: 0, total: 1 });
          await api.superResolve(path, setSrProgress);
          setSrProgress(null);
        }
        paths.push(path);
        setDone((n) => (n ?? 0) + 1);
      }
      setSaved(paths);
    } catch (e) {
      setError(tRust(String(e)));
      setDone(null);
    } finally {
      setDevelopFullSize(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-label={t('Ekspor foto yang diedit')}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-[600px] max-w-full flex-col gap-5 overflow-y-auto rounded-[18px] border border-line bg-panel p-7 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">{t('Ekspor {count} foto yang diedit', { n: photos.length, count: num(photos.length) })}</h2>
            <p className="text-xs text-faint">
              {sessionName} · {t('edit tidak mengubah file asli')}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>

        {saved ? (
          <>
            <div className="flex items-start gap-3 rounded-xl bg-pick/10 p-4">
              <Check size={18} className="mt-0.5 shrink-0 text-pick" />
              <div className="flex min-w-0 flex-col gap-1 text-[13px]">
                {saved.length > 0 && <span className="font-medium">{t('{count} JPG tersimpan', { n: saved.length, count: num(saved.length) })}</span>}
                {saved.length > 0 && <span className="truncate text-[11px] text-faint">{saved[0]!.replace(/[\\/][^\\/]*$/, '')}</span>}
                {report && (
                  <span className="font-medium">{t('{count} XMP ditulis di samping RAW', { n: report.written, count: num(report.written) })}</span>
                )}
                {report && report.skippedExisting > 0 && (
                  <span className="text-xs text-maybe">
                    {t('{count} dilewati: sudah ada XMP dari Lightroom (berisi edit Anda di sana), tidak ditimpa.', { n: report.skippedExisting, count: num(report.skippedExisting) })}
                  </span>
                )}
                {report && report.skippedJpeg > 0 && (
                  <span className="text-xs text-faint">{t('{count} foto JPEG tidak dapat XMP (Lightroom membacanya dari dalam file).', { n: report.skippedJpeg, count: num(report.skippedJpeg) })}</span>
                )}
                {report?.failed.map((f) => (
                  <span key={f} className="text-xs text-reject">{f}</span>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2.5">
              {saved.length > 0 && <Button onClick={() => revealItemInDir(saved[0]!)}>{t('Buka folder')}</Button>}
              <Button variant="primary" onClick={onClose}>
                {t('Selesai')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className={cx('flex flex-col gap-4 rounded-xl border p-4', jpg ? 'border-gold/60 bg-gold/[0.04]' : 'border-line-soft')}>
              <label className="flex items-center gap-2.5 text-sm font-semibold">
                <input type="checkbox" checked={jpg} onChange={(e) => setJpg(e.target.checked)} className="size-4 accent-[var(--color-gold)]" />
                <FileImage size={16} className="text-gold-text" /> {t('Buat JPG')}
                <span className="font-normal text-faint">· {t('siap dikirim ke klien atau di-upload')}</span>
              </label>
              {jpg && (<>
              <Row label={t('Ukuran')}>
                <Segmented<Size>
                  value={size}
                  onChange={setSize}
                  options={[
                    { value: 'asli', label: t('Asli') },
                    { value: '2048', label: '2048 px' },
                    { value: '1080', label: t('Instagram 1080') },
                  ]}
                />
              </Row>
              <Row label={t('Kualitas')}>
                <Segmented<Quality>
                  value={quality}
                  onChange={setQuality}
                  options={[
                    { value: 'tinggi', label: t('Tinggi') },
                    { value: 'sedang', label: t('Sedang') },
                    { value: 'hemat', label: t('Hemat') },
                  ]}
                />
              </Row>
              {size === 'asli' && (
                <label className="flex items-start gap-2.5 text-[13px]">
                  <input type="checkbox" checked={superRes} onChange={(e) => setSuperRes(e.target.checked)} className="mt-0.5 size-4 accent-[var(--color-gold)]" />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{t('Super Resolution 2×')}</span>
                    <span className="text-[11px] text-faint">
                      {t('Lebar dan tinggi jadi dua kali (4× piksel), detail digambar ulang oleh AI di komputer ini. Lambat: beberapa menit per foto besar.')}
                    </span>
                  </span>
                </label>
              )}
              <Row label={t('Folder')}>
                <input
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  className="h-9 w-full rounded-[10px] border border-line bg-bg px-3 text-[13px] outline-none focus:border-gold"
                />
              </Row>
              </>)}
            </div>
            <div className={cx('flex flex-col gap-3 rounded-xl border p-4', xmp ? 'border-gold/60 bg-gold/[0.04]' : 'border-line-soft', !hasRaw && 'opacity-60')}>
              <label className="flex items-center gap-2.5 text-sm font-semibold">
                <input type="checkbox" checked={xmp} disabled={!hasRaw} onChange={(e) => setXmp(e.target.checked)} className="size-4 accent-[var(--color-gold)]" />
                <Aperture size={16} className="text-gold-text" /> {t('XMP untuk Lightroom')}
              </label>
              <p className="text-xs text-faint">
                {hasRaw
                  ? t('Pengaturan edit ditulis di samping tiap RAW, supaya bisa dilanjutkan di Lightroom Classic atau Camera Raw. XMP yang sudah dibuat Lightroom tidak ditimpa.')
                  : t('Hanya untuk foto RAW.')}
              </p>
              {xmp && (
                <p className="flex gap-2 text-[11px] text-faint">
                  <TriangleAlert size={13} className="mt-px shrink-0 text-maybe" />
                  {t('Slider di Lightroom sama persis. Warnanya bisa sedikit beda karena mesin olah RAW Lightroom berbeda. White balance RAW dan Matte tidak ikut.')}
                </p>
              )}
            </div>
            <p className="flex gap-2 rounded-[10px] bg-panel-2 p-3 text-[11px] text-faint">
              <Info size={13} className="mt-px shrink-0" />
              {t('Diolah dari foto ukuran penuh. Foto RAW butuh beberapa detik per foto saat pertama kali dibaca.')}
            </p>
            {error && <p className="text-xs text-reject">{error}</p>}
            <div className="flex items-center justify-end gap-2.5">
              {busy && (
                <span className="mr-auto text-xs text-muted">
                  {t('Mengekspor {done} dari {total}…', { done: num(done ?? 0), total: num(photos.length) })}
                  {srProgress && ` · ${t('Super Resolution {pct}%', { pct: Math.round((srProgress.done * 100) / Math.max(1, srProgress.total)) })}`}
                </span>
              )}
              <Button variant="plain" onClick={onClose} disabled={busy}>
                {t('Batal')}
              </Button>
              <Button variant="primary" icon={Download} onClick={run} disabled={busy || (jpg && !folder.trim()) || !photos.length || (!jpg && !xmp)}>
                {busy ? t('Mengekspor…') : t('Ekspor')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[90px_1fr] items-center gap-3">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </div>
  );
}
