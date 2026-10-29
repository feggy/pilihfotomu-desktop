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

/** The built-in templates: one for each default stage, plus the pricelist and the balance reminder. */
export const DEFAULT_TEMPLATES: MessageTemplate[] = [
  {
    id: 'pricelist',
    name: 'Pricelist',
    body: 'Halo {nama}, terima kasih sudah menghubungi {studio}. Ini pilihan paket kami:\n\n{pricelist}\n\nTanggal yang diinginkan kapan? Kami cek jadwalnya dulu ya.',
  },
  {
    id: 'follow-up',
    name: 'Follow up',
    columnId: 'tanya',
    body: 'Halo {nama}, mau follow up soal {paket} untuk {tanggal}. Tanggalnya masih kami tahan sementara; DP {dp_minimal} untuk mengunci jadwal.\n\nPembayaran ke:\n{rekening}\n\nKabari kami ya. Terima kasih!',
  },
  {
    id: 'konfirmasi',
    name: 'Konfirmasi booking',
    columnId: 'dp',
    attach: 'kuitansi',
    body: 'Halo {nama}, DP untuk {paket} sudah kami terima, terima kasih! Booking kamu sudah terkonfirmasi untuk {jadwal}.\n\nSudah dibayar: {terbayar}\nSisa: {sisa}, paling lambat {jatuh_tempo}.\n\nPembayaran ke:\n{rekening}\n\nKuitansi terlampir.',
  },
  {
    id: 'pengingat',
    name: 'Pengingat jadwal',
    columnId: 'jadwal',
    body: 'Halo {nama}, mengingatkan jadwal foto {jadwal}. Sampai jumpa!',
  },
  {
    id: 'sedang-diedit',
    name: 'Link pilih foto',
    columnId: 'edit',
    body: 'Halo {nama}, terima kasih untuk sesi fotonya! Foto-fotonya sudah bisa dilihat dan dipilih di sini:\n{link_pilih}\n\nBalas pesan ini dengan nama file foto yang dipilih, contoh:\nPilih: IMG_0101, IMG_0105, IMG_0110-0115\n\nSetelah pilihannya kami terima, foto langsung kami edit.',
  },
  {
    id: 'hasil-siap',
    name: 'Hasil siap',
    columnId: 'kirim',
    body: 'Halo {nama}, hasil edit foto {paket} sudah siap! Silakan diunduh di sini:\n{link_hasil}\n\nSimpan filenya ya, link ini tidak selamanya aktif. Kalau ada yang perlu ditanyakan, kabari kami.',
  },
  {
    id: 'tagihan',
    name: 'Tagihan pelunasan',
    attach: 'invoice',
    body: 'Halo {nama}, mengingatkan sisa pembayaran {paket} sebesar {sisa}, paling lambat {jatuh_tempo}.\n\nPembayaran ke:\n{rekening}\n\nInvoice terlampir. Terima kasih!',
  },
  {
    id: 'terima-kasih',
    name: 'Terima kasih',
    columnId: 'selesai',
    body: 'Halo {nama}, terima kasih sudah mempercayakan momennya ke {studio}. Semoga suka dengan hasilnya!',
  },
  {
    id: 'batal',
    name: 'Konfirmasi pembatalan',
    columnId: 'batal',
    body: 'Halo {nama}, pembatalan {paket} untuk {tanggal} sudah kami catat. Terima kasih sudah mengabari, semoga lain waktu bisa bekerja sama ya.',
  },
];

const startingBody = (stage: string) => `Halo {nama}, kabar terbaru untuk {paket}: booking kamu sekarang di tahap ${stage}.\n\nKalau ada yang ingin ditanyakan, kabari kami ya. Terima kasih!`;

/**
 * A built-in template that lost its stage (Pengingat jadwal, Terima kasih)
 * given it back, and the starting one made for that stage in its place,
 * untouched, taken out.
 */
