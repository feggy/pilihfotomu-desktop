/**
 * WhatsApp messages: a template's {nama}, {paket}, {jadwal}… filled from a
 * booking, the pricelist written out from the packages, and the wa.me link
 * that opens WhatsApp with it — sent from the photographer's own number.
 */

import { balanceOf, clientOf, nextSession, paidOf, rupiah, sessionWhen, shortDate, timeOf, totalOf, longDate } from './model';
import type { BisnisData, Booking } from './types';

/** What can go in a template, with what it says, for the help under the editor. */
export const VARIABLES: { key: string; label: string }[] = [
  { key: 'nama', label: 'Nama klien' },
  { key: 'studio', label: 'Nama studio' },
  { key: 'paket', label: 'Paket' },
  { key: 'jadwal', label: 'Jadwal (semua sesi)' },
  { key: 'tanggal', label: 'Tanggal sesi berikutnya' },
  { key: 'jam', label: 'Jam sesi berikutnya' },
  { key: 'lokasi', label: 'Lokasi sesi berikutnya' },
  { key: 'total', label: 'Total' },
  { key: 'dp_minimal', label: 'DP minimal' },
  { key: 'terbayar', label: 'Sudah dibayar' },
  { key: 'sisa', label: 'Sisa tagihan' },
  { key: 'jatuh_tempo', label: 'Jatuh tempo pelunasan' },
  { key: 'invoice', label: 'Nomor invoice' },
  { key: 'rekening', label: 'Rekening' },
  { key: 'pricelist', label: 'Daftar paket' },
];

/** The packages for sale as a WhatsApp message (*bold* names, a line per item). */
export function pricelistText(data: BisnisData): string {
  const lines: string[] = [];
  for (const p of data.packages.filter((x) => !x.archived)) {
    lines.push(`*${p.name}* — ${rupiah(p.price)}`);
    for (const item of p.description.split('\n').map((l) => l.trim()).filter(Boolean)) lines.push(`• ${item}`);
    lines.push('');
  }
  const extras = data.addons.filter((a) => a.name.trim());
  if (extras.length) {
    lines.push('*Tambahan*');
    for (const a of extras) lines.push(`• ${a.name} — ${rupiah(a.price)}`);
  }
  return lines.join('\n').trim();
}

/** `body` with its {variables} filled from `booking` (or left as they are without one); unknown ones stay. */
export function fillTemplate(body: string, data: BisnisData, studio: string, booking: Booking | null, name = ''): string {
  const client = booking ? clientOf(data, booking) : null;
  const next = booking ? nextSession(booking) : null;
  const sessions = booking ? [...booking.sessions].sort((a, b) => a.start.localeCompare(b.start)) : [];
  const values: Record<string, string | undefined> = {
    nama: client?.name || name || undefined,
    studio: studio || undefined,
    pricelist: pricelistText(data) || undefined,
    rekening: data.settings.paymentInfo.trim() || undefined,
  };
  if (booking) {
    Object.assign(values, {
      paket: booking.packageName || undefined,
      jadwal: sessions.length ? sessions.map((s) => `${s.label ? `${s.label}: ` : ''}${sessionWhen(s)}${s.location ? `, ${s.location}` : ''}`).join('\n') : undefined,
      tanggal: next ? longDate(next.start.split('T')[0]!) : undefined,
      jam: next ? `${timeOf(next.start)}–${timeOf(next.end)}` : undefined,
      lokasi: next?.location || undefined,
      total: rupiah(totalOf(booking)),
      dp_minimal: rupiah(Math.round((totalOf(booking) * data.settings.minDpPercent) / 100 / 1000) * 1000),
      terbayar: rupiah(paidOf(booking)),
      sisa: rupiah(balanceOf(booking)),
      jatuh_tempo: booking.dueDate ? shortDate(booking.dueDate) : undefined,
      invoice: booking.invoiceNo || undefined,
    });
  }
  return body.replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m);
}

/** A phone number as WhatsApp wants it: digits, Indonesian 0… and 8… as 62…. */
export function waNumber(phone: string): string {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = `62${d.slice(1)}`;
  else if (d.startsWith('8')) d = `62${d}`;
  return d;
}

/** The wa.me link that opens a chat with `text` ready to send (any chat to pick, without a number). */
export const waLink = (phone: string, text: string) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
