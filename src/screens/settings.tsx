import { getVersion } from '@tauri-apps/api/app';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  ArrowLeft,
  BadgeCheck,
  FolderSearch,
  HardDrive,
  Info,
  Keyboard,
  Languages,
  RotateCcw,
  ScrollText,
  Stamp,
  SlidersHorizontal,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { LegalDocs } from '../components/legal';
import { MAX_BRAND_COLORS, readLogo, useBrand } from '../kreasi/brand';
import { FONT_CATEGORIES, FONTS } from '../kreasi/engine/font-catalog';
import { fontFamilies } from '../kreasi/kit';
import { TitleBar, isMac } from '../components/title-bar';
import { Select } from '../components/select';
import { Button, Chip, IconButton, Kbd, Segmented, Switch, cx } from '../components/ui';
import { api, type CacheInfo, type Options, type ShootType, type Strictness } from '../lib/api';
import { bytes } from '../lib/format';
import { systemLang, t, useLang, type LangPref } from '../lib/i18n';
import { ACTIONS, DEFAULT_KEYS, RESERVED, keyLabel, useCullPrefs, useKeys, type Action } from '../lib/keys';
import { FACTORY_OPTIONS, GENERAL, SHOOT_TYPES, shootRule, useDefaults, withShootType } from '../lib/shoot';
import type { Screen } from '../store';
import { useApp } from '../store';
import { strictnessHint } from './setup';

type Section = 'license' | 'language' | 'analysis' | 'storage' | 'keys' | 'brand' | 'legal' | 'about';

/** `label` is an i18n key. */
const NAV: { id: Section; icon: LucideIcon; label: string }[] = [
  { id: 'license', icon: BadgeCheck, label: 'Lisensi & perangkat' },
  { id: 'language', icon: Languages, label: 'Bahasa' },
  { id: 'analysis', icon: SlidersHorizontal, label: 'Analisis bawaan' },
  { id: 'storage', icon: HardDrive, label: 'Penyimpanan & cache' },
  { id: 'keys', icon: Keyboard, label: 'Pintasan keyboard' },
  { id: 'brand', icon: Stamp, label: 'Brand studio' },
  { id: 'legal', icon: ScrollText, label: 'Dokumen hukum' },
  { id: 'about', icon: Info, label: 'Tentang' },
];

/** Shortcuts that can't be changed; descriptions are i18n keys. */
const FIXED: [string, string][] = [
  ['← → ↑ ↓', 'Pindah foto'],
  ['1–5 / 0', 'Beri / hapus bintang'],
  ['Space', 'Buka / tutup tampilan besar'],
  ['+ / −', 'Perbesar / perkecil'],
  [isMac ? 'Pinch / ⌘ + scroll' : 'Ctrl + scroll', 'Zoom di tampilan besar'],
  ['Scroll / drag', 'Geser foto saat di-zoom'],
  ['1–9', 'Pilih foto di Bandingkan'],
  ['Enter', 'Grup burst berikutnya'],
  ['Esc', 'Kembali / tutup'],
  [isMac ? '⌘ ,' : 'Ctrl + ,', 'Buka pengaturan'],
];

/** The Buat konten editor's shortcuts (src/kreasi/editor.tsx). */
const M = isMac ? '⌘' : 'Ctrl + ';
const KREASI: [string, string][] = [
  [`${M}Z`, 'Urungkan'],
  [isMac ? '⇧⌘Z' : 'Ctrl + Shift + Z / Ctrl + Y', 'Ulangi'],
  [`${M}T`, 'Atur ukuran foto di tempatnya'],
  [`${M}D`, 'Duplikat'],
  [`${M}C / ${M}X / ${M}V`, 'Salin / potong / tempel lapisan'],
  [isMac ? '⌥ + seret' : 'Alt + seret', 'Seret salinannya'],
  ['Shift + klik', 'Pilih beberapa (atau seret kotak di area kosong)'],
  [`${M}A`, 'Pilih semua'],
  ['] / [', 'Naikkan / turunkan lapisan'],
  ['Shift + ] / [', 'Paling atas / paling bawah'],
  ['Delete', 'Hapus teks atau elemen'],
  ['← → ↑ ↓ (Shift: 10 px)', 'Geser teks atau elemen'],
  ['Enter', 'Ubah teks'],
  [`${M}= / ${M}− / ${M}0`, 'Zoom kanvas / pas layar'],
  [isMac ? '⌥ + scroll' : 'Alt + scroll', 'Zoom foto di tempatnya'],
  [isMac ? '⌘ saat menyeret' : 'Ctrl saat menyeret', 'Geser tanpa magnet'],
  [`${M}E`, 'Ekspor desain'],
];

