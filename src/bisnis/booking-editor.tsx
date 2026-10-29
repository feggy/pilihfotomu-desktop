/**
 * A booking, new or opened: who, which package and extras, when (any number
 * of sessions, each checked for clashes), where it stands, and what is due.
 * Edits stay here until Simpan.
 */

import { openUrl } from '@tauri-apps/plugin-opener';
import { AlertTriangle, ArrowRight, CalendarPlus, Plus, Trash2, Wallet, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { PAY_COLOR, PAY_LABEL, balanceOf, clashesOf, localString, newId, paidOf, parseLocal, payState, rupiah, shortDate, timeOf, titleOf, today, totalOf } from './model';
import { nextColumn } from './overview';
import { googleCalendarLink } from './reminders';
import { useBisnis } from './store';
import { DateInput, TimeInput } from '../components/date-picker';
import type { BisnisData, Booking, Client, Payment, Session } from './types';
import { Dialog, Field, MoneyInput, PLAIN, SectionTitle, btnPlain, btnPrimary, inputCls } from './ui';

/** A new booking in column `columnId`, its first session on `day` if given. */
export function newBooking(data: BisnisData, columnId: string, day?: string): Booking {
  const now = Date.now();
  return {
    id: newId(),
    clientId: '',
    title: '',
    packageId: null,
    packageName: '',
    packagePrice: 0,
    addons: [],
    discount: 0,
    sessions: day ? [sessionOn(day, 120)] : [],
    columnId: columnId || data.columns[0]?.id || '',
    order: Math.max(0, ...data.bookings.filter((b) => b.columnId === columnId).map((b) => b.order + 1)),
    payments: [],
    dueDate: '',
    deliveryDate: '',
    notes: '',
    invoiceNo: '',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Sessions given a package's length: the only one always (it is the shoot),
 * others only while still as long as the last package said — one whose
 * hours were set by hand (a two-hour akad, a long resepsi) keeps them.
 */
function fitSessions(sessions: Session[], before: number, minutes: number): Session[] {
  return sessions.map((s) => {
    const start = parseLocal(s.start);
    const len = (parseLocal(s.end).getTime() - start.getTime()) / 60_000;
    if (sessions.length > 1 && len !== before) return s;
    return { ...s, end: localString(new Date(start.getTime() + minutes * 60_000)) };
  });
}

const sessionOn = (day: string, minutes: number, label = ''): Session => {
  const start = parseLocal(`${day}T09:00`);
  return { id: newId(), label, start: localString(start), end: localString(new Date(start.getTime() + minutes * 60_000)), location: '' };
};

/** Something done with a booking from its form (an invoice, a message): the booking is saved first, the form closed. */
export interface BookingAction {
  key: string;
  label: string;
  icon: ReactNode;
  run: (bookingId: string) => void;
}

export function BookingEditor({ initial, onClose, actions = [] }: { initial: Booking; onClose: () => void; actions?: BookingAction[] }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const isNew = !data.bookings.some((b) => b.id === initial.id);
  const [b, setB] = useState<Booking>(initial);
  const known = data.clients.find((c) => c.id === initial.clientId);
  const [client, setClient] = useState<Pick<Client, 'id' | 'name' | 'phone' | 'email'>>(known ?? { id: '', name: '', phone: '', email: '' });
  const [asking, setAsking] = useState(false);
  const set = (patch: Partial<Booking>) => setB((x) => ({ ...x, ...patch }));
  const pkg = data.packages.find((p) => p.id === b.packageId);
  const duration = pkg?.durationMin ?? 120;

  // Clients whose name or number starts like what is typed: pick one instead of typing it all again.
  const matches = useMemo(() => {
    const q = client.name.trim().toLowerCase();
    if (client.id || q.length < 2) return [];
    return data.clients.filter((c) => c.name.toLowerCase().includes(q) || c.phone.replace(/\D/g, '').includes(q.replace(/\D/g, '') || '§')).slice(0, 5);
  }, [client, data.clients]);

  const canSave = !!client.name.trim() || !!b.title.trim();
  const save = () => {
    const now = Date.now();
    const clientId = client.id || (client.name.trim() ? newId() : '');
    update((d) => {
      // The client: the one picked (its details as edited here), or a new one.
      const fields = { name: client.name.trim(), phone: client.phone.trim(), email: client.email.trim() };
      const clients = !client.name.trim()
        ? d.clients
        : client.id
          ? d.clients.map((c) => (c.id === clientId ? { ...c, ...fields } : c))
          : [...d.clients, { id: clientId, ...fields, notes: '', createdAt: now }];
      // A number given meanwhile (by an invoice) stays.
      const stored = d.bookings.find((x) => x.id === b.id);
      const saved: Booking = { ...b, clientId, invoiceNo: b.invoiceNo || stored?.invoiceNo || '', updatedAt: now, sessions: [...b.sessions].sort((x, y) => x.start.localeCompare(y.start)) };
      return { ...d, clients, bookings: stored ? d.bookings.map((x) => (x.id === b.id ? saved : x)) : [...d.bookings, saved] };
    });
    onClose();
  };
  const remove = () => {
    update((d) => ({ ...d, bookings: d.bookings.filter((x) => x.id !== b.id), expenses: d.expenses.map((e) => (e.bookingId === b.id ? { ...e, bookingId: null } : e)) }));
    onClose();
  };

  const setSession = (id: string, patch: Partial<Session>) => set({ sessions: b.sessions.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const lastDay = b.sessions[b.sessions.length - 1]?.start.split('T')[0] ?? today();
  const next = nextColumn(data, b);
  const addons = data.addons.filter((a) => !b.addons.some((x) => x.name === a.name));

  return (
    <Dialog
      title={isNew ? t('Booking baru') : titleOf(data, { ...b, clientId: client.id })}
      onClose={onClose}
      width={720}
      footer={
        <>
          {!isNew &&
            (asking ? (
              <span className="mr-auto flex items-center gap-2 text-xs text-reject">
                {t('Hapus booking ini?')}
                <button type="button" onClick={remove} className="h-8 rounded-lg bg-reject px-3 font-semibold text-bg">
                  {t('Hapus')}
                </button>
                <button type="button" onClick={() => setAsking(false)} className="h-8 px-2 text-muted hover:text-fg">
                  {t('Batal')}
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setAsking(true)} className={cx(btnPlain, 'mr-auto hover:text-reject')}>
                <Trash2 size={14} /> {t('Hapus')}
              </button>
            ))}
          <button type="button" onClick={onClose} className={btnPlain}>
            {t('Batal')}
          </button>
          <button type="button" onClick={save} disabled={!canSave} className={btnPrimary}>
            {t('Simpan')}
          </button>
        </>
      }
    >
      {actions.length > 0 && (
        <div className="-mt-1 flex flex-wrap gap-2">
          {actions.map((a) => (
            <button key={a.key} type="button" disabled={!canSave} onClick={() => (save(), a.run(b.id))} className="flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-3 text-xs font-medium text-fg hover:border-gold disabled:opacity-40">
              {a.icon} {a.label}
            </button>
          ))}
        </div>
      )}
      <section className="flex flex-col gap-3">
        <SectionTitle
          action={
            client.id ? (
              <button type="button" onClick={() => setClient({ id: '', name: '', phone: '', email: '' })} className="text-[11px] font-medium text-gold-text hover:underline">
                {t('Ganti klien')}
              </button>
            ) : undefined
          }
        >
          {t('Klien')}
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Nama')} className="relative">
            <input value={client.name} onChange={(e) => setClient({ ...client, name: e.target.value })} placeholder={t('mis. Rina & Dimas')} className={inputCls} autoFocus={isNew} />
            {matches.length > 0 && (
              <span className="absolute top-full right-0 left-0 z-10 mt-1 flex flex-col rounded-lg border border-line bg-panel-2 p-1 shadow-xl">
                <span className="px-2 py-1 text-[10px] text-faint">{t('Klien yang sudah ada')}</span>
                {matches.map((c) => (
                  <button key={c.id} type="button" onMouseDown={(e) => (e.preventDefault(), setClient(c))} className="flex flex-col rounded-md px-2 py-1.5 text-left hover:bg-raised">
                    <span className="text-xs font-medium text-fg">{c.name}</span>
                    <span className="text-[11px] text-faint">{c.phone}</span>
                  </button>
                ))}
              </span>
            )}
          </Field>
          <Field label={t('Nomor WhatsApp')}>
            <input value={client.phone} onChange={(e) => setClient({ ...client, phone: e.target.value })} placeholder="0812…" inputMode="tel" className={inputCls} />
          </Field>
          <Field label={t('Email (opsional)')}>
            <input type="email" {...PLAIN} value={client.email} onChange={(e) => setClient({ ...client, email: e.target.value })} placeholder="nama@email.com" className={inputCls} />
          </Field>
          <Field label={t('Judul di board (opsional)')}>
            <input value={b.title} onChange={(e) => set({ title: e.target.value })} placeholder={client.name || t('Nama klien')} className={inputCls} />
          </Field>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>{t('Paket & harga')}</SectionTitle>
        <div className="grid grid-cols-[1fr_180px] gap-3">
          <Field label={t('Paket')}>
            <select
              value={b.packageId ?? ''}
              onChange={(e) => {
                const p = data.packages.find((x) => x.id === e.target.value);
                set(
                  p
                    ? { packageId: p.id, packageName: p.name, packagePrice: p.price, sessions: fitSessions(b.sessions, duration, p.durationMin) }
                    : { packageId: null, packageName: '', packagePrice: 0 },
                );
              }}
              className={inputCls}
            >
              <option value="">{t('Tanpa paket (isi sendiri)')}</option>
              {data.packages
                .filter((p) => !p.archived || p.id === b.packageId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {rupiah(p.price)}
                  </option>
                ))}
            </select>
          </Field>
          <Field label={t('Harga')}>
            <MoneyInput value={b.packagePrice} onChange={(packagePrice) => set({ packagePrice })} />
          </Field>
          {!b.packageId && (
            <Field label={t('Nama layanan')} className="col-span-2">
              <input value={b.packageName} onChange={(e) => set({ packageName: e.target.value })} placeholder={t('mis. Foto produk 20 item')} className={inputCls} />
            </Field>
          )}
        </div>
        {b.addons.map((a, i) => (
          <div key={i} className="grid grid-cols-[1fr_180px_auto] items-center gap-3">
            <input value={a.name} onChange={(e) => set({ addons: b.addons.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} placeholder={t('Add-on')} className={inputCls} />
            <MoneyInput value={a.price} onChange={(price) => set({ addons: b.addons.map((x, j) => (j === i ? { ...x, price } : x)) })} />
            <button type="button" onClick={() => set({ addons: b.addons.filter((_, j) => j !== i) })} aria-label={t('Hapus')} className="text-faint hover:text-reject">
              <X size={15} />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-1.5">
          {addons.map((a) => (
            <button key={a.id} type="button" onClick={() => set({ addons: [...b.addons, { name: a.name, price: a.price }] })} className="flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-[11px] text-muted hover:border-gold hover:text-fg">
              <Plus size={11} /> {a.name} · {rupiah(a.price)}
            </button>
          ))}
          <button type="button" onClick={() => set({ addons: [...b.addons, { name: '', price: 0 }] })} className="flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium text-gold-text hover:underline">
            <Plus size={11} /> {t('Add-on lain')}
          </button>
        </div>
        <div className="grid grid-cols-[1fr_180px] items-end gap-3">
          <span className="text-right text-xs text-muted">{t('Diskon')}</span>
          <MoneyInput value={b.discount} onChange={(discount) => set({ discount })} />
          <span className="text-right text-[13px] font-semibold">{t('Total')}</span>
          <span className="px-2.5 text-[15px] font-semibold tabular-nums">{rupiah(totalOf(b))}</span>
        </div>
      </section>

      <Payments booking={b} onChange={(payments) => set({ payments })} />

      <section className="flex flex-col gap-3">
        <SectionTitle
          action={
            <button type="button" onClick={() => set({ sessions: [...b.sessions, sessionOn(lastDay, duration)] })} className="flex items-center gap-1 text-[11px] font-medium text-gold-text hover:underline">
              <CalendarPlus size={12} /> {t('Tambah jadwal')}
            </button>
          }
        >
          {t('Jadwal')}
        </SectionTitle>
        {b.sessions.length === 0 && <p className="text-xs text-faint">{t('Belum ada jadwal. Tambahkan tanggal dan jam pemotretan.')}</p>}
        {b.sessions.map((s) => (
          <SessionRow
            key={s.id}
            data={data}
            booking={b}
            session={s}
            who={client.name.trim() || b.title.trim()}
            phone={client.phone}
            single={b.sessions.length === 1}
            onChange={(p) => setSession(s.id, p)}
            onRemove={() => set({ sessions: b.sessions.filter((x) => x.id !== s.id) })}
          />
        ))}
      </section>

      <section className="grid grid-cols-3 gap-3">
        <Field
          label={t('Status')}
          hint={
            next && (
              <button type="button" onClick={() => set({ columnId: next.id })} className="flex items-center gap-1 font-medium text-gold-text hover:underline">
                {t('Lanjut ke {col}', { col: next.name })} <ArrowRight size={11} />
              </button>
            )
          }
        >
          <select value={b.columnId} onChange={(e) => set({ columnId: e.target.value })} className={inputCls}>
            {data.columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Pelunasan paling lambat')}>
          <DateInput value={b.dueDate} onChange={(dueDate) => set({ dueDate })} placeholder={t('Tidak ada')} />
        </Field>
        <Field label={t('Hasil dikirim paling lambat')}>
          <DateInput value={b.deliveryDate} onChange={(deliveryDate) => set({ deliveryDate })} placeholder={t('Tidak ada')} />
        </Field>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t('Link foto untuk dipilih')} hint={t('Google Drive atau lainnya, untuk pesan tahap Pilih & edit.')}>
          <input {...PLAIN} value={b.pickLink ?? ''} onChange={(e) => set({ pickLink: e.target.value })} placeholder="https://drive.google.com/…" className={inputCls} />
        </Field>
        <Field label={t('Link hasil edit')} hint={t('Untuk pesan tahap Kirim hasil.')}>
          <input {...PLAIN} value={b.resultLink ?? ''} onChange={(e) => set({ resultLink: e.target.value })} placeholder="https://drive.google.com/…" className={inputCls} />
        </Field>
      </div>

      <Field label={t('Catatan')}>
        <textarea value={b.notes} onChange={(e) => set({ notes: e.target.value })} rows={3} placeholder={t('Konsep, permintaan khusus, kontak keluarga…')} className={cx(inputCls, 'h-auto resize-none py-2')} />
      </Field>
    </Dialog>
  );
}

function SessionRow({
  data,
  booking,
  session: s,
  who,
  phone,
  single,
  onChange,
  onRemove,
}: {
  data: BisnisData;
  booking: Booking;
  session: Session;
  /** The client, for the calendar event's title. */
  who: string;
  phone: string;
  single: boolean;
  onChange: (p: Partial<Session>) => void;
  onRemove: () => void;
}) {
  const day = s.start.split('T')[0]!;
  const clashes = clashesOf(data, booking, s);
  // The day moves the whole session; an end before the start moves to the same length after it.
  const setDay = (d: string) => {
    if (!d) return;
    const len = parseLocal(s.end).getTime() - parseLocal(s.start).getTime();
    const start = parseLocal(`${d}T${timeOf(s.start)}`);
    onChange({ start: localString(start), end: localString(new Date(start.getTime() + Math.max(len, 0))) });
  };
  const setTime = (which: 'start' | 'end', time: string) => {
    if (!time) return;
    if (which === 'start') {
      const len = parseLocal(s.end).getTime() - parseLocal(s.start).getTime();
      const start = parseLocal(`${day}T${time}`);
      onChange({ start: localString(start), end: localString(new Date(start.getTime() + Math.max(len, 0))) });
    } else {
      let end = parseLocal(`${s.end.split('T')[0]}T${time}`);
      if (end <= parseLocal(s.start)) end = parseLocal(`${day}T${time}`);
      // Past midnight: the next day.
      if (end <= parseLocal(s.start)) end = new Date(end.getTime() + 86_400_000);
      onChange({ end: localString(end) });
    }
  };
  return (
    <div className={cx('flex flex-col gap-2 rounded-xl border p-3', clashes.length ? 'border-maybe/60 bg-maybe/[0.05]' : 'border-line-soft bg-bg')}>
      <div className="grid grid-cols-[1fr_150px_92px_92px_auto] items-end gap-2">
        <Field label={t('Acara')}>
          <input value={s.label} onChange={(e) => onChange({ label: e.target.value })} placeholder={single ? t('mis. Prewedding') : t('mis. Akad')} className={inputCls} />
        </Field>
        <Field label={t('Tanggal')}>
          <DateInput value={day} onChange={setDay} clearable={false} />
        </Field>
        <Field label={t('Mulai')}>
          <TimeInput value={timeOf(s.start)} onChange={(v) => setTime('start', v)} />
        </Field>
        <Field label={t('Selesai')}>
          <TimeInput value={timeOf(s.end)} onChange={(v) => setTime('end', v)} />
        </Field>
        <button type="button" onClick={onRemove} aria-label={t('Hapus jadwal')} title={t('Hapus jadwal')} className="mb-2 text-faint hover:text-reject">
          <X size={15} />
        </button>
      </div>
      <div className="flex gap-2">
        <input value={s.location} onChange={(e) => onChange({ location: e.target.value })} placeholder={t('Lokasi')} className={inputCls} />
        <button
          type="button"
          onClick={() =>
            openUrl(
              googleCalendarLink(
                [who, s.label || booking.packageName].filter(Boolean).join(' — ') || t('Pemotretan'),
                s.start,
                s.end,
                s.location,
                [booking.packageName, phone && `WhatsApp: ${phone}`, booking.notes].filter(Boolean).join('\n'),
              ),
            ).catch(() => {})
          }
          title={t('Tambah ke Google Calendar (dibuka di browser)')}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[11px] font-medium whitespace-nowrap text-muted hover:border-gold hover:text-fg"
        >
          <CalendarPlus size={13} /> {t('Google Calendar')}
        </button>
      </div>
      {clashes.map((c, i) => (
        <span key={i} className="flex items-start gap-1.5 text-[11px] text-maybe">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          {c.kind === 'blocked'
            ? t('{day} ditandai libur{note}.', { day: shortDate(c.day!), note: c.note ? ` (${c.note})` : '' })
            : t('Bentrok dengan {who}: {when}{label} (termasuk jeda {buffer} menit).', {
                who: titleOf(data, c.booking!),
                when: `${shortDate(c.session!.start.split('T')[0]!)} ${timeOf(c.session!.start)}–${timeOf(c.session!.end)}`,
                label: c.session!.label ? `, ${c.session!.label}` : '',
                buffer: data.settings.bufferMin,
              })}
        </span>
      ))}
    </div>
  );
}

const METHODS = ['Transfer', 'Tunai', 'QRIS', 'E-wallet'];

/** What has been paid (DP, instalments, the rest), and what is left. */
function Payments({ booking: b, onChange }: { booking: Booking; onChange: (p: Payment[]) => void }) {
  const total = totalOf(b);
  const paid = paidOf(b);
  const state = payState(b);
  const set = (id: string, patch: Partial<Payment>) => onChange(b.payments.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle
        action={
          <button
            type="button"
            onClick={() => onChange([...b.payments, { id: newId(), date: today(), amount: balanceOf(b), method: 'Transfer', note: b.payments.length ? '' : 'DP' }])}
            className="flex items-center gap-1 text-[11px] font-medium text-gold-text hover:underline"
          >
            <Wallet size={12} /> {t('Catat pembayaran')}
          </button>
        }
      >
        {t('Pembayaran')}
      </SectionTitle>
      {b.payments.map((p) => (
        <div key={p.id} className="grid grid-cols-[140px_170px_120px_1fr_auto] items-center gap-2">
          <DateInput value={p.date} onChange={(date) => set(p.id, { date })} clearable={false} />
          <MoneyInput value={p.amount} onChange={(amount) => set(p.id, { amount })} />
          <select value={METHODS.includes(p.method) ? p.method : ''} onChange={(e) => set(p.id, { method: e.target.value })} className={inputCls}>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {t(m)}
              </option>
            ))}
            <option value="">{t('Lainnya')}</option>
          </select>
          <input value={p.note} onChange={(e) => set(p.id, { note: e.target.value })} placeholder={t('Keterangan (mis. DP, pelunasan)')} className={inputCls} />
          <button type="button" onClick={() => onChange(b.payments.filter((x) => x.id !== p.id))} aria-label={t('Hapus')} className="text-faint hover:text-reject">
            <X size={15} />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-4 rounded-xl bg-bg px-4 py-2.5 text-xs">
        <span className="flex items-center gap-1.5 font-semibold" style={{ color: PAY_COLOR[state] }}>
          <span className="size-2 rounded-full" style={{ background: PAY_COLOR[state] }} />
          {t(PAY_LABEL[state])}
        </span>
        <span className="text-muted">
          {t('Total')} <b className="text-fg tabular-nums">{rupiah(total)}</b>
        </span>
        <span className="text-muted">
          {t('Terbayar')} <b className="text-fg tabular-nums">{rupiah(paid)}</b>
        </span>
        <span className="ml-auto text-muted">
          {t('Sisa')} <b className={cx('tabular-nums', balanceOf(b) > 0 ? 'text-reject' : 'text-pick')}>{rupiah(balanceOf(b))}</b>
        </span>
      </div>
    </section>
  );
}
