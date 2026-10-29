/**
 * Ringkasan: where Kelola Bisnis opens. Not every client at once (that is
 * the board) but what needs doing — each booking waiting on a next step,
 * with the step one click away — the week's shoots, the month, and the
 * stages with how many bookings stand in each.
 */

import { ArrowRight, CalendarClock, CalendarPlus, ChevronRight, CircleCheck, MessageCircle, Send, Wallet, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { moveBooking } from './board';
import { PAY_COLOR, PAY_LABEL, balanceOf, dayKey, longDate, nextSession, parseLocal, payState, rupiah, shortDate, timeOf, titleOf, totalOf } from './model';
import { Setup } from './setup';
import { useBisnis } from './store';
import type { BisnisData, Booking, Column } from './types';

/** The column after this booking's, skipping inactive ones (Batal): where "Lanjut" takes it. */
export function nextColumn(data: BisnisData, b: Booking): Column | null {
  const i = data.columns.findIndex((c) => c.id === b.columnId);
  return data.columns.slice(i + 1).find((c) => !c.inactive) ?? null;
}

const DAY = 86_400_000;
const addDays = (d: Date, n: number) => dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));

type Act = { label: string; icon: ReactNode; run: () => void; primary?: boolean };
type Task = { booking: Booking; why: string; tone: 'urgent' | 'soon' | 'info'; acts: Act[]; order: number };