function KeyEditor() {
  const keys = useKeys((s) => s.keys);
  const autoAdvance = useCullPrefs((s) => s.autoAdvance);
  const setAutoAdvance = useCullPrefs((s) => s.setAutoAdvance);
  const setKey = useKeys((s) => s.set);
  const reset = useKeys((s) => s.reset);
  const [listening, setListening] = useState<Action | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const k = e.key.toLowerCase();
      if (k === 'escape') return setListening(null);
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (k.length !== 1 || RESERVED.has(k)) {
        setNote(t('“{key}” sudah dipakai untuk fungsi tetap. Pilih huruf lain.', { key: keyLabel(e.key) }));
        return;
      }
      const other = ACTIONS.find((a) => a.id !== listening && keys[a.id] === k);
      setNote(
        other
          ? t('{key} dipindah dari “{action}”, yang sekarang memakai {old}.', {
              key: keyLabel(k),
              action: other.label,
              old: keyLabel(keys[listening]),
            })
          : null,
      );
      setKey(listening, k);
      setListening(null);
    };
    // Capture: runs before the screen's own shortcut handlers.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, keys, setKey]);

  const changed = ACTIONS.some((a) => keys[a.id] !== DEFAULT_KEYS[a.id]);
  return (
    <div className="flex max-w-[560px] flex-col gap-5">
      <div className="flex items-end justify-between">
        <h1 className="text-[22px] font-semibold">{t('Pintasan keyboard')}</h1>
        <Button variant="plain" icon={RotateCcw} disabled={!changed} onClick={() => (reset(), setNote(null))}>
          {t('Kembalikan bawaan')}
        </Button>
      </div>
      <p className="-mt-3 text-[13px] text-muted">
        {t('Klik tombol di kanan, lalu tekan huruf baru. Contoh: Q / W / E untuk Pilih / Cek / Lewati.')}
      </p>
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-line-soft bg-panel px-5 py-3.5">
        <span className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium">{t('Maju otomatis')}</span>
          <span className="text-xs text-faint">{t('Setelah menandai Pilih / Cek / Lewati, langsung pindah ke foto berikutnya.')}</span>
        </span>
        <Switch label={t('Maju otomatis')} checked={autoAdvance} onChange={setAutoAdvance} />
      </div>
      <div className="flex flex-col rounded-2xl border border-line-soft bg-panel px-5 py-2">
        {ACTIONS.map((a) => (
          <div key={a.id} className="flex h-11 items-center justify-between gap-3 border-b border-line-soft last:border-0">
            <span className="text-[13px] text-muted">{a.label}</span>
            <span className="flex items-center gap-3">
              {listening === a.id && (
                <span className="text-xs text-gold-text">
                  {t('Tekan huruf baru')} · <span className="text-faint">{t('Esc batal')}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => (setListening(listening === a.id ? null : a.id), setNote(null))}
                title={t('Klik untuk mengganti')}
                className={cx(
                  'h-8 w-11 shrink-0 rounded-md border text-xs font-semibold transition-colors',
                  listening === a.id
                    ? 'border-gold bg-gold/15 text-gold-text ring-2 ring-gold/30'
                    : 'border-line bg-bg text-fg hover:border-faint',
                )}
              >
                {listening === a.id ? '…' : keyLabel(keys[a.id])}
              </button>
            </span>
          </div>
        ))}
      </div>
      {note && <p className="text-xs text-maybe">{note}</p>}
      <h2 className="pt-2 text-sm font-semibold text-muted">{t('Tetap')}</h2>
      <div className="flex flex-col rounded-2xl border border-line-soft bg-panel px-5 py-2">
        {FIXED.map(([k, l]) => (
          <div key={k} className="flex h-10 items-center justify-between border-b border-line-soft last:border-0">
            <span className="text-[13px] text-muted">{t(l)}</span>
            <Kbd>{k}</Kbd>
          </div>
        ))}
      </div>
      <h2 className="pt-2 text-sm font-semibold text-muted">{t('Buat konten')}</h2>
      <div className="flex flex-col rounded-2xl border border-line-soft bg-panel px-5 py-2">
        {KREASI.map(([k, l]) => (
          <div key={k} className="flex h-10 items-center justify-between border-b border-line-soft last:border-0">
            <span className="text-[13px] text-muted">{t(l)}</span>
            <Kbd>{t(k)}</Kbd>
          </div>
        ))}
      </div>
    </div>
  );
}

