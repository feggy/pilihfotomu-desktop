/**
 * Klien: everyone who has booked (added as bookings are made), with what
 * they booked, spent and still owe — a small CRM without being one. A client
 * is edited here, messaged, or booked again without typing them in twice.
 */

import { CalendarPlus, MessageCircle, Search, Trash2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { PAY_COLOR, PAY_LABEL, balanceOf, nextSession, paidOf, payState, rupiah, shortDate, titleOf, totalOf } from './model';
import { useBisnis } from './store';
import type { Booking, Client } from './types';
import { Empty, Field, LazyInput, TextArea, btnGhost, btnPrimary } from './ui';

export function Clients({ onOpen, onNew, onMessage }: { onOpen: (b: Booking) => void; onNew: (clientId: string) => void; onMessage: (client: Client, bookingId: string | null) => void }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const inactive = useMemo(() => new Set(data.columns.filter((c) => c.inactive).map((c) => c.id)), [data.columns]);

  // Each client with their bookings and money, newest activity first.
  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return data.clients
      .filter((c) => !query || c.name.toLowerCase().includes(query) || c.phone.includes(query) || c.email.toLowerCase().includes(query))
      .map((c) => {
        const bookings = data.bookings.filter((b) => b.clientId === c.id);
        const live = bookings.filter((b) => !inactive.has(b.columnId));
        return {
          client: c,
          bookings,
          value: live.reduce((s, b) => s + totalOf(b), 0),
          owed: live.reduce((s, b) => s + balanceOf(b), 0),
          last: Math.max(c.createdAt, ...bookings.map((b) => b.updatedAt)),
        };
      })
      .sort((a, b) => b.last - a.last);
  }, [data, q, inactive]);
  const row = rows.find((r) => r.client.id === picked) ?? null;
  const setClient = (id: string, patch: Partial<Client>) => update((d) => ({ ...d, clients: d.clients.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));

  if (!data.clients.length)
    return (
      <div className="px-6 pt-6 lg:px-8">
        <Empty icon={<Users size={22} />} title={t('Belum ada klien')} text={t('Klien tercatat sendiri saat kamu membuat booking. Booking berikutnya tinggal pilih nama mereka.')} />
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 gap-4 px-6 pt-4 pb-6 lg:px-8">
      <div className="flex w-[420px] shrink-0 flex-col gap-2">
        <label className="flex h-9 items-center gap-2 rounded-[10px] border border-line bg-panel px-3 focus-within:border-gold">
          <Search size={14} className="text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Cari nama atau nomor…')} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
        </label>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {rows.map((r) => (
            <button
              key={r.client.id}
              type="button"
              onClick={() => setPicked(r.client.id)}
              className={cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-left', picked === r.client.id ? 'bg-raised ring-1 ring-gold' : 'hover:bg-panel')}
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-[13px] font-semibold text-gold-text">{r.client.name.slice(0, 1).toUpperCase()}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-semibold">{r.client.name}</span>
                <span className="truncate text-[11px] text-faint">
                  {r.client.phone || t('Tanpa nomor')} · {t('{n} booking', { n: r.bookings.length })}
                </span>
              </span>
              <span className="flex flex-col items-end text-[11px] tabular-nums">
                <span className="text-muted">{rupiah(r.value)}</span>
                {r.owed > 0 && <span className="text-reject">{t('sisa {n}', { n: rupiah(r.owed) })}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto rounded-2xl bg-panel p-5">
        {!row ? (
          <p className="m-auto text-xs text-faint">{t('Pilih klien untuk melihat booking dan datanya.')}</p>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <div className="grid min-w-0 flex-1 grid-cols-3 gap-3">
                <Field label={t('Nama')}>
                  <LazyInput value={row.client.name} onCommit={(name) => name.trim() && setClient(row.client.id, { name: name.trim() })} />
                </Field>
                <Field label={t('Nomor WhatsApp')}>
                  <LazyInput value={row.client.phone} onCommit={(phone) => setClient(row.client.id, { phone: phone.trim() })} />
                </Field>
                <Field label={t('Email')}>
                  <LazyInput email value={row.client.email} onCommit={(email) => setClient(row.client.id, { email: email.trim() })} />
                </Field>
              </div>
              {row.bookings.length === 0 && (
                <button type="button" onClick={() => (update((d) => ({ ...d, clients: d.clients.filter((c) => c.id !== row.client.id) })), setPicked(null))} title={t('Hapus klien')} className="mt-5 rounded-lg p-2 text-faint hover:text-reject">
                  <Trash2 size={15} />
                </button>
              )}
            </div>
            <Field label={t('Catatan tentang klien')}>
              <TextArea value={row.client.notes} onCommit={(notes) => setClient(row.client.id, { notes })} rows={2} placeholder={t('Referensi dari siapa, preferensi, hal yang perlu diingat…')} />
            </Field>
            <div className="flex gap-2">
              <button type="button" onClick={() => onNew(row.client.id)} className={btnPrimary}>
                <CalendarPlus size={14} /> {t('Booking baru')}
              </button>
              <button type="button" onClick={() => onMessage(row.client, [...row.bookings].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null)} className={btnGhost}>
                <MessageCircle size={14} /> {t('WhatsApp')}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {(
                [
                  [t('Nilai booking'), rupiah(row.value), 'text-fg'],
                  [t('Sudah dibayar'), rupiah(row.bookings.filter((b) => !inactive.has(b.columnId)).reduce((s, b) => s + paidOf(b), 0)), 'text-fg'],
                  [t('Belum dibayar'), rupiah(row.owed), row.owed > 0 ? 'text-reject' : 'text-pick'],
                ] as const
              ).map(([label, value, cls]) => (
                <div key={label} className="flex flex-col gap-1 rounded-xl bg-bg px-4 py-3">
                  <span className="text-[11px] text-faint">{label}</span>
                  <span className={cx('text-[15px] font-semibold tabular-nums', cls)}>{value}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold tracking-wide text-faint uppercase">{t('Booking')}</span>
              {[...row.bookings]
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((b) => {
                  const next = nextSession(b);
                  const pay = payState(b);
                  const col = data.columns.find((c) => c.id === b.columnId);
                  return (
                    <button key={b.id} type="button" onClick={() => onOpen(b)} className="flex items-center gap-3 rounded-xl bg-bg px-3 py-2.5 text-left hover:ring-1 hover:ring-line">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: col?.color }} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[13px] font-medium">{b.packageName || titleOf(data, b)}</span>
                        <span className="text-[11px] text-faint">
                          {col?.name} · {next ? shortDate(next.start.split('T')[0]!) : t('Belum ada jadwal')}
                        </span>
                      </span>
                      <span className="text-[11px] font-medium" style={{ color: PAY_COLOR[pay] }}>
                        {t(PAY_LABEL[pay])}
                      </span>
                      <span className="w-28 text-right text-[13px] tabular-nums">{rupiah(totalOf(b))}</span>
                    </button>
                  );
                })}
              {row.bookings.length === 0 && <span className="text-xs text-faint">{t('Belum ada booking.')}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

