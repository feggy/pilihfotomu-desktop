/**
 * A booking at a glance, opened from anywhere it is listed: who, what, when,
 * what is paid and owed, where it stands — and what is usually done next
 * (move it on, record a payment, message the client, the invoice) without
 * opening the full form. Edit opens that.
 */

import { openUrl } from '@tauri-apps/plugin-opener';
import { AlertTriangle, ArrowRight, CalendarPlus, Link2, MapPin, Pencil, Phone, Plus, ReceiptText, X, Check, ChevronDown } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { DateInput } from '../components/date-picker';
import { Select } from '../components/select';
import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import type { BookingAction } from './booking-editor';
import { moveBooking } from './board';
import { PAY_COLOR, PAY_LABEL, balanceOf, clashesOf, clientOf, newId, paidOf, payState, rupiah, sessionWhen, shortDate, titleOf, today, totalOf } from './model';
import { nextColumn } from './overview';
import { googleCalendarLink } from './reminders';
import { useBisnis } from './store';
import { MoneyInput, PLAIN, btnPrimary, inputCls } from './ui';

const METHODS = ['Transfer', 'Tunai', 'QRIS', 'E-wallet'];

export function BookingDetail({
  bookingId,
  onClose,
  onEdit,
  onReceipt,
  actions,
}: {
  bookingId: string;
  onClose: () => void;
  onEdit: () => void;
  /** The kuitansi for one of its payments. */
  onReceipt: (paymentId: string) => void;
  actions: BookingAction[];
}) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const b = data.bookings.find((x) => x.id === bookingId);
  const [paying, setPaying] = useState<{ date: string; amount: number; method: string } | null>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  if (!b) return null;

  const client = clientOf(data, b);
  const next = nextColumn(data, b);
  const state = payState(b);
  const owed = balanceOf(b);
  const sessions = [...b.sessions].sort((x, y) => x.start.localeCompare(y.start));
  const savePayment = () => {
    if (!paying?.amount) return;
    update((d) => ({ ...d, bookings: d.bookings.map((x) => (x.id === b.id ? { ...x, payments: [...x.payments, { id: newId(), date: paying.date, amount: paying.amount, method: paying.method, note: x.payments.length ? '' : 'DP' }], updatedAt: Date.now() } : x)) }));
    setPaying(null);
  };

  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-30 flex justify-end bg-black/50" onMouseDown={onClose}>
      <aside onMouseDown={(e) => e.stopPropagation()} className="flex h-full w-[520px] max-w-full flex-col border-l border-line bg-panel shadow-2xl">
        <header className="flex shrink-0 items-start gap-3 border-b border-line-soft px-6 py-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h2 className="truncate text-lg font-semibold">{titleOf(data, b)}</h2>
            <span className="flex flex-wrap items-center gap-2 text-xs">
              <StagePicker current={b.columnId} onPick={(id) => update((d) => moveBooking(d, b.id, id, null))} />
              {next && (
                <button type="button" onClick={() => update((d) => moveBooking(d, b.id, next.id, null))} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 font-medium text-gold-text hover:border-gold">
                  {t('Lanjut ke {col}', { col: next.name })} <ArrowRight size={12} />
                </button>
              )}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Tutup')} className="mt-1 text-faint hover:text-fg">
            <X size={18} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <button key={a.key} type="button" onClick={() => a.run(b.id)} className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-3 text-xs font-medium hover:border-gold">
                {a.icon} {a.label}
              </button>
            ))}
          </div>

          <Block title={t('Klien')}>
            <span className="text-[13px] font-medium">{client?.name ?? '—'}</span>
            {client?.phone && (
              <span className="flex items-center gap-2 text-xs text-muted">
                <Phone size={12} /> {client.phone}
              </span>
            )}
            {client?.email && <span className="text-xs text-muted">{client.email}</span>}
          </Block>

          <Block title={t('Pembayaran')}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px]">{b.packageName || t('Tanpa paket')}</span>
              <span className="text-[13px] tabular-nums">{rupiah(b.packagePrice)}</span>
            </div>
            {b.addons.map((a, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 text-xs text-muted">
                <span>+ {a.name}</span>
                <span className="tabular-nums">{rupiah(a.price)}</span>
              </div>
            ))}
            {b.discount > 0 && (
              <div className="flex items-baseline justify-between gap-3 text-xs text-muted">
                <span>{t('Diskon')}</span>
                <span className="tabular-nums">− {rupiah(b.discount)}</span>
              </div>
            )}
            <div className="mt-1 grid grid-cols-3 gap-2">
              {(
                [
                  [t('Total'), rupiah(totalOf(b)), 'text-fg'],
                  [t('Terbayar'), rupiah(paidOf(b)), 'text-fg'],
                  [t('Sisa'), rupiah(owed), owed > 0 ? 'text-reject' : 'text-pick'],
                ] as const
              ).map(([label, value, cls]) => (
                <div key={label} className="flex flex-col gap-0.5 rounded-lg bg-bg px-3 py-2">
                  <span className="text-[11px] text-faint">{label}</span>
                  <span className={cx('text-[13px] font-semibold tabular-nums', cls)}>{value}</span>
                </div>
              ))}
            </div>
            <span className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1.5 font-medium" style={{ color: PAY_COLOR[state] }}>
                <span className="size-2 rounded-full" style={{ background: PAY_COLOR[state] }} />
                {t(PAY_LABEL[state])}
              </span>
              {b.dueDate && owed > 0 && <span className="text-faint">· {t('jatuh tempo {d}', { d: shortDate(b.dueDate) })}</span>}
            </span>
            {[...b.payments]
              .sort((x, y) => x.date.localeCompare(y.date))
              .map((p) => (
                <div key={p.id} className="group flex items-center gap-3 text-xs text-muted">
                  <span className="min-w-0 flex-1 truncate">
                    {shortDate(p.date)} · {p.method}
                    {p.note ? ` · ${p.note}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => onReceipt(p.id)}
                    title={p.receiptNo ? t('Kuitansi {no}', { no: p.receiptNo }) : t('Buat kuitansi untuk pembayaran ini')}
                    className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-gold-text hover:bg-raised"
                  >
                    <ReceiptText size={12} /> {t('Kuitansi')}
                  </button>
                  <span className="w-28 shrink-0 text-right text-fg tabular-nums">{rupiah(p.amount)}</span>
                </div>
              ))}
            {paying ? (
              <div className="flex flex-col gap-2 rounded-lg border border-gold/40 bg-bg p-2.5">
                <div className="grid grid-cols-[140px_1fr_110px] gap-2">
                  <DateInput value={paying.date} onChange={(date) => setPaying({ ...paying, date })} clearable={false} />
                  <MoneyInput value={paying.amount} onChange={(amount) => setPaying({ ...paying, amount })} />
                  <Select value={paying.method} onChange={(method) => setPaying({ ...paying, method })} options={METHODS.map((m) => ({ value: m, label: t(m) }))} />
                </div>
                <span className="flex justify-end gap-2">
                  <button type="button" onClick={() => setPaying(null)} className="h-8 px-3 text-xs text-muted hover:text-fg">
                    {t('Batal')}
                  </button>
                  <button type="button" onClick={savePayment} disabled={!paying.amount} className={cx(btnPrimary, 'h-8 px-3 text-xs')}>
                    {t('Simpan pembayaran')}
                  </button>
                </span>
              </div>
            ) : (
              owed > 0 && (
                <button type="button" onClick={() => setPaying({ date: today(), amount: owed, method: 'Transfer' })} className="flex items-center gap-1 self-start text-xs font-medium text-gold-text hover:underline">
                  <Plus size={12} /> {t('Catat pembayaran')}
                </button>
              )
            )}
          </Block>

          <Block title={t('Jadwal')}>
            {sessions.length === 0 && <span className="text-xs text-faint">{t('Belum ada jadwal.')}</span>}
            {sessions.map((s) => {
              const clashes = clashesOf(data, b, s);
              return (
                <div key={s.id} className="flex items-start gap-3 rounded-lg bg-bg p-3">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {s.label && <span className="text-[13px] font-medium">{s.label}</span>}
                    <span className="text-xs">{sessionWhen(s)}</span>
                    {s.location && (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        <MapPin size={11} /> {s.location}
                      </span>
                    )}
                    {clashes.length > 0 && (
                      <span className="mt-1 flex items-center gap-1 text-[11px] text-maybe">
                        <AlertTriangle size={11} /> {t('Bentrok dengan {n} jadwal lain', { n: clashes.length })}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      openUrl(googleCalendarLink([client?.name, s.label || b.packageName].filter(Boolean).join(' — '), s.start, s.end, s.location, [b.packageName, client?.phone && `WhatsApp: ${client.phone}`].filter(Boolean).join('\n'))).catch(() => {})
                    }
                    title={t('Tambah ke Google Calendar (dibuka di browser)')}
                    className="shrink-0 rounded-md p-1.5 text-faint hover:bg-raised hover:text-fg"
                  >
                    <CalendarPlus size={14} />
                  </button>
                </div>
              );
            })}
            {b.deliveryDate && <span className="text-xs text-muted">{t('Hasil dikirim paling lambat {d}', { d: shortDate(b.deliveryDate) })}</span>}
          </Block>

          <Block title={t('Link foto')}>
            <LinkRow label={t('Link foto untuk dipilih')} value={b.pickLink?.trim() ?? ''} onSave={(pickLink) => update((d) => ({ ...d, bookings: d.bookings.map((x) => (x.id === b.id ? { ...x, pickLink } : x)) }))} />
            <LinkRow label={t('Link hasil edit')} value={b.resultLink?.trim() ?? ''} onSave={(resultLink) => update((d) => ({ ...d, bookings: d.bookings.map((x) => (x.id === b.id ? { ...x, resultLink } : x)) }))} />
          </Block>

          {b.notes.trim() && (
            <Block title={t('Catatan')}>
              <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted">{b.notes}</p>
            </Block>
          )}
        </div>

        <footer className="flex shrink-0 justify-end gap-2 border-t border-line-soft px-6 py-3">
          <button type="button" onClick={onEdit} className={btnPrimary}>
            <Pencil size={14} /> {t('Edit booking')}
          </button>
        </footer>
      </aside>
    </div>
  );
}

/** A Drive link: opened with a click, changed in place (Simpan or Enter keeps it); empty, a line to add it. */
function LinkRow({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) {
    const save = () => (onSave(draft.trim()), setDraft(null));
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-gold/40 bg-bg p-2.5">
        <span className="text-[11px] text-faint">{label}</span>
        <input
          {...PLAIN}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => (e.key === 'Enter' ? save() : e.key === 'Escape' && (e.stopPropagation(), setDraft(null)))}
          placeholder="https://drive.google.com/…"
          className={inputCls}
        />
        <span className="flex justify-end gap-2">
          <button type="button" onClick={() => setDraft(null)} className="h-8 px-3 text-xs text-muted hover:text-fg">
            {t('Batal')}
          </button>
          <button type="button" onClick={save} disabled={draft.trim() === value} className={cx(btnPrimary, 'h-8 px-3 text-xs')}>
            {t('Simpan link')}
          </button>
        </span>
      </div>
    );
  }
  if (!value)
    return (
      <button type="button" onClick={() => setDraft('')} className="flex items-center gap-1 self-start text-xs font-medium text-gold-text hover:underline">
        <Plus size={12} /> {t('Tambah {label}', { label: label.toLowerCase() })}
      </button>
    );
  const web = /^https?:\/\//i.test(value);
  return (
    <div className="group flex items-center gap-1 rounded-lg bg-raised pr-1 hover:ring-1 hover:ring-line">
      <button type="button" disabled={!web} onClick={() => openUrl(value).catch(() => {})} title={web ? t('Buka di browser') : undefined} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left">
        <Link2 size={13} className="shrink-0 text-faint" />
        <span className="flex min-w-0 flex-col">
          <span className="text-[11px] text-faint">{label}</span>
          <span className={cx('truncate text-xs', web ? 'text-gold-text group-hover:underline' : 'text-muted')}>{value}</span>
        </span>
      </button>
      <button type="button" onClick={() => setDraft(value)} title={t('Ubah link')} className="shrink-0 rounded-md p-1.5 text-faint hover:bg-panel hover:text-fg">
        <Pencil size={13} />
      </button>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[11px] font-semibold tracking-wide text-faint uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** The booking's stage as a chip; a click lists every stage to move it to. */
function StagePicker({ current, onPick }: { current: string; onPick: (columnId: string) => void }) {
  const data = useBisnis((s) => s.data)!;
  const [open, setOpen] = useState(false);
  const col = data.columns.find((c) => c.id === current);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <span className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((v) => !v)} title={t('Ganti tahap')} className={cx('flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 font-medium hover:ring-1 hover:ring-line', open && 'ring-1 ring-gold')}>
        <span className="size-2 rounded-full" style={{ background: col?.color }} />
        {col?.name}
        <ChevronDown size={12} className="text-faint" />
      </button>
      {open && (
        <span className="absolute top-8 left-0 z-10 flex w-52 flex-col rounded-xl border border-line bg-panel-2 p-1 shadow-2xl">
          {data.columns.map((c) => (
            <button key={c.id} type="button" onClick={() => (setOpen(false), c.id !== current && onPick(c.id))} className={cx('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-raised', c.id === current && 'font-semibold')}>
              <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="flex-1 truncate">{c.name}</span>
              {c.id === current && <Check size={12} className="text-gold-text" />}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
