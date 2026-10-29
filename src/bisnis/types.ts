/**
 * Kelola Bisnis: a photographer's bookings, from the first question to the
 * last photo delivered — who, which package, when, what was paid, what it
 * cost. One plain object, kept offline as `<app data>/bisnis/data.json`.
 *
 * Times are local wall-clock strings ("2026-11-07T09:00"), dates "2026-11-07":
 * a shoot at nine is at nine wherever the laptop travels. Money is whole rupiah.
 */

export const DATA_VERSION = 1;

export interface Client {
  id: string;
  name: string;
  /** WhatsApp number as typed ("0812…" or "+62…"). */
  phone: string;
  email: string;
  notes: string;
  createdAt: number;
}

export interface Package {
  id: string;
  name: string;
  price: number;
  /** What it includes, one item a line (shown in the pricelist and on the invoice). */
  description: string;
  /** How long a shoot of it usually takes, for a new session's end time. */
  durationMin: number;
  /** Hidden from the pricelist and the booking form; old bookings keep it. */
  archived?: boolean;
}

/** An extra on top of a package: a second photographer, an album, an extra hour. */
export interface Addon {
  id: string;
  name: string;
  price: number;
}

/** One shoot of a booking (a wedding: lamaran, akad, resepsi). */
export interface Session {
  id: string;
  label: string;
  /** "YYYY-MM-DDTHH:mm", local. */
  start: string;
  end: string;
  location: string;
}

export interface Payment {
  id: string;
  /** "YYYY-MM-DD". */
  date: string;
  amount: number;
  /** Transfer, tunai, QRIS… */
  method: string;
  note: string;
  /** Given on its first receipt (kuitansi), then kept. */
  receiptNo?: string;
}

export interface LineItem {
  name: string;
  price: number;
}

export interface Booking {
  id: string;
  clientId: string;
  /** Board card title; the client's name when empty. */
  title: string;
  /** The package chosen, copied in: a later price change doesn't touch this booking. */
  packageId: string | null;
  packageName: string;
  packagePrice: number;
  addons: LineItem[];
  discount: number;
  sessions: Session[];
  /** The board column it sits in. */
  columnId: string;
  /** Its place in that column, low first. */
  order: number;
  payments: Payment[];
  /** Pay the rest by this day ("YYYY-MM-DD"), or none. */
  dueDate: string;
  /** Deliver the photos by this day, or none. */
  deliveryDate: string;
  notes: string;
  /** Given on the first invoice, then kept. */
  invoiceNo: string;
  /** Where the client picks from (a Google Drive folder…), for {link_pilih}. */
  pickLink?: string;
  /** Where the finished photos are, for {link_hasil}. */
  resultLink?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Column {
  id: string;
  name: string;
  color: string;
  /** Cancelled and the like: its bookings take no time on the calendar and owe nothing. */
  inactive?: boolean;
  /** Finished: its bookings are delivered, no delivery reminder. */
  done?: boolean;
}

/** A day off: no bookings expected; one made anyway is warned about. */
export interface BlockedDay {
  id: string;
  date: string;
  note: string;
}

export interface Expense {
  id: string;
  date: string;
  amount: number;
  category: string;
  note: string;
  /** What it was spent for, when it was one booking. */
  bookingId: string | null;
}

export interface MessageTemplate {
  id: string;
  name: string;
  /** With {nama}, {paket}, {tanggal}… filled in when sent. */
  body: string;
  /** The board stage it is for: picked first when messaging a booking in that column. */
  columnId?: string;
  /** A picture to go with it (WhatsApp links carry text only: copied, to paste in the chat). */
  attach?: 'invoice' | 'kuitansi';
}

export interface BisnisSettings {
  /** Minutes kept free before and after a shoot (travel, set-up): closer than that is a clash. */
  bufferMin: number;
  invoicePrefix: string;
  nextInvoice: number;
  /** Receipts (kuitansi), one per payment: "KWT-202611-004". */
  receiptPrefix: string;
  nextReceipt: number;
  /** Printed under every invoice. */
  terms: string;
  /** Bank account(s) and the like, for invoices and messages ({rekening}). */
  paymentInfo: string;
  /** Address, phone, Instagram: under the studio's name on invoices. */
  studioContact: string;
  /** The deposit that locks a date, as a share of the total ({dp_minimal}). */
  minDpPercent: number;
  /** Reminders: the day before a shoot; payment due within this many days; delivery due. */
  remindShoot: boolean;
  remindDueDays: number;
  remindDelivery: boolean;
  /** A copy of everything written here as it changes (an iCloud or Google Drive folder, say). */
  backupDir: string | null;
  lastBackup: number | null;
  /** When the notice about keeping a backup was last put away. */
  backupNoticeAt: number | null;
  /** The Persiapan checklist folded to one line (still there until every step is done). */
  setupHidden: boolean;
}

export interface BisnisData {
  v: number;
  clients: Client[];
  packages: Package[];
  addons: Addon[];
  bookings: Booking[];
  columns: Column[];
  blocked: BlockedDay[];
  expenses: Expense[];
  templates: MessageTemplate[];
  expenseCategories: string[];
  settings: BisnisSettings;
  /** Reminders put away by hand (`Reminder.key`). */
  dismissed: string[];
  /** Which set of built-in templates the data has had added (stage templates came with 2). */
  templatesVersion?: number;
  /** Reminders already shown as a system notification, so a restart doesn't repeat them. */
  notified: string[];
}
