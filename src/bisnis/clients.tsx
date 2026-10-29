/**
 * Klien: everyone who has booked (added as bookings are made), with what
 * they booked, spent and still owe — a small CRM without being one. A client
 * is edited here, messaged, or booked again without typing them in twice.
 */

import { CalendarPlus, MessageCircle, Pencil, Search, Trash2, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { PAY_COLOR, PAY_LABEL, balanceOf, nextSession, paidOf, payState, rupiah, shortDate, titleOf, totalOf } from './model';
import { useBisnis } from './store';
import type { Booking, Client } from './types';
import { Dialog, Empty, Field, PLAIN, btnGhost, btnPlain, btnPrimary, inputCls } from './ui';

export function Clients({ onOpen, onNew, onMessage }: { onOpen: (b: Booking) => void; onNew: (clientId: string) => void; onMessage: (client: Client, bookingId: string | null) => void }) {
  const data = useBisnis((s) => s.data)!;
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [editing, setEditing] = useState<Client | null>(null);
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
        <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 py-1">
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
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-lg font-semibold text-gold-text">{row.client.name.slice(0, 1).toUpperCase()}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[17px] font-semibold">{row.client.name}</span>
                <span className="truncate text-xs text-muted">{[row.client.phone || t('Tanpa nomor'), row.client.email].filter(Boolean).join(' · ')}</span>
                {row.client.notes.trim() && <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-wrap text-faint">{row.client.notes}</p>}
              </div>
              <button type="button" onClick={() => setEditing(row.client)} className={cx(btnGhost, 'h-8 px-3 text-xs')}>
                <Pencil size={13} /> {t('Edit')}
              </button>
            </div>
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
      {editing && (
        <ClientForm
          client={editing}
          canDelete={!data.bookings.some((b) => b.clientId === editing.id)}
          onClose={() => setEditing(null)}
          onDeleted={() => setPicked(null)}
        />
      )}
    </div>
  );
}


/** A client's details changed in a form, kept by Simpan; one without bookings can be deleted here. */
function ClientForm({ client, canDelete, onClose, onDeleted }: { client: Client; canDelete: boolean; onClose: () => void; onDeleted: () => void }) {
  const update = useBisnis((s) => s.update);
  const [c, setC] = useState(client);
  const save = () => {
    const saved = { ...c, name: c.name.trim(), phone: c.phone.trim(), email: c.email.trim() };
    update((d) => ({ ...d, clients: d.clients.map((x) => (x.id === saved.id ? saved : x)) }));
    onClose();
  };
  return (
    <Dialog
      title={t('Edit klien')}
      onClose={onClose}
      width={520}
      footer={
        <>
          {canDelete && (
            <button type="button" onClick={() => (update((d) => ({ ...d, clients: d.clients.filter((x) => x.id !== client.id) })), onDeleted(), onClose())} className={cx(btnPlain, 'mr-auto hover:text-reject')}>
              <Trash2 size={14} /> {t('Hapus klien')}
            </button>
          )}
          <button type="button" onClick={onClose} className={btnPlain}>
            {t('Batal')}
          </button>
          <button type="button" onClick={save} disabled={!c.name.trim()} className={btnPrimary}>
            {t('Simpan')}
          </button>
        </>
      }
    >
      <Field label={t('Nama')}>
        <input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} autoFocus className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('Nomor WhatsApp')}>
          <input value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} inputMode="tel" className={inputCls} />
        </Field>
        <Field label={t('Email')}>
          <input type="email" {...PLAIN} value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} className={inputCls} />
        </Field>
      </div>
      <Field label={t('Catatan tentang klien')}>
        <textarea value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} rows={4} placeholder={t('Referensi dari siapa, preferensi, hal yang perlu diingat…')} className={cx(inputCls, 'h-auto resize-y py-2')} />
      </Field>
    </Dialog>
  );
}
