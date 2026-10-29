/**
 * A kuitansi: the receipt for one payment, half an A4 page lying down —
 * received from whom, how much (in figures and in words, as receipts in
 * Indonesia are written), for what, what was left after it, and a line to
 * sign. Drawn and made into a PDF like the invoice.
 */

import { makePdf } from '../kreasi/engine/pdf';
import { FONT, GOLD, INK, LINE, SOFT, wrap } from './invoice';
import { longDate, rupiah, shortDate, today, totalOf } from './model';
import type { BisnisData, Booking, Client, Payment } from './types';

/** A5 landscape at 150 dpi. */
const W = 1240;
const H = 874;
const M = 80;

const ONES = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];

/** A whole number in Indonesian words: 1.500.000 → "satu juta lima ratus ribu". */
export function terbilang(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n < 12) return ONES[n]!;
  if (n < 20) return `${terbilang(n - 10)} belas`;
  if (n < 100) return `${terbilang(Math.floor(n / 10))} puluh ${terbilang(n % 10)}`.trim();
  if (n < 200) return `seratus ${terbilang(n - 100)}`.trim();
  if (n < 1000) return `${terbilang(Math.floor(n / 100))} ratus ${terbilang(n % 100)}`.trim();
  if (n < 2000) return `seribu ${terbilang(n - 1000)}`.trim();
  const scales: [number, string][] = [
    [1e12, 'triliun'],
    [1e9, 'miliar'],
    [1e6, 'juta'],
    [1e3, 'ribu'],
  ];
  for (const [size, name] of scales)
    if (n >= size) return `${terbilang(Math.floor(n / size))} ${name} ${terbilang(n % size)}`.trim();
  return '';
}

export interface ReceiptInput {
  data: BisnisData;
  booking: Booking;
  payment: Payment;
  client: Client | null;
  studio: string;
  logo: HTMLImageElement | null;
}

/** What was paid up to and with this payment, by date (the same day: in the order recorded). */
function paidThrough(b: Booking, p: Payment) {
  const order = b.payments.map((x, i) => ({ x, i })).sort((a, z) => a.x.date.localeCompare(z.x.date) || a.i - z.i);
  let sum = 0;
  for (const { x } of order) {
    sum += x.amount;
    if (x.id === p.id) break;
  }
  return sum;
}

export function drawReceipt(canvas: HTMLCanvasElement, { data, booking: b, payment: p, client, studio, logo }: ReceiptInput) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const font = (size: number, weight = 400) => (ctx.font = `${weight} ${size}px ${FONT}`);
  const text = (s: string, x: number, y: number, o: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign } = {}) => {
    font(o.size ?? 20, o.weight ?? 400);
    ctx.fillStyle = o.color ?? INK;
    ctx.textAlign = o.align ?? 'left';
    ctx.fillText(s, x, y);
  };
  const rule = (y: number) => {
    ctx.fillStyle = LINE;
    ctx.fillRect(M, y, W - 2 * M, 2);
  };

  // The studio; KUITANSI, its number and day.
  let left = M;
  if (logo) {
    const h = 72;
    const w = Math.min(180, (logo.naturalWidth / logo.naturalHeight) * h);
    ctx.drawImage(logo, M, M - 10, w, (w / logo.naturalWidth) * logo.naturalHeight);
    left = M + w + 24;
  }
  text(studio || 'Studio', left, M + 22, { size: 28, weight: 700 });
  font(17);
  wrap(ctx, data.settings.studioContact, 440).slice(0, 2).forEach((l, i) => text(l, left, M + 50 + i * 24, { size: 17, color: SOFT }));
  text('KUITANSI', W - M, M + 26, { size: 38, weight: 700, color: GOLD, align: 'right' });
  text(p.receiptNo || '—', W - M, M + 58, { size: 20, weight: 600, align: 'right' });
  text(`Tanggal: ${shortDate(p.date)}`, W - M, M + 84, { size: 17, color: SOFT, align: 'right' });
  let y = M + 120;
  rule(y);

  // Received from, the sum, in words, for what.
  const row = (label: string, value: string, opts: { size?: number; weight?: number; color?: string } = {}) => {
    text(label, M, y, { size: 18, color: SOFT });
    font(opts.size ?? 22, opts.weight ?? 500);
    const lines = wrap(ctx, value, W - 2 * M - 260);
    lines.forEach((l, i) => text(l, M + 260, y + i * 30, { size: opts.size ?? 22, weight: opts.weight ?? 500, color: opts.color }));
    y += 30 * lines.length + 22;
  };
  y += 52;
  row('Telah diterima dari', client?.name || b.title || '—', { weight: 600 });
  row('Uang sejumlah', rupiah(p.amount), { size: 30, weight: 700 });
  const words = terbilang(p.amount);
  row('Terbilang', `${words.charAt(0).toUpperCase()}${words.slice(1)} rupiah`, { size: 20, weight: 400, color: SOFT });
  const what = [p.note || (b.payments.length > 1 ? 'Pembayaran' : 'DP'), b.packageName].filter(Boolean).join(' · ');
  row('Untuk pembayaran', `${what}${b.invoiceNo ? ` (${b.invoiceNo})` : ''}${p.method ? ` — ${p.method}` : ''}`);

  // What stands after this payment, left; signature, right.
  const paid = paidThrough(b, p);
  const left0 = Math.max(0, totalOf(b) - paid);
  const boxY = H - 230;
  ctx.fillStyle = '#f5f6f5';
  ctx.fillRect(M, boxY, 520, 128);
  const line = (label: string, value: string, i: number, strong = false) => {
    text(label, M + 24, boxY + 38 + i * 36, { size: 18, color: SOFT });
    text(value, M + 496, boxY + 38 + i * 36, { size: 18, weight: strong ? 700 : 500, color: strong ? (left0 > 0 ? '#b84a4a' : '#2f8a50') : INK, align: 'right' });
  };
  line('Total booking', rupiah(totalOf(b)), 0);
  line('Dibayar sampai kuitansi ini', rupiah(paid), 1);
  line(left0 > 0 ? 'Sisa tagihan' : 'Status', left0 > 0 ? rupiah(left0) : 'LUNAS', 2, true);

  const sx = W - M - 260;
  text(longDate(p.date), sx + 130, boxY + 4, { size: 17, color: SOFT, align: 'center' });
  text('Penerima,', sx + 130, boxY + 32, { size: 17, color: SOFT, align: 'center' });
  ctx.fillStyle = INK;
  ctx.fillRect(sx, boxY + 112, 260, 2);
  text(studio || ' ', sx + 130, boxY + 140, { size: 18, weight: 600, align: 'center' });
}

/** The receipt as a PNG picture, to send in a chat. */
export async function receiptPng(input: ReceiptInput): Promise<Blob> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  drawReceipt(canvas, input);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Kuitansi gagal dibuat'))), 'image/png'));
}

export async function receiptPdf(input: ReceiptInput): Promise<Uint8Array> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  drawReceipt(canvas, input);
  const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Kuitansi gagal dibuat'))), 'image/jpeg', 0.92));
  const pdf = await makePdf([{ jpeg, width: W, height: H }], 595.28, 419.53);
  return new Uint8Array(await pdf.arrayBuffer());
}

/** The next receipt number ("KWT-202611-004") and the counter after it. */
export function nextReceiptNo(data: BisnisData, on = today()): { no: string; next: number } {
  const n = data.settings.nextReceipt;
  const prefix = data.settings.receiptPrefix.trim() || 'KWT';
  return { no: `${prefix}-${on.slice(0, 4)}${on.slice(5, 7)}-${String(n).padStart(3, '0')}`, next: n + 1 };
}