/** `label` is an i18n key. */
const CHECKS: { key: keyof Options & `check${string}`; label: string }[] = [
  { key: 'checkBlur', label: 'Blur / tidak fokus' },
  { key: 'checkEyes', label: 'Mata terpejam' },
  { key: 'checkDuplicates', label: 'Duplikat & burst' },
  { key: 'checkExposure', label: 'Eksposur' },
  { key: 'checkSmile', label: 'Ekspresi' },
];

/** A "+" that adds the colour once it is chosen (the native change, not every drag step). */
function ColorAdder({ onAdd }: { onAdd: (color: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const add = useRef(onAdd);
  add.current = onAdd;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => add.current(el.value);
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, []);
  return (
    <label className="relative flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full text-sm text-faint ring-1 ring-line" title={t('Tambah warna')}>
      <input ref={ref} type="color" defaultValue="#c9a96e" className="absolute inset-0 size-full cursor-pointer opacity-0" />+
    </label>
  );
}

/** Pengaturan › Brand studio: used by Buat konten in every design. */
function BrandSettings() {
  const brand = useBrand();
  const [error, setError] = useState<string | null>(null);
  const fam = fontFamilies();
  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { url, ratio } = await readLogo(file);
      brand.set({ logo: url, logoRatio: ratio });
      setError(null);
    } catch {
      setError(t('Gambar ini tidak bisa dibaca. Coba PNG atau JPG.'));
    }
  };
  return (
    <div className="flex max-w-[560px] flex-col gap-5">
      <h1 className="text-[22px] font-semibold">{t('Brand studio')}</h1>
      <p className="-mt-3 text-[13px] text-muted">
        {t('Diisi sekali, dipakai di semua desain Buat konten: watermark, logo, teks “Nama Studio”, warna dan huruf andalan.')}
      </p>
      <div className="flex flex-col gap-5 rounded-2xl border border-line-soft bg-panel p-5">
        <label className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{t('Nama studio')}</span>
          <input
            value={brand.studio}
            onChange={(e) => brand.set({ studio: e.target.value })}
            placeholder={t('mis. Galvin Photography')}
            className="h-[34px] rounded-[10px] border border-line bg-bg px-3 text-[13px] outline-none placeholder:text-faint focus:border-gold"
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{t('Logo')}</span>
          <div className="flex items-center gap-3">
            <span className="flex size-16 items-center justify-center rounded-lg bg-[repeating-conic-gradient(#2a3a33_0_25%,#1a2622_0_50%)] bg-[length:12px_12px] p-1.5">
              {brand.logo ? <img src={brand.logo} alt="" className="max-h-full max-w-full" /> : <Stamp size={18} className="text-faint" />}
            </span>
            <label className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-line bg-raised px-3 text-xs font-medium hover:bg-line">
              {brand.logo ? t('Ganti logo…') : t('Pilih logo…')}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pickLogo(e.target.files?.[0])} />
            </label>
            {brand.logo && (
              <Button variant="plain" icon={Trash2} onClick={() => brand.set({ logo: null })}>
                {t('Hapus')}
              </Button>
            )}
          </div>
          <span className="text-xs text-faint">{t('PNG dengan latar transparan paling rapi.')}</span>
          {error && <span className="text-xs text-reject">{error}</span>}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{t('Warna andalan')}</span>
          <div className="flex flex-wrap items-center gap-2">
            {brand.colors.map((c, i) => (
              <button
                key={`${c}-${i}`}
                type="button"
                title={t('Hapus {color}', { color: c })}
                onClick={() => brand.set({ colors: brand.colors.filter((_, j) => j !== i) })}
                className="group relative size-8 rounded-full ring-1 ring-line"
                style={{ background: c }}
              >
                <X size={12} className="absolute -top-1 -right-1 hidden rounded-full bg-panel-2 text-fg group-hover:block" />
              </button>
            ))}
            {brand.colors.length < MAX_BRAND_COLORS && (
              <ColorAdder onAdd={(c) => brand.set({ colors: [...brand.colors, c] })} />
            )}
          </div>
          <span className="text-xs text-faint">{t('Muncul paling depan di setiap pilihan warna.')}</span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{t('Huruf andalan')}</span>
          <Select
            value={brand.font ?? ''}
            onChange={(v) => brand.set({ font: v || null })}
            options={[
              { value: '', label: t('Tidak ada') },
              ...FONT_CATEGORIES.flatMap((c) =>
                Object.entries(FONTS)
                  .filter(([, f]) => f.category === c.id)
                  .map(([id, f]) => ({ value: id, label: f.label, group: t(c.label), style: { fontFamily: fam[id] } })),
              ),
            ]}
          />
          <span className="text-xs text-faint">{t('Muncul paling atas di daftar huruf, dan dipakai untuk nama studio.')}</span>
        </div>
      </div>
    </div>
  );
}

