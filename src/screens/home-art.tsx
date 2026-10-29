/**
 * The pictures on Beranda's four cards: each mode shown at work, drawn from
 * sample photos (made for the app, no real clients) rather than a screenshot
 * — a small board with its reminder, a culled set with its marks, one photo
 * before and after, three stories made from photos. In a short window the
 * pictures get small, so what would crowd them (the reminder, the sliders,
 * the captions) steps out.
 */

import { CalendarClock, Check, ChevronsLeftRight, CircleHelp, Sparkles, X } from 'lucide-react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';

const PHOTO = (name: string) => `/home/${name}.jpg`;

/** Kelola Bisnis: four stages with a booking or two each, and tomorrow's shoot. */
export function BoardArt() {
  const card = (name: string, sub: string, color: string, pay: string) => (
    <span key={name} className="flex flex-col gap-0.5 rounded-lg bg-raised p-2">
      <span className="truncate text-[10px] font-semibold text-fg">{name}</span>
      <span className="truncate text-[9px] text-faint">{sub}</span>
      <span className="flex items-center gap-1 truncate text-[9px]" style={{ color }}>
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
        {pay}
      </span>
    </span>
  );
  const cols = [
    { color: 'var(--color-faint)', name: t('Tanya-tanya'), cards: [card('Sari & Andi', 'Wedding Silver', 'var(--color-reject)', t('Belum bayar'))] },
    { color: 'var(--color-gold)', name: t('DP masuk'), cards: [card('Rina & Dimas', 'Wedding Gold', 'var(--color-maybe)', 'DP · sisa 8,5 jt'), card('Maya', 'Maternity', 'var(--color-maybe)', 'DP · sisa 1 jt')] },
    { color: '#5b9bd5', name: t('Jadwal foto'), cards: [card('Budi Santoso', 'Prewedding', 'var(--color-pick)', t('Lunas'))] },
    { color: '#a678d6', name: t('Pilih & edit'), cards: [card('Wisuda Budi', 'Wisuda', 'var(--color-pick)', t('Lunas'))] },
  ];
  return (
    <span className="relative flex size-full gap-2 p-4">
      {cols.map((c) => (
        <span key={c.name} className="flex min-w-0 flex-1 flex-col gap-1.5 overflow-hidden rounded-xl bg-bg p-2">
          <span className="flex items-center gap-1.5 px-0.5 pb-0.5 text-[10px] font-semibold text-muted">
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: c.color }} />
            <span className="truncate">{c.name}</span>
          </span>
          {c.cards}
        </span>
      ))}
      <span className="absolute right-4 bottom-4 flex items-center gap-2 rounded-xl border border-gold bg-panel px-3 py-2 shadow-[0_8px_24px_rgb(0_0_0/0.45)] [@media(max-height:700px)]:hidden">
        <CalendarClock size={15} className="text-maybe" />
        <span className="flex flex-col">
          <span className="text-[11px] font-semibold text-fg">{t('Besok 08:00 · Akad')}</span>
          <span className="text-[10px] text-faint">Rina & Dimas · Masjid</span>
        </span>
      </span>
    </span>
  );
}

/** Pilih foto: six photos marked Pilih, Cek or Lewati, and the session's count. */
export function CullArt() {
  const marks = [
    ['wedding-garden', 'pick'],
    ['prewedding-kota-lama', 'pick'],
    ['reception', 'reject'],
    ['akad-makeup', 'maybe'],
    ['couple-seated', 'pick'],
    ['wedding-portrait', 'reject'],
  ] as const;
  const badge = { pick: ['bg-pick', Check], maybe: ['bg-maybe', CircleHelp], reject: ['bg-reject', X] } as const;
  return (
    <span className="relative grid size-full grid-cols-3 grid-rows-2 gap-2 p-3.5">
      {marks.map(([photo, mark]) => {
        const [bg, Icon] = badge[mark];
        return (
          <span key={photo} className="relative overflow-hidden rounded-[10px]">
            <img src={PHOTO(photo)} alt="" draggable={false} className={cx('size-full object-cover', mark === 'reject' && 'opacity-40')} />
            <span className={cx('absolute top-2 left-2 flex size-[22px] items-center justify-center rounded-full text-white', bg)}>
              <Icon size={13} strokeWidth={2.5} />
            </span>
          </span>
        );
      })}
      <span className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full bg-bg px-3 py-1.5 text-[11px] text-muted">
        {(
          [
            ['bg-pick', t('{n} Pilih', { n: 412 })],
            ['bg-maybe', t('{n} Cek', { n: 236 })],
            ['bg-reject', t('{n} Lewati', { n: 864 })],
          ] as const
        ).map(([dot, label]) => (
          <span key={label} className="flex items-center gap-1.5 whitespace-nowrap">
            <span className={cx('size-[7px] rounded-full', dot)} />
            {label}
          </span>
        ))}
      </span>
    </span>
  );
}

