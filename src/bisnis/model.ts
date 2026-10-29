/**
 * Kelola Bisnis without the screens: a new studio's starting data, what a
 * booking costs and owes, when it is, and what it clashes with.
 */

import { DATA_VERSION, type BisnisData, type Booking, type Column, type MessageTemplate, type Session } from './types';

export const newId = () => crypto.randomUUID();

/** The board a studio starts with, in the order a booking goes; renamed, added to or removed at will. */
export const DEFAULT_COLUMNS: Column[] = [
  { id: 'tanya', name: 'Tanya-tanya', color: '#8a9a93' },
  { id: 'dp', name: 'DP masuk', color: '#c9a96e' },
  { id: 'jadwal', name: 'Jadwal foto', color: '#5b9bd5' },
  { id: 'edit', name: 'Pilih & edit', color: '#a77bca' },
  { id: 'kirim', name: 'Kirim hasil', color: '#e0904a' },
  { id: 'selesai', name: 'Selesai', color: '#5fb87a', done: true },
  { id: 'batal', name: 'Batal', color: '#c96a6a', inactive: true },
];

export const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    id: 'pricelist',
    name: 'Pricelist',
    body: 'Halo {nama}, terima kasih sudah menghubungi {studio}. Ini pilihan paket kami:\n\n{pricelist}\n\nTanggal yang diinginkan kapan? Kami cek jadwalnya dulu ya.',
  },
  {
    id: 'konfirmasi',
    name: 'Konfirmasi booking',
    body: 'Halo {nama}, booking {paket} sudah kami catat untuk {jadwal}.\n\nTotal: {total}\nDP untuk mengunci tanggal: {dp_minimal}\n\nPembayaran ke:\n{rekening}\n\nTerima kasih!',
  },
  {
    id: 'tagihan',
    name: 'Tagihan pelunasan',
    body: 'Halo {nama}, mengingatkan sisa pembayaran {paket} sebesar {sisa}, paling lambat {jatuh_tempo}.\n\nPembayaran ke:\n{rekening}\n\nTerima kasih!',
  },
  {
    id: 'pengingat',
    name: 'Pengingat jadwal',
    body: 'Halo {nama}, mengingatkan jadwal foto {jadwal}. Sampai jumpa!',
  },
  {
    id: 'terima-kasih',
    name: 'Terima kasih',
    body: 'Halo {nama}, terima kasih sudah mempercayakan momennya ke {studio}. Semoga suka dengan hasilnya!',
  },
];

export const DEFAULT_EXPENSE_CATEGORIES = ['Transport', 'Sewa alat', 'Freelancer', 'Cetak & album', 'Makan', 'Iklan', 'Lainnya'];

export function emptyData(): BisnisData {
  return {
    v: DATA_VERSION,
    clients: [],
    packages: [],
    addons: [],
    bookings: [],
    columns: DEFAULT_COLUMNS,
    blocked: [],
    expenses: [],
    templates: DEFAULT_TEMPLATES,
    expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
    dismissed: [],
    notified: [],
    settings: {
      bufferMin: 60,
      invoicePrefix: 'INV',
      nextInvoice: 1,
      receiptPrefix: 'KWT',
      nextReceipt: 1,
      terms: 'DP tidak dapat dikembalikan bila acara dibatalkan oleh klien.\nJadwal dapat diundur satu kali tanpa biaya bila dikabarkan paling lambat 14 hari sebelumnya.',
      paymentInfo: '',
      studioContact: '',
      minDpPercent: 30,
      remindShoot: true,
      remindDueDays: 3,
      remindDelivery: true,
      backupDir: null,
      lastBackup: null,
      backupNoticeAt: null,
    },
  };
}

/** Data read from disk (or a backup) with anything newer filled in from the defaults. */
export function fromJson(json: string): BisnisData {
  const raw = JSON.parse(json) as Partial<BisnisData>;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.bookings)) throw new Error('Bukan data Kelola Bisnis.');
  const base = emptyData();
  return { ...base, ...raw, v: DATA_VERSION, settings: { ...base.settings, ...raw.settings } };
}

// ── Money ────────────────────────────────────────────────────────

export const rupiah = (n: number) => `Rp ${new Intl.NumberFormat('id-ID').format(Math.round(n))}`;

/** What is typed in a money box ("1.500.000", "1500000", "Rp 1,5jt" stays digits only) as a number. */
export const parseMoney = (s: string) => Number(s.replace(/\D/g, '')) || 0;