function AnalysisDefaults() {
  const options = useDefaults((s) => s.options);
  const setOptions = useDefaults((s) => s.set);
  const reset = useDefaults((s) => s.reset);
  const set = (patch: Partial<Options>) => setOptions({ ...options, ...patch });
  const changed = (Object.keys(FACTORY_OPTIONS) as (keyof Options)[]).some((k) => options[k] !== FACTORY_OPTIONS[k]);
  return (
    <div className="flex max-w-[560px] flex-col gap-5">
      <div className="flex items-end justify-between">
        <h1 className="text-[22px] font-semibold">{t('Analisis bawaan')}</h1>
        <Button variant="plain" icon={RotateCcw} disabled={!changed} onClick={reset}>
          {t('Kembalikan bawaan')}
        </Button>
      </div>
      <p className="-mt-3 text-[13px] text-muted">
        {t(
          'Pilihan awal di layar Atur analisis. Tetap bisa diganti per folder, dan ketat seleksi & jenis pemotretan bisa diganti lagi di layar Review.',
        )}
      </p>
      <div className="flex flex-col gap-4 rounded-2xl border border-line-soft bg-panel p-5">
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{t('Ketat seleksi')}</span>
          <Segmented<Strictness>
            value={options.strictness}
            onChange={(strictness) => set({ strictness })}
            options={[
              { value: 'loose', label: t('Longgar') },
              { value: 'balanced', label: t('Seimbang') },
              { value: 'strict', label: t('Ketat') },
            ]}
          />
          <p className="text-xs text-faint">{strictnessHint(options.strictness)}</p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{t('Jenis pemotretan')}</span>
          <Select<ShootType | 'auto'>
            aria-label={t('Jenis pemotretan')}
            value={options.shootType}
            onChange={(v) => setOptions(withShootType(options, v as ShootType))}
            options={[{ value: 'auto', label: GENERAL.label }, ...SHOOT_TYPES.map((type) => ({ value: type.id, label: type.label, note: type.sub }))]}
          />
          <p className="text-xs text-faint">{shootRule(options.shootType)}</p>
        </div>
      </div>
      <div className="flex flex-col rounded-2xl border border-line-soft bg-panel px-5 py-1">
        {CHECKS.map((c) => (
          <div key={c.key} className="flex h-11 items-center justify-between border-b border-line-soft last:border-0">
            <span className="text-[13px] text-muted">{t(c.label)}</span>
            <Switch label={t(c.label)} checked={options[c.key]} onChange={(v) => set({ [c.key]: v })} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Storage() {
  const fail = useApp((s) => s.fail);
  const [info, setInfo] = useState<CacheInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [freed, setFreed] = useState<number | null>(null);
  const load = () => api.cacheInfo().then(setInfo, fail);
  useEffect(() => {
    load();
  }, []);
  const clear = async () => {
    setBusy(true);
    try {
      setFreed(await api.clearCache());
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const clearable = info ? info.previews + info.full + info.unusedThumbs : 0;
  const rows: [string, string, number | undefined][] = [
    [t('Pratinjau tampilan besar'), t('Dibuat lagi saat foto dibuka'), info?.previews],
    [t('Gambar kualitas penuh'), t('Dibuat lagi saat di-zoom'), info?.full],
    [t('Thumbnail yang tidak terpakai'), t('Dari sesi yang sudah dihapus atau folder pilihan klien'), info?.unusedThumbs],
    [t('Thumbnail sesi tersimpan'), t('Tetap disimpan: dipakai di grid Review'), info?.thumbs],
  ];
  return (
    <div className="flex max-w-[620px] flex-col gap-5">
      <h1 className="text-[22px] font-semibold">{t('Penyimpanan & cache')}</h1>
      <p className="-mt-3 text-[13px] text-muted">
        {t('Cache hanya berisi salinan kecil untuk tampilan. Foto asli, file .xmp, dan folder hasil ekspor tidak pernah ada di sini.')}
      </p>
      <div className="flex flex-col gap-3 rounded-2xl border border-line-soft bg-panel p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] font-medium">{t('Lokasi cache')}</span>
            <span className="truncate text-xs text-faint">{info?.dir ?? '…'}</span>
          </div>
          <Button icon={FolderSearch} disabled={!info} onClick={() => info && revealItemInDir(info.dir)}>
            {isMac ? 'Finder' : 'Explorer'}
          </Button>
        </div>
        <div className="flex flex-col">
          {rows.map(([label, sub, size]) => (
            <div key={label} className="flex h-12 items-center justify-between gap-3 border-t border-line-soft">
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] text-muted">{label}</span>
                <span className="truncate text-[11px] text-faint">{sub}</span>
              </span>
              <span className="shrink-0 text-xs font-medium tabular-nums">{size == null ? '…' : bytes(size)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button icon={Trash2} disabled={busy || !clearable} onClick={clear}>
          {busy ? t('Membersihkan…') : t('Bersihkan {size}', { size: bytes(clearable) })}
        </Button>
        {freed != null && <span className="text-xs text-pick">{t('{size} dibebaskan.', { size: bytes(freed) })}</span>}
      </div>
      <p className="text-xs text-faint">
        {t(
          'Lokasi cache mengikuti sistem dan belum bisa dipindah. Untuk melepas semua thumbnail sebuah sesi, hapus sesinya dari Beranda.',
        )}
      </p>
    </div>
  );
}

/** Language names stay in their own language: that is how people find theirs. */
const NAMES = { id: 'Bahasa Indonesia', en: 'English' } as const;

function LanguagePicker() {
  const pref = useLang((s) => s.pref);
  const setPref = useLang((s) => s.setPref);
  const options: { value: LangPref; label: string; sub?: string }[] = [
    { value: 'system', label: t('Ikuti sistem'), sub: t('Sekarang: {name}', { name: NAMES[systemLang()] }) },
    { value: 'id', label: NAMES.id },
    { value: 'en', label: NAMES.en },
  ];
  return (
    <div className="flex max-w-[560px] flex-col gap-5">
      <h1 className="text-[22px] font-semibold">{t('Bahasa')}</h1>
      <div role="radiogroup" aria-label={t('Bahasa')} className="flex flex-col rounded-2xl border border-line-soft bg-panel px-5 py-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={pref === o.value}
            onClick={() => setPref(o.value)}
            className="flex min-h-12 items-center justify-between gap-3 border-b border-line-soft py-2 text-left last:border-0"
          >
            <span className="flex flex-col gap-0.5">
              <span className={cx('text-[13px]', pref === o.value ? 'font-semibold text-fg' : 'text-muted')}>{o.label}</span>
              {o.sub && <span className="text-[11px] text-faint">{o.sub}</span>}
            </span>
            <span
              className={cx(
                'size-[18px] shrink-0 rounded-full border-[1.5px]',
                pref === o.value ? 'border-gold bg-gold' : 'border-faint',
              )}
            />
          </button>
        ))}
      </div>
      <p className="text-xs text-faint">
        {t(
          'Menu bar ikut berganti. Keyword yang ditulis ke file .xmp tetap berbahasa Indonesia (pilihfotomu › pilih / cek / lewati), supaya daftar keyword di Lightroom tetap sama di setiap ekspor.',
        )}
      </p>
    </div>
  );
}

export function Settings({ back, initial = 'license' }: { back: Screen; initial?: Section }) {
  const go = useApp((s) => s.go);
  const [section, setSection] = useState<Section>(initial);
  const [version, setVersion] = useState('');
  useEffect(() => {
    getVersion().then(setVersion, () => {});
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && go(back);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, go]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar title={t('Pengaturan')} />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-line-soft bg-panel p-3 lg:w-60">
          <div className="mb-2 flex items-center gap-2">
            <IconButton icon={ArrowLeft} label={t('Kembali')} onClick={() => go(back)} />
            <span className="text-xs text-faint">Esc</span>
          </div>
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setSection(n.id)}
              className={cx(
                'flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px]',
                section === n.id ? 'bg-raised font-semibold text-fg' : 'text-muted hover:bg-panel-2',
              )}
            >
              <n.icon size={16} className={section === n.id ? 'text-gold-text' : undefined} />
              {t(n.label)}
            </button>
          ))}
        </nav>
        <main className="flex-1 overflow-y-auto px-6 py-8 lg:px-12 lg:py-9">
          {section === 'license' && (
            <div className="flex max-w-[560px] flex-col gap-5">
              <h1 className="text-[22px] font-semibold">{t('Lisensi & perangkat')}</h1>
              <div className="flex flex-col gap-3 rounded-2xl border border-line-soft bg-panel p-5">
                <span className="flex items-center gap-2.5 text-base font-semibold">
                  <BadgeCheck size={20} className="text-gold-text" /> {t('Versi pengembangan')}
                  <Chip color="var(--color-maybe)">{t('Belum perlu aktivasi')}</Chip>
                </span>
                <p className="text-[13px] text-muted">
                  {t(
                    'Aktivasi lisensi (1 lisensi = 1 perangkat, update gratis selamanya) menyusul. Untuk sekarang semua fitur terbuka.',
                  )}
                </p>
              </div>
            </div>
          )}
          {section === 'language' && <LanguagePicker />}
          {section === 'analysis' && <AnalysisDefaults />}
          {section === 'storage' && <Storage />}
          {section === 'keys' && <KeyEditor />}
          {section === 'brand' && <BrandSettings />}
          {section === 'legal' && (
            <div className="flex max-w-[640px] flex-col gap-5">
              <h1 className="text-[22px] font-semibold">{t('Dokumen hukum')}</h1>
              <LegalDocs />
            </div>
          )}
          {section === 'about' && (
            <div className="flex max-w-[560px] flex-col gap-3">
              <h1 className="text-[22px] font-semibold">pilihfotomu</h1>
              <p className="text-[13px] text-muted">{t('Versi {version}', { version: version || '—' })}</p>
              <p className="text-[13px] text-muted">
                {t('Semua foto diproses di perangkat ini. Tidak ada foto yang di-upload, dan file asli tidak pernah diubah.')}
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