function reclaimStages(data: BisnisData): BisnisData {
  let templates = data.templates;
  for (const d of DEFAULT_TEMPLATES) {
    const col = d.columnId && data.columns.find((c) => c.id === d.columnId);
    if (!col) continue;
    const own = templates.find((x) => !x.columnId && (x.id === d.id || x.name === d.name));
    if (!own) continue;
    const stand = templates.filter((x) => x.columnId === col.id);
    if (stand.some((x) => x.name !== col.name || x.body !== startingBody(col.name))) continue;
    templates = templates.filter((x) => !stand.includes(x)).map((x) => (x === own ? { ...x, columnId: col.id } : x));
  }
  return templates === data.templates ? data : { ...data, templates };
}

/**
 * `data` with a template for every stage of its board: a built-in one for a
 * default stage, a starting one to edit for a stage the studio added —
 * every stage has a message to send, and something to start from.
 */
export function withStageTemplates(data: BisnisData): BisnisData {
  data = reclaimStages(data);
  const missing = data.columns.filter((c) => !data.templates.some((x) => x.columnId === c.id));
  if (!missing.length) return data;
  const added = missing.map(
    (c): MessageTemplate =>
      DEFAULT_TEMPLATES.find((x) => x.columnId === c.id && !data.templates.some((y) => y.id === x.id)) ?? {
        id: newId(),
        name: c.name,
        columnId: c.id,
        body: startingBody(c.name),
      },
  );
  return { ...data, templates: [...data.templates, ...added] };
}
const TEMPLATES_VERSION = 4;

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
    templatesVersion: TEMPLATES_VERSION,
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
      setupHidden: false,
    },
  };
}

/** Data read from disk (or a backup) with anything newer filled in from the defaults. */
export function fromJson(json: string): BisnisData {
  const raw = JSON.parse(json) as Partial<BisnisData>;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.bookings)) throw new Error('Bukan data Kelola Bisnis.');
  const base = emptyData();
  const data: BisnisData = { ...base, ...raw, v: DATA_VERSION, settings: { ...base.settings, ...raw.settings } };
  // Data from before the stage templates: they are added, and the built-in ones it kept get their stage and picture.
  if ((data.templatesVersion ?? 1) < 2) {
    const builtIn = new Map(DEFAULT_TEMPLATES.map((x) => [x.id, x]));
    const kept = data.templates.map((x) => {
      const d = builtIn.get(x.id);
      return d ? { ...x, columnId: x.columnId ?? d.columnId, attach: x.attach ?? d.attach } : x;
    });
    const added = DEFAULT_TEMPLATES.filter((x) => !kept.some((y) => y.id === x.id) && ['follow-up', 'sedang-diedit', 'hasil-siap'].includes(x.id));
    data.templates = [...kept, ...added];
  }
  // DP diterima became Konfirmasi booking (a booking is confirmed by its deposit): one template, for DP masuk.
  if ((data.templatesVersion ?? 1) < 3) {
    const konfirmasi = DEFAULT_TEMPLATES.find((x) => x.id === 'konfirmasi')!;
    data.templates = data.templates
      .filter((x) => x.id !== 'dp-diterima')
      .map((x) => (x.id === 'konfirmasi' ? { ...x, columnId: 'dp', attach: 'kuitansi', body: x.body.includes('DP untuk mengunci tanggal') ? konfirmasi.body : x.body } : x));
  }
  // The Pilih & edit and Kirim hasil templates carry the Drive links: replaced where still as they came.
  if ((data.templatesVersion ?? 1) < 4) {
    const was: Record<string, string> = { 'sedang-diedit': 'Halo {nama}, terima kasih untuk sesi fotonya! Foto sedang kami pilih dan edit. Kami kabari begitu hasilnya siap ya.', 'hasil-siap': 'Halo {nama}, hasil foto {paket} sudah siap! Ini link-nya:\n\n\nSilakan diunduh dan disimpan. Kalau ada yang perlu ditanyakan, kabari kami ya.' };
    data.templates = data.templates.map((x) => {
      const d = DEFAULT_TEMPLATES.find((y) => y.id === x.id);
      return d && was[x.id] === x.body ? { ...x, name: x.name === 'Foto sedang diedit' ? d.name : x.name, body: d.body } : x;
    });
  }
  data.templatesVersion = TEMPLATES_VERSION;
  return withStageTemplates(data);
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
