/**
 * Persiapan: the few things Kelola Bisnis needs before it works well — the
 * studio's name and logo (invoices, receipts, messages), its contact and
 * bank details, a package, a first booking, a backup, notifications — each
 * ticked by itself once done, each a click from where it is done. Gone
 * when all are; folded to one line at will.
 */

import { open } from '@tauri-apps/plugin-dialog';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { Bell, Building2, CalendarPlus, Check, ChevronDown, ChevronUp, FolderSync, Landmark, Package as PackageIcon, Stamp } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { readLogo, useBrand } from '../kreasi/brand';
import { useBisnis } from './store';
import { Dialog, Field, btnPlain, btnPrimary, inputCls } from './ui';

type Step = { key: string; icon: ReactNode; title: string; text: string; done: boolean; action: string; run: () => void };

export function Setup({ onAddPackage, onNewBooking }: { onAddPackage: () => void; onNewBooking: () => void }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const brand = useBrand();
  const [dialog, setDialog] = useState<'studio' | 'kontak' | null>(null);
  const [notify, setNotify] = useState<boolean | null>(null);
  useEffect(() => {
    isPermissionGranted().then(setNotify, () => setNotify(false));
  }, []);

  const s = data.settings;
  const steps: Step[] = [
    {
      key: 'studio',
      icon: <Stamp size={16} />,
      title: t('Nama dan logo studio'),
      text: t('Tampil di invoice, kuitansi, dan pesan WhatsApp.'),
      done: !!brand.studio.trim() && !!brand.logo,
      action: t('Isi'),
      run: () => setDialog('studio'),
    },
    {
      key: 'kontak',
      icon: <Landmark size={16} />,
      title: t('Kontak dan rekening'),
      text: t('Alamat dan nomor di kop invoice; rekening untuk tagihan.'),
      done: !!s.studioContact.trim() && !!s.paymentInfo.trim(),
      action: t('Isi'),
      run: () => setDialog('kontak'),
    },
    {
      key: 'paket',
      icon: <PackageIcon size={16} />,
      title: t('Paket yang kamu jual'),
      text: t('Dipakai saat membuat booking dan untuk pricelist.'),
      done: data.packages.some((p) => !p.archived),
      action: t('Tambah paket'),
      run: onAddPackage,
    },
    {
      key: 'booking',
      icon: <CalendarPlus size={16} />,
      title: t('Booking pertama'),
      text: t('Klien, paket, tanggal foto, dan DP-nya.'),
      done: data.bookings.length > 0,
      action: t('Buat booking'),
      run: onNewBooking,
    },
    {
      key: 'backup',
      icon: <FolderSync size={16} />,
      title: t('Backup otomatis'),
      text: t('Data hanya ada di komputer ini. Pilih folder iCloud atau Google Drive supaya ada salinannya.'),
      done: !!s.backupDir,
      action: t('Pilih folder'),
      run: async () => {
        const dir = await open({ directory: true, title: t('Folder backup Kelola Bisnis') });
        if (typeof dir === 'string') update((d) => ({ ...d, settings: { ...d.settings, backupDir: dir } }));
      },
    },
    {
      key: 'notif',
      icon: <Bell size={16} />,
      title: t('Izinkan notifikasi'),
      text: t('Supaya pengingat jadwal dan pelunasan muncul di layar.'),
      done: notify === true,
      action: t('Izinkan'),
      run: async () => setNotify((await isPermissionGranted()) || (await requestPermission()) === 'granted'),
    },
  ];
  const done = steps.filter((x) => x.done).length;
  if (done === steps.length) return null;
  const next = steps.find((x) => !x.done);
  const folded = s.setupHidden;
  const fold = (setupHidden: boolean) => update((d) => ({ ...d, settings: { ...d.settings, setupHidden } }));
  const progress = (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
        <span className="block h-full rounded-full bg-gold transition-[width]" style={{ width: `${(done / steps.length) * 100}%` }} />
      </span>
      <span className="shrink-0 text-xs font-medium text-muted tabular-nums">{t('{done} dari {total} selesai', { done, total: steps.length })}</span>
    </span>
  );

  // Folded: one line, still showing how far it is; a click opens it again.
  if (folded)
    return (
      <button type="button" onClick={() => fold(false)} className="flex items-center gap-4 rounded-2xl border border-gold/30 bg-panel px-5 py-3 text-left hover:border-gold/60 lg:col-span-2">
        <span className="shrink-0 text-[13px] font-semibold">{t('Persiapan Kelola Bisnis')}</span>
        {progress}
        {next && <span className="hidden shrink-0 text-xs text-faint md:inline">{t('Berikutnya: {step}', { step: next.title })}</span>}
        <ChevronDown size={16} className="shrink-0 text-faint" />
      </button>
    );

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-gold/40 bg-panel p-5 lg:col-span-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold">{t('Persiapan Kelola Bisnis')}</h2>
          <p className="text-xs text-muted">{t('Lengkapi langkah ini sekali, supaya invoice, pesan, dan pengingat langsung rapi.')}</p>
        </div>
        <button type="button" onClick={() => fold(true)} className="flex shrink-0 items-center gap-1 text-xs text-faint hover:text-fg">
          {t('Tutup')} <ChevronUp size={14} />
        </button>
      </div>
      <div className="flex items-center gap-3">{progress}</div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {steps.map((x, i) => (
          <div key={x.key} className={cx('flex items-start gap-3 rounded-xl p-3', x.done ? 'bg-panel-2/50' : x === next ? 'bg-panel-2 ring-1 ring-gold/50' : 'bg-panel-2')}>
            <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-full', x.done ? 'bg-pick/15 text-pick' : 'bg-gold/15 text-gold-text')}>{x.done ? <Check size={15} strokeWidth={3} /> : x.icon}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={cx('text-[13px] font-medium', x.done && 'text-muted line-through decoration-faint')}>
                {i + 1}. {x.title}
              </span>
              {!x.done && <span className="text-[11px] leading-snug text-faint">{x.text}</span>}
              {!x.done && (
                <button type="button" onClick={x.run} className={cx('mt-1.5 self-start', x === next ? cx(btnPrimary, 'h-7 px-3 text-xs') : 'text-xs font-medium text-gold-text hover:underline')}>
                  {x.action}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      {dialog === 'studio' && <StudioDialog onClose={() => setDialog(null)} />}
      {dialog === 'kontak' && <ContactDialog onClose={() => setDialog(null)} />}
    </section>
  );
}

/** The studio's name and logo — the app's Brand studio, used by Buat konten too. */
function StudioDialog({ onClose }: { onClose: () => void }) {
  const brand = useBrand();
  const [studio, setStudio] = useState(brand.studio);
  const [logo, setLogo] = useState<{ url: string; ratio: number } | null>(brand.logo ? { url: brand.logo, ratio: brand.logoRatio } : null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title={t('Nama dan logo studio')}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnPlain}>
            {t('Batal')}
          </button>
          <button
            type="button"
            disabled={!studio.trim()}
            onClick={() => (brand.set({ studio: studio.trim(), logo: logo?.url ?? null, logoRatio: logo?.ratio ?? 1 }), onClose())}
            className={btnPrimary}
          >
            {t('Simpan')}
          </button>
        </>
      }
    >
      <Field label={t('Nama studio')}>
        <input value={studio} onChange={(e) => setStudio(e.target.value)} placeholder={t('mis. Galvin Photography')} autoFocus className={inputCls} />
      </Field>
      <Field label={t('Logo')} hint={t('PNG dengan latar transparan paling rapi. Juga dipakai di Buat konten.')}>
        <span className="flex items-center gap-3">
          <span className="flex size-16 items-center justify-center rounded-lg bg-[repeating-conic-gradient(#2a3a33_0_25%,#1a2622_0_50%)] bg-[length:12px_12px] p-1.5">
            {logo ? <img src={logo.url} alt="" className="max-h-full max-w-full" /> : <Building2 size={18} className="text-faint" />}
          </span>
          <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-line bg-raised px-3 text-xs font-medium hover:bg-line">
            {logo ? t('Ganti logo…') : t('Pilih logo…')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  setLogo(await readLogo(file));
                  setError(null);
                } catch {
                  setError(t('Gambar ini tidak bisa dibaca. Coba PNG atau JPG.'));
                }
              }}
            />
          </label>
        </span>
      </Field>
      {error && <span className="text-xs text-reject">{error}</span>}
    </Dialog>
  );
}

