/**
 * An invoice drawn as an A4 page: the studio at the top (logo, name,
 * contact), the client, what was booked, what has been paid and what is
 * left, when the shoots are, where to pay, and the studio's terms. Made into
 * a PDF with the app's own small writer (`makePdf`): a picture of the page,
 * the same everywhere, nothing to install.
 */

import { makePdf } from '../kreasi/engine/pdf';
import { PAY_LABEL, balanceOf, longDate, paidOf, payState, rupiah, sessionWhen, shortDate, today, totalOf } from './model';
import type { BisnisData, Booking, Client } from './types';

/** A4 at 150 dpi. */
const W = 1240;
const H = 1754;
const M = 96;
const FONT = "'Inter Variable', Inter, system-ui, sans-serif";
const INK = '#1d2421';
const SOFT = '#6b7672';
const LINE = '#e3e6e4';
const GOLD = '#a8834a';

export interface InvoiceInput {
  data: BisnisData;
  booking: Booking;
  client: Client | null;
  studio: string;
  logo: HTMLImageElement | null;
  /** "YYYY-MM-DD", the day the invoice is written. */
  issued?: string;
}

/** `text` broken into lines no wider than `width` at the current font (and at its own line breaks). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export function drawInvoice(canvas: HTMLCanvasElement, { data, booking: b, client, studio, logo, issued = today() }: InvoiceInput) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  const font = (size: number, weight = 400) => (ctx.font = `${weight} ${size}px ${FONT}`);
  const text = (s: string, x: number, y: number, opts: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign } = {}) => {
    font(opts.size ?? 22, opts.weight ?? 400);
    ctx.fillStyle = opts.color ?? INK;
    ctx.textAlign = opts.align ?? 'left';
    ctx.fillText(s, x, y);
  };
  const rule = (y: number, color = LINE) => {
    ctx.fillStyle = color;
    ctx.fillRect(M, y, W - 2 * M, 2);
  };

  // The studio, top left; INVOICE and its number, top right.
  let y = M;
  let left = M;
  if (logo) {
    const h = 96;
    const w = Math.min(220, (logo.naturalWidth / logo.naturalHeight) * h);
    ctx.drawImage(logo, M, y, w, (w / logo.naturalWidth) * logo.naturalHeight);
    left = M + w + 28;
  }
  text(studio || 'Studio', left, y + 34, { size: 32, weight: 700 });
  font(19);
  ctx.fillStyle = SOFT;
  wrap(ctx, data.settings.studioContact, 420).slice(0, 4).forEach((l, i) => text(l, left, y + 66 + i * 27, { size: 19, color: SOFT }));
  text('INVOICE', W - M, y + 40, { size: 44, weight: 700, color: GOLD, align: 'right' });
  text(b.invoiceNo || '—', W - M, y + 78, { size: 22, weight: 600, align: 'right' });
  text(`Tanggal: ${shortDate(issued)}`, W - M, y + 108, { size: 19, color: SOFT, align: 'right' });
  if (b.dueDate && balanceOf(b) > 0) text(`Jatuh tempo: ${shortDate(b.dueDate)}`, W - M, y + 135, { size: 19, color: SOFT, align: 'right' });
  y += 190;
  rule(y);

  // To whom.
  y += 52;
  text('DITAGIHKAN KEPADA', M, y, { size: 16, weight: 600, color: SOFT });
  const state = payState(b);
  const stateColor = state === 'lunas' ? '#2f8a50' : state === 'dp' ? '#b8862e' : '#b84a4a';
  text(PAY_LABEL[state].toUpperCase(), W - M, y + 6, { size: 26, weight: 700, color: stateColor, align: 'right' });
  y += 36;
  text(client?.name || b.title || '—', M, y, { size: 26, weight: 600 });
  const contact = [client?.phone, client?.email].filter(Boolean).join('  ·  ');
  if (contact) text(contact, M, y + 32, { size: 19, color: SOFT });
  y += 76;

  // What was booked.
  const amountX = W - M;
  ctx.fillStyle = '#f5f6f5';
  ctx.fillRect(M, y, W - 2 * M, 52);
  text('Deskripsi', M + 20, y + 34, { size: 18, weight: 600, color: SOFT });
  text('Jumlah', amountX - 20, y + 34, { size: 18, weight: 600, color: SOFT, align: 'right' });
  y += 52;
  const row = (title: string, amount: string, detail?: string) => {
    y += 40;
    text(title, M + 20, y, { size: 22, weight: 600 });
    text(amount, amountX - 20, y, { size: 22, align: 'right' });
    if (detail) {
      font(18);
      for (const l of wrap(ctx, detail, 700).slice(0, 8)) {
        y += 27;
        text(l ? `• ${l}` : '', M + 36, y, { size: 18, color: SOFT });
      }
    }
    y += 22;
    rule(y);
  };
  const pkg = data.packages.find((p) => p.id === b.packageId);
  row(b.packageName || 'Layanan', rupiah(b.packagePrice), pkg?.description.trim() || undefined);
  for (const a of b.addons) row(a.name || 'Tambahan', rupiah(a.price));
  if (b.discount) row('Diskon', `− ${rupiah(b.discount)}`);

  // Totals, right-aligned under the table.
  y += 44;
  const label = (s: string, v: string, opts: { strong?: boolean; color?: string } = {}) => {
    text(s, W - M - 600, y, { size: opts.strong ? 24 : 20, weight: opts.strong ? 700 : 400, color: opts.strong ? INK : SOFT });
    text(v, W - M - 20, y, { size: opts.strong ? 24 : 20, weight: opts.strong ? 700 : 500, color: opts.color ?? INK, align: 'right' });
    y += 36;
  };
  label('Total', rupiah(totalOf(b)), { strong: true });
  for (const p of [...b.payments].sort((x, z) => x.date.localeCompare(z.date))) label(`Dibayar ${shortDate(p.date)}${p.method ? ` (${p.method})` : ''}`, `− ${rupiah(p.amount)}`);
  if (b.payments.length > 1) label('Total dibayar', rupiah(paidOf(b)));
  label('Sisa tagihan', rupiah(balanceOf(b)), { strong: true, color: balanceOf(b) > 0 ? '#b84a4a' : '#2f8a50' });

  // When, where to pay, the terms: a column of short blocks.
  const block = (title: string, body: string[]) => {
    if (!body.length || y > H - 200) return;
    y += 28;
    text(title, M, y, { size: 16, weight: 600, color: SOFT });
    font(19);
    for (const line of body.flatMap((l) => wrap(ctx, l, W - 2 * M))) {
      if (y > H - 120) return;
      y += 28;
      text(line, M, y, { size: 19 });
    }
    y += 14;
  };
  block(
    'JADWAL',
    [...b.sessions].sort((x, z) => x.start.localeCompare(z.start)).map((s) => `${s.label ? `${s.label}: ` : ''}${sessionWhen(s)}${s.location ? ` · ${s.location}` : ''}`),
  );
  if (balanceOf(b) > 0) block('PEMBAYARAN KE', data.settings.paymentInfo.trim() ? data.settings.paymentInfo.trim().split('\n') : []);
  block('SYARAT & KETENTUAN', data.settings.terms.trim() ? data.settings.terms.trim().split('\n') : []);

  // Footer.
  rule(H - 96);
  text(`Terima kasih${client?.name ? `, ${client.name}` : ''}.`, M, H - 56, { size: 19, color: SOFT });
  text(`Dibuat ${longDate(issued)}`, W - M, H - 56, { size: 16, color: SOFT, align: 'right' });
}

/** The invoice as PDF bytes (one A4 page). */
export async function invoicePdf(input: InvoiceInput): Promise<Uint8Array> {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  drawInvoice(canvas, input);
  const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Invoice gagal dibuat'))), 'image/jpeg', 0.92));
  const pdf = await makePdf([{ jpeg, width: W, height: H }], 595.28, 841.89);
  return new Uint8Array(await pdf.arrayBuffer());
}

/** The next invoice number ("INV-202611-007") and the counter after it. */
export function nextInvoiceNo(data: BisnisData, on = today()): { no: string; next: number } {
  const n = data.settings.nextInvoice;
  const prefix = data.settings.invoicePrefix.trim() || 'INV';
  return { no: `${prefix}-${on.slice(0, 4)}${on.slice(5, 7)}-${String(n).padStart(3, '0')}`, next: n + 1 };
}
