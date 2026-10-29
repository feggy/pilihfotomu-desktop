/**
 * Beranda's tiles: Pilih foto big, with the last session's own photos and a
 * way back into it; Edit foto and Buat konten beside it, the last design in
 * its tile; Kelola Bisnis small (today's shoots and money once it is used,
 * a line on what it is before); and the work left open last, as a strip.
 * The sample pictures only stand in until there is work of one's own.
 */

import { ArrowRight, Briefcase, CalendarClock, FolderSearch, Images, LayoutTemplate, Send, SlidersHorizontal, Sparkles, Wallet, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { cx } from '../components/ui';
import { api, thumbUrl, type SessionSummary } from '../lib/api';
import { date, num } from '../lib/format';
import { t } from '../lib/i18n';
import { useApp } from '../store';
import { balanceOf, dayKey, rupiah } from '../bisnis/model';
import { remindersOf } from '../bisnis/reminders';
import { useBisnis } from '../bisnis/store';
import { listDrafts, type Draft } from '../kreasi/drafts';
import { chooseFolder } from './home';

/** The sessions and designs, loaded once for every tile. */
export function useRecentWork() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  useEffect(() => {
    api.listSessions().then((l) => setSessions(l.filter((s) => s.available)), () => setSessions([]));
    listDrafts().then(setDrafts, () => setDrafts([]));
  }, []);
  return { sessions, drafts };
}

/** A session opened only to edit goes back to Edit foto; a culled one to its results. */
async function openWork(s: SessionSummary) {
  const { go, openSession, fail } = useApp.getState();
  if (s.kind !== 'edit') return openSession(s.id);
  try {
    useApp.setState({ session: await api.openSession(s.id) });
    go({ name: 'edit', back: { name: 'home' } });
  } catch (e) {
    fail(e);
  }
}

/** A tile: a picture filling its top, the words under it. Clicked anywhere but its own buttons, it opens the mode. */
function Tile({ className, picture, icon: Icon, title, children, onOpen, highlight }: { className?: string; picture: ReactNode; icon: LucideIcon; title: string; children?: ReactNode; onOpen: () => void; highlight?: boolean }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen()}
      className={cx(
        'group flex min-h-56 cursor-pointer flex-col overflow-hidden rounded-[20px] border bg-panel text-left outline-none',
        highlight ? 'border-2 border-gold' : 'border-line-soft hover:border-gold/70 focus-visible:border-gold/70',
        className,
      )}
    >
      <div className="relative m-3 mb-0 min-h-28 flex-1 overflow-hidden rounded-xl bg-panel-2">
        <div className="absolute inset-0 transition-transform duration-500 group-hover:scale-[1.02]">{picture}</div>
      </div>
      <div className="flex flex-col gap-2 px-5 pt-3.5 pb-4">
        <span className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-raised text-gold-text">
            <Icon size={16} />
          </span>
          <span className="text-[17px] font-semibold">{title}</span>
          <span className="ml-auto flex size-[30px] items-center justify-center rounded-full bg-raised text-white transition-transform group-hover:translate-x-0.5 group-hover:bg-gold-gradient">
            <ArrowRight size={15} />
          </span>
        </span>
        {children}
      </div>
    </div>
  );
}

/**
 * A sample picture (it has its own frame and labels): shown whole, centred
 * on the colour of its own background, its baked-in corners rounded off.
 */
const cover = (src: string) => (
  <div className="flex size-full items-center justify-center bg-bg">
    <img src={src} alt="" draggable={false} className="aspect-[296/196] max-h-full max-w-full rounded-2xl object-cover" />
  </div>
);

/** Up to four of a session's own photos, side by side. */
function Mosaic({ ids }: { ids: string[] }) {
  const shown = ids.slice(0, ids.length >= 4 ? 4 : 1);
  return (
    <div className={cx('grid size-full gap-0.5', shown.length === 4 && 'grid-cols-2 grid-rows-2')}>
      {shown.map((id) => (
        <img key={id} src={thumbUrl(id)} alt="" draggable={false} className="size-full object-cover" />
      ))}
    </div>
  );
}

