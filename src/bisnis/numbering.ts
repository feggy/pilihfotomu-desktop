/**
 * Invoice and receipt numbers, given the first time one is made (a dialog,
 * a picture sent in a chat) and kept after. Read from the data as it is when
 * written, so making one twice never uses up two numbers.
 */

import { nextInvoiceNo } from './invoice';
import { nextReceiptNo } from './receipt';
import { useBisnis } from './store';

export function ensureInvoiceNo(bookingId: string) {
  useBisnis.getState().update((d) => {
    if (d.bookings.find((b) => b.id === bookingId)?.invoiceNo) return d;
    const { no, next } = nextInvoiceNo(d);
    return { ...d, settings: { ...d.settings, nextInvoice: next }, bookings: d.bookings.map((b) => (b.id === bookingId ? { ...b, invoiceNo: no } : b)) };
  });
}

export function ensureReceiptNo(bookingId: string, paymentId: string) {
  useBisnis.getState().update((d) => {
    const p = d.bookings.find((b) => b.id === bookingId)?.payments.find((x) => x.id === paymentId);
    if (!p || p.receiptNo) return d;
    const { no, next } = nextReceiptNo(d, p.date);
    return {
      ...d,
      settings: { ...d.settings, nextReceipt: next },
      bookings: d.bookings.map((b) => (b.id === bookingId ? { ...b, payments: b.payments.map((x) => (x.id === paymentId ? { ...x, receiptNo: no } : x)) } : b)),
    };
  });
}