function ContactDialog({ onClose }: { onClose: () => void }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const [contact, setContact] = useState(data.settings.studioContact);
  const [payment, setPayment] = useState(data.settings.paymentInfo);
  return (
    <Dialog
      title={t('Kontak dan rekening')}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" onClick={onClose} className={btnPlain}>
            {t('Batal')}
          </button>
          <button type="button" onClick={() => (update((d) => ({ ...d, settings: { ...d.settings, studioContact: contact.trim(), paymentInfo: payment.trim() } })), onClose())} className={btnPrimary}>
            {t('Simpan')}
          </button>
        </>
      }
    >
      <Field label={t('Kontak studio')} hint={t('Di bawah nama studio pada invoice dan kuitansi.')}>
        <textarea value={contact} onChange={(e) => setContact(e.target.value)} rows={3} placeholder={t('Alamat\n0812-xxxx-xxxx · @namastudio')} autoFocus className={cx(inputCls, 'h-auto resize-y py-2')} />
      </Field>
      <Field label={t('Rekening pembayaran')} hint={t('Muncul di invoice dan pesan WhatsApp ({rekening}).')}>
        <textarea value={payment} onChange={(e) => setPayment(e.target.value)} rows={3} placeholder={t('BCA 1234567890 a.n. Nama Studio')} className={cx(inputCls, 'h-auto resize-y py-2')} />
      </Field>
    </Dialog>
  );
}