export function PilihTile({ sessions, dragging, className }: { sessions: SessionSummary[] | null; dragging: boolean; className?: string }) {
  const go = useApp((s) => s.go);
  const last = sessions?.find((s) => s.kind !== 'edit' && s.covers.length);
  const btn = 'flex h-9 items-center gap-2 rounded-[10px] px-3.5 text-[13px] font-semibold';
  return (
    <Tile className={className} highlight={dragging} picture={last ? <Mosaic ids={last.covers} /> : cover('/home/pilih.jpg')} icon={Sparkles} title={t('Pilih foto##mode')} onOpen={() => go({ name: 'pilih' })}>
      {dragging ? (
        <span className="text-[13px] font-medium text-gold-text">{t('Lepas untuk memilah foto di folder ini')}</span>
      ) : last ? (
        <span className="text-xs text-muted">{t('Terakhir: {name} · {picks} dipilih dari {total}', { name: last.name, picks: num(last.picks), total: num(last.total) })}</span>
      ) : (
        <span className="max-w-md text-xs text-muted">{t('Ratusan foto sesi dipilah otomatis jadi Pilih, Cek, dan Lewati, lengkap dengan alasannya.')}</span>
      )}
      <span className="mt-1 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
        {last && (
          <button type="button" onClick={() => openWork(last)} className={cx(btn, 'bg-gold-gradient text-white')}>
            {t('Lanjutkan sesi')}
          </button>
        )}
        <button type="button" onClick={() => chooseFolder()} className={cx(btn, last ? 'border border-line text-fg hover:border-gold/70' : 'bg-gold-gradient text-white')}>
          <FolderSearch size={15} /> {t('Pilah folder baru')} <span className="font-normal opacity-70">⌘O</span>
        </button>
      </span>
    </Tile>
  );
}

export function EditTile({ sessions, className }: { sessions: SessionSummary[] | null; className?: string }) {
  const go = useApp((s) => s.go);
  const last = sessions?.find((s) => s.kind === 'edit');
  return (
    <Tile className={className} picture={cover('/home/edit.jpg')} icon={SlidersHorizontal} title={t('Edit foto')} onOpen={() => go({ name: 'edit', back: { name: 'home' } })}>
      <span className="line-clamp-2 text-xs text-muted">{last ? t('Terakhir: {name}', { name: last.name }) : t('Cahaya dan warna ala Lightroom, AI denoise, masking, preset.')}</span>
    </Tile>
  );
}

export function KontenTile({ drafts, className }: { drafts: Draft[] | null; className?: string }) {
  const go = useApp((s) => s.go);
  const last = drafts?.find((d) => d.cover);
  return (
    <Tile
      className={className}
      picture={last?.cover ? <div className="flex size-full items-center justify-center p-3"><img src={last.cover} alt="" draggable={false} className="max-h-full max-w-full rounded-md object-contain shadow-2xl" /></div> : cover('/home/konten.jpg')}
      icon={LayoutTemplate}
      title={t('Buat konten')}
      onOpen={() => go({ name: 'kreasi', back: { name: 'home' } })}
    >
      <span className="line-clamp-2 text-xs text-muted">{last ? t('Terakhir: {name}', { name: last.name }) : t('Story dan feed Instagram dari template.')}</span>
    </Tile>
  );
}

const ICON = { shoot: CalendarClock, due: Wallet, kirim: Send } as const;