export function Overview({
  onOpen,
  onEdit,
  onMessage,
  onStage,
  onAddPackage,
  onNewBooking,
}: {
  onOpen: (b: Booking) => void;
  /** The booking's form, for what only it holds (a session to add). */
  onEdit: (b: Booking) => void;
  onMessage: (bookingId: string, template: string) => void;
  /** A stage picked: show its bookings (on the board). */
  onStage: (columnId: string) => void;
  /** Persiapan's steps: a package to add, a first booking. */
  onAddPackage: () => void;
  onNewBooking: () => void;
}) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const [stage, setStage] = useState<string | null>(null);
  // A stage's list closes on a click outside the stages, or Escape.
  const stagesRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!stage) return;
    const down = (e: MouseEvent) => !stagesRef.current?.contains(e.target as Node) && setStage(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setStage(null);
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key);
    };
  }, [stage]);
  const now = new Date();
  const today = dayKey(now);
  const move = (b: Booking, to: Column) => update((d) => moveBooking(d, b.id, to.id, null));
  const doneCol = data.columns.find((c) => c.done && !c.inactive) ?? null;

  /**
   * What each booking waits on, most pressing first. The reasons read the
   * booking itself (paid? scheduled? shot? delivered?), so they hold for any
   * board the studio has set up; "Lanjut" moves it a column on.
   */
  const tasks = useMemo(() => {
    const out: Task[] = [];
    const firstCol = data.columns.find((c) => !c.inactive)?.id;
    for (const b of data.bookings) {
      const col = data.columns.find((c) => c.id === b.columnId);
      if (!col || col.inactive || col.done) continue;
      const next = nextColumn(data, b);
      const pay = payState(b);
      const sessions = [...b.sessions].sort((x, y) => x.start.localeCompare(y.start));
      const last = sessions[sessions.length - 1];
      const shotDone = !!last && parseLocal(last.end) < now;
      const upcoming = sessions.find((s) => parseLocal(s.start) >= now);
      const lanjut: Act | null = next ? { label: t('Lanjut ke {col}', { col: next.name }), icon: <ArrowRight size={13} />, run: () => move(b, next) } : null;
      const owed = balanceOf(b);

      if (b.deliveryDate && b.deliveryDate <= addDays(now, 2) && shotDone) {
        out.push({
          booking: b,
          why: b.deliveryDate < today ? t('Kirim hasil terlambat sejak {d}', { d: shortDate(b.deliveryDate) }) : t('Kirim hasil paling lambat {d}', { d: b.deliveryDate === today ? t('hari ini') : shortDate(b.deliveryDate) }),
          tone: b.deliveryDate <= today ? 'urgent' : 'soon',
          order: 0,
          acts: [
            doneCol && { label: t('Tandai terkirim'), icon: <CircleCheck size={13} />, run: () => move(b, doneCol), primary: true },
            { label: t('Kirim pesan'), icon: <MessageCircle size={13} />, run: () => onMessage(b.id, 'terima-kasih') },
          ].filter(Boolean) as Act[],
        });
        continue;
      }
      if (owed > 0 && b.dueDate && b.dueDate <= addDays(now, data.settings.remindDueDays)) {
        out.push({
          booking: b,
          why: b.dueDate < today ? t('Pelunasan {n} lewat jatuh tempo ({d})', { n: rupiah(owed), d: shortDate(b.dueDate) }) : t('Pelunasan {n} jatuh tempo {d}', { n: rupiah(owed), d: b.dueDate === today ? t('hari ini') : shortDate(b.dueDate) }),
          tone: b.dueDate <= today ? 'urgent' : 'soon',
          order: 1,
          acts: [
            { label: t('Kirim tagihan'), icon: <Send size={13} />, run: () => onMessage(b.id, 'tagihan'), primary: true },
            { label: t('Catat pembayaran'), icon: <Wallet size={13} />, run: () => onOpen(b) },
          ],
        });
        continue;
      }
      if (shotDone && lanjut && b.columnId !== firstCol) {
        out.push({ booking: b, why: t('Pemotretan selesai {d}', { d: shortDate(last!.start.split('T')[0]!) }), tone: 'info', order: 2, acts: [{ ...lanjut, primary: true }] });
        continue;
      }
      if (pay !== 'belum' && !sessions.length) {
        out.push({ booking: b, why: t('Sudah bayar, jadwal belum diatur'), tone: 'soon', order: 3, acts: [{ label: t('Atur jadwal'), icon: <CalendarPlus size={13} />, run: () => onEdit(b), primary: true }] });
        continue;
      }
      if (upcoming && owed > 0 && parseLocal(upcoming.start).getTime() - now.getTime() < 7 * DAY && !b.dueDate) {
        out.push({
          booking: b,
          why: t('Belum lunas ({n}), foto {d}', { n: rupiah(owed), d: longDate(upcoming.start.split('T')[0]!) }),
          tone: 'soon',
          order: 4,
          acts: [{ label: t('Kirim tagihan'), icon: <Send size={13} />, run: () => onMessage(b.id, 'tagihan'), primary: true }],
        });
        continue;
      }
      if (pay === 'belum' && b.columnId === firstCol && now.getTime() - b.createdAt > 3 * DAY) {
        out.push({
          booking: b,
          why: t('Belum DP sejak {n} hari lalu', { n: Math.floor((now.getTime() - b.createdAt) / DAY) }),
          tone: 'info',
          order: 5,
          acts: [
            { label: t('Tanya kabar'), icon: <MessageCircle size={13} />, run: () => onMessage(b.id, 'follow-up'), primary: true },
            { label: t('Catat DP'), icon: <Wallet size={13} />, run: () => onOpen(b) },
          ],
        });
      }
    }
    return out.sort((a, b) => a.order - b.order || (a.tone === 'urgent' ? -1 : 0) - (b.tone === 'urgent' ? -1 : 0));
  }, [data, today]);

  // The next seven days' shoots.
  const week = useMemo(() => {
    const end = addDays(now, 7);
    const inactive = new Set(data.columns.filter((c) => c.inactive).map((c) => c.id));
    return data.bookings
      .filter((b) => !inactive.has(b.columnId))
      .flatMap((b) => b.sessions.map((s) => ({ b, s })))
      .filter(({ s }) => s.start.split('T')[0]! >= today && s.start.split('T')[0]! < end)
      .sort((x, y) => x.s.start.localeCompare(y.s.start));
  }, [data, today]);

  // The month: new bookings, money in, money still owed, booked value.
  const month = useMemo(() => {
    const prefix = today.slice(0, 8);
    const inactive = new Set(data.columns.filter((c) => c.inactive).map((c) => c.id));
    const live = data.bookings.filter((b) => !inactive.has(b.columnId));
    const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    return {
      fresh: live.filter((b) => b.createdAt >= start).length,
      income: data.bookings.reduce((s, b) => s + b.payments.filter((p) => p.date.startsWith(prefix)).reduce((x, p) => x + p.amount, 0), 0),
      spent: data.expenses.filter((e) => e.date.startsWith(prefix)).reduce((s, e) => s + e.amount, 0),
      owed: live.reduce((s, b) => s + balanceOf(b), 0),
    };
  }, [data, today]);

  const inStage = stage ? data.bookings.filter((b) => b.columnId === stage).sort((a, b) => a.order - b.order) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-4 pb-10 lg:px-8">
      <div className="mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Setup onAddPackage={onAddPackage} onNewBooking={onNewBooking} />
        <section className="flex flex-col gap-3 rounded-2xl bg-panel p-4">
          <h2 className="flex items-center gap-2 text-[13px] font-semibold">
            {t('Perlu tindakan')}
            {tasks.length > 0 && <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold-text tabular-nums">{tasks.length}</span>}
          </h2>
          {tasks.length === 0 && (
            <span className="flex items-center gap-2 rounded-xl bg-panel-2 px-4 py-5 text-xs text-muted">
              <CircleCheck size={15} className="text-pick" /> {t('Semua booking sedang berjalan sesuai rencana.')}
            </span>
          )}
          {tasks.map((task) => (
            <div key={task.booking.id} className="flex flex-col gap-2.5 rounded-xl bg-panel-2 p-3.5 sm:flex-row sm:items-center">
              <button type="button" onClick={() => onOpen(task.booking)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                <span className={cx('mt-1 size-2 shrink-0 rounded-full', task.tone === 'urgent' ? 'bg-reject' : task.tone === 'soon' ? 'bg-maybe' : 'bg-faint')} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-semibold">{titleOf(data, task.booking)}</span>
                  <span className={cx('text-xs', task.tone === 'urgent' ? 'text-reject' : 'text-muted')}>{task.why}</span>
                  {task.booking.packageName && <span className="truncate text-[11px] text-faint">{task.booking.packageName} · {rupiah(totalOf(task.booking))}</span>}
                </span>
              </button>
              <span className="flex shrink-0 flex-wrap gap-1.5">
                {task.acts.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={a.run}
                    className={cx('flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium', a.primary ? 'bg-gold-gradient text-white' : 'border border-line text-muted hover:border-faint hover:text-fg')}
                  >
                    {a.icon} {a.label}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </section>

        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-3 rounded-2xl bg-panel p-4">
            <h2 className="text-[13px] font-semibold">{t('Jadwal 7 hari ke depan')}</h2>
            {week.length === 0 && <span className="rounded-xl bg-panel-2 px-4 py-4 text-xs text-faint">{t('Belum ada pemotretan minggu ini.')}</span>}
            {week.map(({ b, s }) => {
              const day = s.start.split('T')[0]!;
              const d = parseLocal(s.start);
              return (
                <button key={s.id} type="button" onClick={() => onOpen(b)} className="flex items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-panel-2">
                  <span className={cx('flex w-11 shrink-0 flex-col items-center rounded-lg py-1', day === today ? 'bg-gold text-bg' : 'bg-panel-2')}>
                    <span className="text-[10px] font-medium uppercase">{t(['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'][d.getDay()]!)}</span>
                    <span className="text-base leading-tight font-semibold">{d.getDate()}</span>
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium">
                      {titleOf(data, b)}
                      {s.label ? ` · ${s.label}` : ''}
                    </span>
                    <span className="truncate text-[11px] text-faint">
                      <CalendarClock size={11} className="mr-1 inline" />
                      {timeOf(s.start)}–{timeOf(s.end)}
                      {s.location ? ` · ${s.location}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
          <section className="grid grid-cols-2 gap-2 rounded-2xl bg-panel p-4">
            <h2 className="col-span-2 text-[13px] font-semibold">{t('Bulan ini')}</h2>
            {(
              [
                [t('Booking baru'), String(month.fresh), 'text-fg'],
                [t('Pemasukan'), rupiah(month.income), 'text-pick'],
                [t('Laba'), rupiah(month.income - month.spent), month.income - month.spent >= 0 ? 'text-fg' : 'text-reject'],
                [t('Piutang'), rupiah(month.owed), month.owed > 0 ? 'text-maybe' : 'text-fg'],
              ] as const
            ).map(([label, value, cls]) => (
              <div key={label} className="flex min-w-0 flex-col gap-0.5 rounded-xl bg-panel-2 px-3 py-2.5">
                <span className="truncate text-[11px] text-faint">{label}</span>
                <span className={cx('truncate text-[15px] font-semibold tabular-nums', cls)}>{value}</span>
              </div>
            ))}
          </section>
        </div>
        {/* Stages: how many bookings stand where; one picked lists them, each a click from the next stage. */}
        <section ref={stagesRef} className="flex flex-col gap-3 rounded-2xl bg-panel p-4 lg:col-span-2">
          <h2 className="flex items-center justify-between text-[13px] font-semibold">
            {t('Alur booking')}
            {stage && (
              <button type="button" onClick={() => setStage(null)} aria-label={t('Tutup')} title={t('Tutup (Esc)')} className="rounded-md p-1 text-faint hover:bg-raised hover:text-fg">
                <X size={14} />
              </button>
            )}
          </h2>
          <div className="-m-1 flex items-stretch gap-1 overflow-x-auto p-1">
            {data.columns.map((c, i) => {
              const n = data.bookings.filter((b) => b.columnId === c.id).length;
              return (
                <span key={c.id} className="flex min-w-0 flex-1 items-center gap-1">
                  {i > 0 && <ChevronRight size={14} className="shrink-0 text-faint" />}
                  <button
                    type="button"
                    onClick={() => setStage(stage === c.id ? null : c.id)}
                    className={cx('flex min-w-[96px] flex-1 flex-col gap-1 rounded-xl border px-3 py-2.5 text-left', stage === c.id ? 'border-gold bg-raised' : 'border-panel-2 bg-panel-2 hover:border-raised hover:bg-raised', c.inactive && 'opacity-60')}
                  >
                    <span className="flex items-center gap-1.5 truncate text-[11px] text-muted">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />
                      {c.name}
                    </span>
                    <span className="text-xl font-semibold tabular-nums">{n}</span>
                  </button>
                </span>
              );
            })}
          </div>
          {stage && (
            <div className="flex flex-col gap-1">
              {inStage.length === 0 && <span className="px-1 py-2 text-xs text-faint">{t('Belum ada booking di tahap ini.')}</span>}
              {inStage.map((b) => {
                const next = nextColumn(data, b);
                const s = nextSession(b);
                const pay = payState(b);
                return (
                  <div key={b.id} className="flex items-center gap-3 rounded-xl bg-bg px-3 py-2">
                    <button type="button" onClick={() => onOpen(b)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{titleOf(data, b)}</span>
                      <span className="hidden shrink-0 text-[11px] text-faint sm:inline">{s ? `${shortDate(s.start.split('T')[0]!)} · ${timeOf(s.start)}` : t('Belum ada jadwal')}</span>
                      <span className="w-20 shrink-0 text-right text-[11px] font-medium" style={{ color: PAY_COLOR[pay] }}>
                        {t(PAY_LABEL[pay])}
                      </span>
                    </button>
                    {next && (
                      <button type="button" onClick={() => move(b, next)} className="flex h-7 shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 text-[11px] font-medium text-muted hover:border-gold hover:text-fg">
                        {next.name} <ArrowRight size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
              <button type="button" onClick={() => onStage(stage)} className="self-start px-1 pt-1 text-[11px] font-medium text-gold-text hover:underline">
                {t('Lihat di board')}
              </button>
            </div>
          )}
        </section>

      </div>
    </div>
  );
}
