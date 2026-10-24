import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { Check, Download, FileImage, FolderOpen, Info, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button, Segmented, cx } from '../components/ui';
import { api } from '../lib/api';
import { num } from '../lib/format';
import { t, tRust } from '../lib/i18n';
import { useApp } from '../store';
import { previewUrl } from './canvas';
import { slotsFor, templateOf } from './engine/document';
import { exportCollage } from './engine/render';
import { loadDocFonts, loadLocalImage, photoIdOf } from './kit';
import { emptyAssets } from './preview';
import { useKreasi } from './store';

type Format = 'jpg' | 'png';

/** "Tiga momen — Rina & Dimas" → "tiga-momen-rina-dimas". */
const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'konten';

/** Layar 15 · Ekspor: the design as JPG/PNG files in the session folder. */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const { doc, template, source } = useKreasi();
  const fail = useApp((s) => s.fail);
  const [format, setFormat] = useState<Format>('jpg');
  const [scale, setScale] = useState<1 | 2>(1);
  const [folder, setFolder] = useState(() => t('Konten'));
  const [name, setName] = useState(() => slug(template?.name ?? ''));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string[] | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  if (!doc || !template || !source) return null;
  const slides = doc.slides;
  const width = 1080 * scale;

  const run = async () => {
    setBusy(true);
    try {
      await loadDocFonts(doc);
      // Every photo at its 2048 px preview (the RAW's camera-sized picture).
      const pictures = new Map<string, HTMLCanvasElement>();
      await Promise.all(
        slotsFor(doc, templateOf(doc).cells.length).map(async (s) => {
          const id = s ? photoIdOf(s.file) : null;
          if (s && id != null) pictures.set(s.file.fileId, (await loadLocalImage(await previewUrl(source.root, id))) as unknown as HTMLCanvasElement);
        }),
      );
      const blobs = await exportCollage({
        slideWidth: width,
        doc,
        template: templateOf(doc),
        assets: (({ images: _, ...rest }) => rest)(emptyAssets()),
        format,
        quality: 0.92,
        pictures,
      });
      const ext = format === 'png' ? 'png' : 'jpg';
      const paths: string[] = [];
      for (let i = 0; i < blobs.length; i++) {
        const file = blobs.length > 1 ? `${name}-${String(i + 1).padStart(2, '0')}.${ext}` : `${name}.${ext}`;
        paths.push(await api.saveExport(source.root, folder.trim(), file, new Uint8Array(await blobs[i]!.arrayBuffer())));
      }
      setSaved(paths);
    } catch (e) {
      fail(tRust(String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-label={t('Ekspor konten')}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-[560px] max-w-full flex-col gap-5 overflow-y-auto rounded-[18px] border border-line bg-panel p-7 shadow-2xl"
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">{t('Ekspor konten')}</h2>
            <p className="text-xs text-faint">{template.name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>

        {saved ? (
          <>
            <div className="flex items-start gap-3 rounded-xl bg-pick/10 p-4">
              <Check size={18} className="mt-0.5 shrink-0 text-pick" />
              <div className="flex min-w-0 flex-col gap-1.5 text-[13px]">
                <span className="font-medium">{t('Tersimpan')}</span>
                {saved.map((p) => (
                  <span key={p} className="flex min-w-0 items-center gap-2 text-xs text-muted">
                    <FileImage size={13} className="shrink-0 text-gold-text" /> <span className="truncate">{p.split(/[\\/]/).pop()}</span>
                  </span>
                ))}
                <span className="truncate text-[11px] text-faint">{saved[0]!.replace(/[\\/][^\\/]*$/, '')}</span>
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
            <Field label={t('Format')} hint={format === 'jpg' ? t('JPG paling ringan untuk Instagram') : t('PNG menjaga tepi teks tetap tajam')}>
              <Segmented<Format> value={format} onChange={setFormat} options={[{ value: 'jpg', label: 'JPG' }, { value: 'png', label: 'PNG' }]} />
            </Field>
            <Field label={t('Ukuran')}>
              <div className="flex flex-col gap-2">
                {([1, 2] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setScale(k)}
                    className={cx('flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-left', scale === k ? 'bg-gold/[0.08] ring-1 ring-gold' : 'bg-panel-2 ring-1 ring-line-soft')}
                  >
                    <span className={cx('size-[18px] shrink-0 rounded-full', scale === k ? 'border-[5px] border-gold' : 'border-[1.5px] border-faint')} />
                    <span className="flex flex-col">
                      <span className="text-[13px] font-medium">
                        {num(1080 * k)} × {num(Math.round(1080 * k * (doc.format === 'story' ? 16 / 9 : doc.format === 'square' ? 1 : 5 / 4)))}
                        {k === 2 ? ' · 2×' : ''}
                      </span>
                      <span className="text-[11px] text-faint">{k === 1 ? t('Ukuran Instagram') : t('Lebih tajam untuk dicetak atau dipotong')}</span>
                    </span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label={t('Simpan ke')} hint={t('dibuat di dalam folder sesi')}>
              <input value={folder} onChange={(e) => setFolder(e.target.value)} className="h-[38px] rounded-[10px] border border-line bg-bg px-3 text-[13px] outline-none focus:border-gold" />
            </Field>
            <Field label={t('Nama file')}>
              <div className="flex h-[38px] items-center rounded-[10px] border border-line bg-bg px-3 focus-within:border-gold">
                <input value={name} onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
                <span className="text-xs text-faint">{slides > 1 ? `-01…-${String(slides).padStart(2, '0')}` : ''}.{format}</span>
              </div>
            </Field>
            <p className="flex gap-2 rounded-[10px] bg-panel-2 p-3 text-[11px] text-faint">
              <Info size={13} className="mt-px shrink-0" />
              {slides > 1
                ? t('Carousel disimpan per slide: {n} file, urutannya sudah benar. File asli tidak diubah.', { n: slides })
                : t('Foto diambil dari pratinjau 2048 px tiap foto. File asli tidak diubah.')}
            </p>
            <div className="flex justify-end gap-2.5">
              <Button variant="plain" onClick={onClose} disabled={busy}>
                {t('Batal')}
              </Button>
              <Button variant="primary" icon={Download} onClick={run} disabled={busy || !folder.trim() || !name.trim()}>
                {busy ? t('Mengekspor…') : t('Ekspor {format}', { format: format.toUpperCase() })}
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
    <div className="flex flex-col gap-1.5">
      <span className="flex justify-between text-xs font-medium text-muted">
        {label}
        {hint && <span className="font-normal text-faint">{hint}</span>}
      </span>
      {children}
    </div>
  );
}