/** Edit foto: one photo, flat on the left and finished on the right, with a few of the sliders. */
export function EditArt() {
  const slider = (label: string, value: string, pct: number) => (
    <span className="flex flex-col gap-1">
      <span className="flex justify-between text-[10px]">
        <span className="text-muted">{label}</span>
        <span className="text-faint tabular-nums">{value}</span>
      </span>
      <span className="h-[3px] rounded-full bg-line">
        <span className="block h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
  return (
    <span className="relative block size-full">
      <img src={PHOTO('wedding-garden')} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
      {/* The same photo, before: duller and flatter, cut off where the divider is. */}
      <span className="absolute inset-y-0 left-0 w-[45%] overflow-hidden">
        <img src={PHOTO('wedding-garden')} alt="" draggable={false} className="absolute inset-y-0 left-0 h-full max-w-none object-cover brightness-[0.62] contrast-[0.8] saturate-[0.4]" style={{ width: `${100 / 0.45}%` }} />
      </span>
      <span className="absolute inset-y-0 left-[45%] w-0.5 -translate-x-1/2 bg-white" />
      <span className="absolute top-1/2 left-[45%] flex size-7 -translate-1/2 items-center justify-center rounded-full bg-white text-[#0b1310]">
        <ChevronsLeftRight size={14} />
      </span>
      <span className="absolute top-3 left-3 rounded-md bg-bg/90 px-2 py-0.5 text-[10px] text-muted">{t('Sebelum')}</span>
      <span className="absolute top-3 left-[calc(45%+12px)] rounded-md bg-bg/90 px-2 py-0.5 text-[10px] text-muted">{t('Sesudah')}</span>
      <span className="absolute top-1/2 right-4 flex w-36 -translate-y-1/2 flex-col gap-2.5 rounded-xl border border-line bg-panel p-3 shadow-[0_8px_24px_rgb(0_0_0/0.45)] [@media(max-height:700px)]:hidden">
        {slider(t('Eksposur'), '+0,45', 82)}
        {slider(t('Kontras'), '+12', 64)}
        {slider(t('Kehangatan'), '+8', 58)}
        <span className="flex items-center justify-center gap-1.5 rounded-md bg-raised py-1 text-[10px] text-gold-text">
          <Sparkles size={11} /> AI Denoise
        </span>
      </span>
    </span>
  );
}

/** Buat konten: three stories made from photos, fanned out. */
export function StoryArt() {
  const stories = [
    { photo: 'prewedding-kota-lama', title: 'Save the date', sub: '12 · 12 · 2026', tilt: '-rotate-6 translate-y-2' },
    { photo: 'akad-makeup', title: 'Rina & Dimas', sub: t('Akad nikah'), tilt: 'z-10 -translate-y-1' },
    { photo: 'graduation', title: 'Wisuda Budi', sub: 'Class of 2026', tilt: 'rotate-6 translate-y-2' },
  ];
  return (
    <span className="flex size-full items-center justify-center gap-4">
      {stories.map((s) => (
        <span key={s.title} className={cx('flex h-[82%] aspect-[118/210] flex-col overflow-hidden rounded-xl bg-[#f4efe6] shadow-[0_10px_30px_rgb(0_0_0/0.5)]', s.tilt)}>
          <img src={PHOTO(s.photo)} alt="" draggable={false} className="h-[71%] w-full object-cover [@media(max-height:700px)]:h-full" />
          <span className="flex flex-1 flex-col items-center justify-center gap-0.5 px-1 [@media(max-height:700px)]:hidden">
            <span className="truncate font-serif text-[13px] text-[#3b2f22]" style={{ fontFamily: '"Playfair Display", Georgia, serif' }}>
              {s.title}
            </span>
            <span className="text-[8px] text-[#8a7a63]">{s.sub}</span>
          </span>
        </span>
      ))}
    </span>
  );
}
