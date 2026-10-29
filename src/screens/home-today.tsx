/**
 * The top of Beranda: what today holds (from Kelola Bisnis — shoots, money
 * due, deliveries, and the month in three numbers) and what was left open
 * last (a culling session, a Buat konten design), one click from each.
 */

import { ArrowRight, CalendarClock, CalendarPlus, Images, LayoutTemplate, Send, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { cx } from '../components/ui';
import { api, thumbUrl, type SessionSummary } from '../lib/api';
import { date, num } from '../lib/format';
import { t } from '../lib/i18n';
import { useApp } from '../store';
import { balanceOf, dayKey, rupiah } from '../bisnis/model';
import { remindersOf } from '../bisnis/reminders';
import { useBisnis } from '../bisnis/store';
import { listDrafts, type Draft } from '../kreasi/drafts';

const ICON = { shoot: CalendarClock, due: Wallet, kirim: Send } as const;

export function Today() {
  const data = useBisnis((s) => s.data);
  const go = useApp((s) => s.go);
  const list = useMemo(() => (data ? remindersOf(data) : []), [data]);
  // The month in three numbers: bookings with a shoot in it, money received, money still owed.
  const month = useMemo(() => {
    if (!data) return null;
    const prefix = dayKey(new Date()).slice(0, 8);
    const inactive = new Set(data.columns.filter((c) => c.inactive).map((c) => c.id));
    const live = data.bookings.filter((b) => !inactive.has(b.columnId));
    return {
      shoots: live.filter((b) => b.sessions.some((s) => s.start.startsWith(prefix))).length,
      income: data.bookings.reduce((s, b) => s + b.payments.filter((p) => p.date.startsWith(prefix)).reduce((x, p) => x + p.amount, 0), 0),
      owed: live.reduce((s, b) => s + balanceOf(b), 0),
    };
  }, [data]);

  if (!data || !month) return null;
  const empty = !data.bookings.length;

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-[18px] border border-line-soft bg-panel p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{t('Hari ini')}</h2>
        <button type="button" onClick={() => go({ name: 'bisnis' })} className="flex items-center gap-1 text-xs font-medium text-gold-text hover:underline">
          {t('Buka Kelola Bisnis')} <ArrowRight size={13} />
        </button>
      </div>
      {empty ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-3 rounded-xl bg-panel-2 p-5">
          <span className="text-[13px] font-medium">{t('Jadwal, pembayaran, dan pengingat klien muncul di sini.')}</span>
          <span className="text-xs text-muted">{t('Catat booking pertama di Kelola Bisnis: tanggal foto, paket, dan DP-nya.')}</span>
          <button type="button" onClick={() => go({ name: 'bisnis' })} className="mt-1 flex h-9 items-center gap-2 rounded-[10px] bg-gold-gradient px-4 text-[13px] font-semibold text-white">
            <CalendarPlus size={15} /> {t('Catat booking')}
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                [t('Jadwal foto bulan ini'), num(month.shoots), 'text-fg'],
                [t('Masuk bulan ini'), rupiah(month.income), 'text-pick'],
                [t('Belum dibayar klien'), rupiah(month.owed), month.owed > 0 ? 'text-maybe' : 'text-fg'],
              ] as const
            ).map(([label, value, cls]) => (
              <div key={label} className="flex min-w-0 flex-col gap-1 rounded-xl bg-panel-2 px-3.5 py-3">
                <span className="truncate text-[11px] text-faint">{label}</span>
                <span className={cx('truncate text-[17px] font-semibold tabular-nums', cls)}>{value}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1">
            {list.length === 0 && <span className="rounded-xl bg-panel-2 px-4 py-4 text-xs text-faint">{t('Tidak ada jadwal atau tagihan yang perlu diingat hari ini dan besok.')}</span>}
            {list.slice(0, 4).map((r) => {
              const Icon = ICON[r.kind];
              return (
                <button key={r.key} type="button" onClick={() => go({ name: 'bisnis', open: r.booking.id })} className="flex items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-panel-2">
                  <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-lg', r.urgent ? 'bg-reject/15 text-reject' : 'bg-gold/15 text-gold-text')}>
                    <Icon size={15} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-medium">{r.title}</span>
                    <span className="truncate text-[11px] text-faint">{r.detail}</span>
                  </span>
                </button>
              );
            })}
            {list.length > 4 && (
              <button type="button" onClick={() => go({ name: 'bisnis' })} className="px-2 pt-1 text-left text-[11px] font-medium text-gold-text hover:underline">
                {t('{n} pengingat lagi', { n: list.length - 4 })}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** The last culling session and the last design, to carry on with. */
export function Recent() {
  const go = useApp((s) => s.go);
  const openSession = useApp((s) => s.openSession);
  const [session, setSession] = useState<SessionSummary | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft | null | undefined>(undefined);
  useEffect(() => {
    api.listSessions().then((l) => setSession(l.find((s) => s.available && s.kind !== 'edit') ?? null), () => setSession(null));
    listDrafts().then((l) => setDraft(l[0] ?? null), () => setDraft(null));
  }, []);
  const row = 'flex items-center gap-3 rounded-xl bg-panel-2 p-2.5 text-left hover:ring-1 hover:ring-line';
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-[18px] border border-line-soft bg-panel p-5">
      <h2 className="text-[15px] font-semibold">{t('Lanjutkan')}</h2>
      {session && (
        <button type="button" onClick={() => openSession(session.id)} className={row}>
          {session.covers[0] ? (
            <img src={thumbUrl(session.covers[0])} alt="" className="h-12 w-16 shrink-0 rounded-md object-cover" />
          ) : (
            <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded-md bg-raised text-faint">
              <Images size={16} />
            </span>
          )}
          <span className="flex min-w-0 flex-col">
            <span className="text-[11px] text-faint">{t('Pilih foto##mode')}</span>
            <span className="truncate text-[13px] font-medium">{session.name}</span>
            <span className="truncate text-[11px] text-faint">{t('{date} · {picks} dipilih', { date: date(session.createdAt), picks: num(session.picks) })}</span>
          </span>
        </button>
      )}
      {draft && (
        <button type="button" onClick={() => go({ name: 'kreasi', back: { name: 'home' } })} className={row}>
          <span className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-raised p-1">
            {draft.cover ? <img src={draft.cover} alt="" className="max-h-full max-w-full rounded-[2px] object-contain" /> : <LayoutTemplate size={16} className="text-faint" />}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[11px] text-faint">{t('Buat konten')}</span>
            <span className="truncate text-[13px] font-medium">{draft.name}</span>
            <span className="truncate text-[11px] text-faint">{new Date(draft.updatedAt).toLocaleDateString()}</span>
          </span>
        </button>
      )}
      {session === null && draft === null && <span className="flex flex-1 items-center rounded-xl bg-panel-2 px-4 py-4 text-xs text-faint">{t('Sesi foto dan desain yang terakhir dikerjakan muncul di sini.')}</span>}
    </section>
  );
}