export const totalOf = (b: Booking) => Math.max(0, b.packagePrice + b.addons.reduce((s, a) => s + a.price, 0) - b.discount);
export const paidOf = (b: Booking) => b.payments.reduce((s, p) => s + p.amount, 0);
export const balanceOf = (b: Booking) => Math.max(0, totalOf(b) - paidOf(b));

export type PayState = 'belum' | 'dp' | 'lunas';
export function payState(b: Booking): PayState {
  const paid = paidOf(b);
  if (paid <= 0) return totalOf(b) <= 0 ? 'lunas' : 'belum';
  return paid >= totalOf(b) ? 'lunas' : 'dp';
}
export const PAY_LABEL: Record<PayState, string> = { belum: 'Belum bayar', dp: 'DP', lunas: 'Lunas' };
export const PAY_COLOR: Record<PayState, string> = { belum: 'var(--color-reject)', dp: 'var(--color-maybe)', lunas: 'var(--color-pick)' };

// ── Time ─────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
/** A Date as "YYYY-MM-DD", local. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** "YYYY-MM-DDTHH:mm" as a local Date. */
export const parseLocal = (s: string) => {
  const [d = '', t = '00:00'] = s.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, min] = t.split(':').map(Number);
  return new Date(y!, (m ?? 1) - 1, day ?? 1, h ?? 0, min ?? 0);
};
export const localString = (d: Date) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const today = () => dayKey(new Date());

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
export const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
/** "Sabtu, 7 November 2026" — the way it is written to a client. */
export const longDate = (day: string) => {
  const d = parseLocal(`${day}T00:00`);
  return `${DAY_NAMES[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
/** "7 Nov 2026". */
export const shortDate = (day: string) => {
  const d = parseLocal(`${day}T00:00`);
  return `${d.getDate()} ${MONTHS[d.getMonth()]!.slice(0, 3)} ${d.getFullYear()}`;
};
export const timeOf = (s: string) => s.split('T')[1] ?? '';
/** "Sabtu, 7 November 2026, 09:00–12:00". */
export const sessionWhen = (s: Session) => {
  const day = s.start.split('T')[0]!;
  const endDay = s.end.split('T')[0]!;
  return endDay === day ? `${longDate(day)}, ${timeOf(s.start)}–${timeOf(s.end)}` : `${longDate(day)} ${timeOf(s.start)} – ${longDate(endDay)} ${timeOf(s.end)}`;
};

/** The booking's first session that has not ended yet, or else its last one. */
export function nextSession(b: Booking, now = new Date()): Session | null {
  const sorted = [...b.sessions].sort((x, y) => x.start.localeCompare(y.start));
  return sorted.find((s) => parseLocal(s.end) >= now) ?? sorted[sorted.length - 1] ?? null;
}

// ── Clashes ──────────────────────────────────────────────────────

export interface Clash {
  kind: 'booking' | 'blocked';
  /** The other booking and its session, for a booking clash. */
  booking?: Booking;
  session?: Session;
  /** The day off, for a blocked one. */
  note?: string;
  day?: string;
}

/**
 * What `session` of `booking` runs into: another booking's session closer than
 * the travel buffer (cancelled ones don't count), or a day off. It may still
 * be saved — a studio with two teams books two shoots at once.
 */
export function clashesOf(data: BisnisData, booking: Pick<Booking, 'id'>, session: Session): Clash[] {
  const out: Clash[] = [];
  const buffer = data.settings.bufferMin * 60_000;
  const a0 = parseLocal(session.start).getTime() - buffer;
  const a1 = parseLocal(session.end).getTime() + buffer;
  const inactive = new Set(data.columns.filter((c) => c.inactive).map((c) => c.id));
  for (const b of data.bookings) {
    if (b.id === booking.id || inactive.has(b.columnId)) continue;
    for (const s of b.sessions) {
      if (parseLocal(s.start).getTime() < a1 && parseLocal(s.end).getTime() > a0) out.push({ kind: 'booking', booking: b, session: s });
    }
  }
  const from = session.start.split('T')[0]!;
  const to = session.end.split('T')[0]!;
  for (const d of data.blocked) if (d.date >= from && d.date <= to) out.push({ kind: 'blocked', note: d.note, day: d.date });
  return out;
}

export const clientOf = (data: BisnisData, b: Booking) => data.clients.find((c) => c.id === b.clientId) ?? null;
export const titleOf = (data: BisnisData, b: Booking) => b.title.trim() || clientOf(data, b)?.name || 'Tanpa nama';