/** Kelola Bisnis, small: today and tomorrow once it is used, a line on what it is before. */
export function BisnisTile({ className }: { className?: string }) {
  const data = useBisnis((s) => s.data);
  const go = useApp((s) => s.go);
  const list = useMemo(() => (data ? remindersOf(data) : []), [data]);
  const owed = useMemo(() => {
    if (!data) return 0;
    const inactive = new Set(data.columns.filter((c) => c.inactive).map((c) => c.id));
    return data.bookings.filter((b) => !inactive.has(b.columnId)).reduce((s, b) => s + balanceOf(b), 0);
  }, [data]);
  const income = useMemo(() => {
    const prefix = dayKey(new Date()).slice(0, 8);
    return (data?.bookings ?? []).reduce((s, b) => s + b.payments.filter((p) => p.date.startsWith(prefix)).reduce((x, p) => x + p.amount, 0), 0);
  }, [data]);
  const used = !!data?.bookings.length;
  return (
    <button type="button" onClick={() => go({ name: 'bisnis' })} className={cx('group flex min-w-0 flex-col gap-3 rounded-[20px] border border-line-soft bg-panel p-5 text-left hover:border-gold/70', className)}>
      <span className="flex items-center gap-2.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-raised text-gold-text">
          <Briefcase size={16} />
        </span>
        <span className="text-[15px] font-semibold">{t('Kelola Bisnis')}</span>
        <ArrowRight size={15} className="ml-auto text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
      </span>
      {!used ? (
        <span className="text-xs leading-relaxed text-muted">{t('Booking klien, jadwal, invoice, dan pesan WhatsApp di satu tempat.')}</span>
      ) : (
        <>
          <span className="grid grid-cols-2 gap-2">
            <span className="flex min-w-0 flex-col rounded-xl bg-panel-2 px-3 py-2">
              <span className="truncate text-[10px] text-faint">{t('Masuk bulan ini')}</span>
              <span className="truncate text-[13px] font-semibold text-pick tabular-nums">{rupiah(income)}</span>
            </span>
            <span className="flex min-w-0 flex-col rounded-xl bg-panel-2 px-3 py-2">
              <span className="truncate text-[10px] text-faint">{t('Belum dibayar')}</span>
              <span className={cx('truncate text-[13px] font-semibold tabular-nums', owed > 0 ? 'text-maybe' : 'text-fg')}>{rupiah(owed)}</span>
            </span>
          </span>
          {list.length === 0 && <span className="text-[11px] text-faint">{t('Tidak ada jadwal atau tagihan hari ini dan besok.')}</span>}
          {list.slice(0, 2).map((r) => {
            const Icon = ICON[r.kind];
            return (
              <span key={r.key} className="flex items-center gap-2.5">
                <Icon size={14} className={cx('shrink-0', r.urgent ? 'text-reject' : 'text-gold-text')} />
                <span className="min-w-0 flex-1 truncate text-xs">{r.title}</span>
              </span>
            );
          })}
          {list.length > 2 && <span className="text-[11px] text-faint">{t('{n} pengingat lagi', { n: list.length - 2 })}</span>}
        </>
      )}
    </button>
  );
}

/** The work left open last, newest first: sessions and designs side by side. */
export function RecentStrip({ sessions, drafts, className }: { sessions: SessionSummary[] | null; drafts: Draft[] | null; className?: string }) {
  const go = useApp((s) => s.go);
  const items = [
    ...(sessions ?? []).map((s) => ({ key: `s${s.id}`, at: s.createdAt, label: s.kind === 'edit' ? t('Edit foto') : t('Pilih foto##mode'), name: s.name, sub: s.kind === 'edit' ? date(s.createdAt) : t('{picks} dipilih', { picks: num(s.picks) }), img: s.covers[0] ? thumbUrl(s.covers[0]) : null, contain: false, open: () => openWork(s) })),
    ...(drafts ?? []).map((d) => ({ key: `d${d.id}`, at: d.updatedAt, label: t('Buat konten'), name: d.name, sub: new Date(d.updatedAt).toLocaleDateString(), img: d.cover, contain: true, open: () => go({ name: 'kreasi', back: { name: 'home' } }) })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 5);
  return (
    <section className={cx('flex min-w-0 flex-col gap-3 rounded-[20px] border border-line-soft bg-panel p-5', className)}>
      <h2 className="text-[15px] font-semibold">{t('Lanjutkan')}</h2>
      {sessions && drafts && !items.length && <span className="flex flex-1 items-center rounded-xl bg-panel-2 px-4 py-4 text-xs text-faint">{t('Sesi foto dan desain yang terakhir dikerjakan muncul di sini.')}</span>}
      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          {items.map((x) => (
            <button key={x.key} type="button" onClick={x.open} className="group flex min-w-0 flex-col gap-1.5 text-left">
              <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-xl bg-panel-2 ring-line group-hover:ring-1">
                {x.img ? <img src={x.img} alt="" draggable={false} className={x.contain ? 'max-h-full max-w-full p-1.5 object-contain' : 'size-full object-cover'} /> : <Images size={18} className="text-faint" />}
              </span>
              <span className="truncate text-[10px] text-faint">{x.label}</span>
              <span className="-mt-1 truncate text-xs font-medium">{x.name}</span>
              <span className="-mt-1 truncate text-[10px] text-faint">{x.sub}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
