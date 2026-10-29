/**
 * The first time the app opens (after the terms): three short steps — the
 * language, the studio's name and logo (used in invoices, messages and
 * designs), and where to start. Every step can be skipped; Pengaturan has
 * all of it later. Not shown again once done or skipped, nor to a studio
 * that already has its name in.
 */

import { ArrowLeft, ArrowRight, Briefcase, ImagePlus, LayoutTemplate, SlidersHorizontal, Sparkles, type LucideIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { readLogo, useBrand } from '../kreasi/brand';
import { systemLang, t, useLang, type LangPref } from '../lib/i18n';
import { useApp, type Screen } from '../store';
import { cx } from './ui';

const KEY = 'pilihfotomu.welcome';
const NAMES = { id: 'Bahasa Indonesia', en: 'English' } as const;

function seen(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    // Storage unreadable: don't ask on every launch.
    return true;
  }
}

function remember() {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* shown again next time, nothing else depends on it */
  }
}

export function Welcome() {
  const [open, setOpen] = useState(() => !seen() && !useBrand.getState().studio.trim());
  const [step, setStep] = useState(0);
  if (!open) return null;
  const finish = (to?: Screen) => {
    remember();
    setOpen(false);
    if (to) useApp.getState().go(to);
  };
  const steps = [<LanguageStep key="lang" />, <StudioStep key="studio" />, <StartStep key="start" onPick={finish} />];
  const last = step === steps.length - 1;
  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-[90] flex items-center justify-center overflow-y-auto bg-bg p-6">
      <div className="flex w-full max-w-[600px] flex-col gap-7">
        <span className="flex items-center gap-2">
          {steps.map((_, i) => (
            <span key={i} className={cx('h-1 flex-1 rounded-full transition-colors', i <= step ? 'bg-gold' : 'bg-raised')} />
          ))}
        </span>
        {steps[step]}
        <span className="flex items-center gap-2">
          {step > 0 && (
            <button type="button" onClick={() => setStep(step - 1)} className="flex h-10 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-medium text-muted hover:text-fg">
              <ArrowLeft size={15} /> {t('Kembali')}
            </button>
          )}
          <button type="button" onClick={() => finish()} className="ml-auto h-10 px-3 text-[13px] text-faint hover:text-fg">
            {last ? t('Nanti saja, ke Beranda') : t('Lewati semua')}
          </button>
          {!last && (
            <button type="button" onClick={() => setStep(step + 1)} className="flex h-10 items-center gap-2 rounded-[10px] bg-gold-gradient px-5 text-[13px] font-semibold text-white">
              {t('Lanjut')} <ArrowRight size={15} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

function Heading({ title, sub }: { title: string; sub: string }) {
  return (
    <span className="flex flex-col gap-2">
      <span className="text-[28px] font-semibold">{title}</span>
      <span className="text-[14px] text-muted">{sub}</span>
    </span>
  );
}

function LanguageStep() {
  const pref = useLang((s) => s.pref);
  const setPref = useLang((s) => s.setPref);
  const options: { value: LangPref; label: string; sub?: string }[] = [
    { value: 'system', label: t('Ikuti sistem'), sub: NAMES[systemLang()] },
    { value: 'id', label: NAMES.id },
    { value: 'en', label: NAMES.en },
  ];
  return (
    <>
      <Heading title={t('Selamat datang di pilihfotomu')} sub={t('Pilih foto, edit, buat konten, dan kelola klien, semuanya di komputer ini. Mulai dengan bahasa yang kamu pakai.')} />
      <span role="radiogroup" aria-label={t('Bahasa')} className="grid grid-cols-3 gap-3">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={pref === o.value}
            onClick={() => setPref(o.value)}
            className={cx('flex flex-col gap-1 rounded-2xl border bg-panel p-4 text-left', pref === o.value ? 'border-gold' : 'border-line-soft hover:border-line')}
          >
            <span className="text-[14px] font-semibold">{o.label}</span>
            <span className="text-[11px] text-faint">{o.sub ?? ' '}</span>
          </button>
        ))}
      </span>
    </>
  );
}

function StudioStep() {
  const brand = useBrand();
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    try {
      const { url, ratio } = await readLogo(f);
      brand.set({ logo: url, logoRatio: ratio });
      setError(null);
    } catch {
      setError(t('Gambar ini tidak bisa dibaca. Coba PNG atau JPG.'));
    }
  };
  return (
    <>
      <Heading title={t('Studio kamu')} sub={t('Nama dan logo dipakai di invoice, kuitansi, pesan WhatsApp, dan desain Buat konten. Bisa diubah kapan saja di Pengaturan.')} />
      <span className="flex items-center gap-5 rounded-2xl border border-line-soft bg-panel p-5">
        <button type="button" onClick={() => file.current?.click()} title={t('Pilih logo…')} className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-line bg-panel-2 text-faint hover:border-gold/70 hover:text-gold-text">
          {brand.logo ? <img src={brand.logo} alt="" className="max-h-full max-w-full object-contain p-2" /> : <ImagePlus size={24} />}
        </button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <span className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="text-xs font-medium text-muted">{t('Nama studio')}</span>
          <input
            value={brand.studio}
            onChange={(e) => brand.set({ studio: e.target.value })}
            placeholder={t('mis. Galvin Photography')}
            autoFocus
            className="h-11 w-full rounded-[10px] border border-line bg-bg px-3 text-[15px] outline-none placeholder:text-faint focus:border-gold"
          />
          <span className={cx('text-[11px]', error ? 'text-reject' : 'text-faint')}>{error ?? t('Logo: PNG dengan latar transparan paling rapi. Boleh dilewati.')}</span>
        </span>
      </span>
    </>
  );
}

function StartStep({ onPick }: { onPick: (to: Screen) => void }) {
  const options: { icon: LucideIcon; title: string; sub: string; to: Screen }[] = [
    { icon: Briefcase, title: t('Kelola Bisnis'), sub: t('Catat booking, jadwal, dan pembayaran klien'), to: { name: 'bisnis' } },
    { icon: Sparkles, title: t('Pilih foto##mode'), sub: t('Pilah foto sesi pertamamu'), to: { name: 'pilih' } },
    { icon: SlidersHorizontal, title: t('Edit foto'), sub: t('Atur cahaya dan warna, pakai preset'), to: { name: 'edit', back: { name: 'home' } } },
    { icon: LayoutTemplate, title: t('Buat konten'), sub: t('Story dan feed dari template'), to: { name: 'kreasi', back: { name: 'home' } } },
  ];
  return (
    <>
      <Heading title={t('Mau mulai dari mana?')} sub={t('Semua menu tetap ada di Beranda.')} />
      <span className="grid grid-cols-2 gap-3">
        {options.map((o) => (
          <button key={o.title} type="button" onClick={() => onPick(o.to)} className="group flex items-center gap-3.5 rounded-2xl border border-line-soft bg-panel p-4 text-left hover:border-gold/70">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-raised text-gold-text">
              <o.icon size={18} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[14px] font-semibold">{o.title}</span>
              <span className="truncate text-[11px] text-faint">{o.sub}</span>
            </span>
            <ArrowRight size={15} className="shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
          </button>
        ))}
      </span>
    </>
  );
}
