/**
 * The parts of Kelola Bisnis that touch the data itself: an old file read
 * without losing anything, clashes, due dates, moves, undo, numbers.
 * A mistake here reaches every studio's bookings, so it is checked here first.
 */

import { describe, expect, it } from 'vitest';

import { nextInvoiceNo } from './invoice';
import { fillTemplate } from './messages';
import { DEFAULT_TEMPLATES, balanceOf, clashesOf, deliveryDue, emptyData, fromJson, paidOf, payState, totalOf } from './model';
import { moveBooking } from './board';
import { nextReceiptNo } from './receipt';
import type { BisnisData, Booking, MessageTemplate, Session } from './types';
import { revert } from './undo';

const session = (start: string, end: string, extra: Partial<Session> = {}): Session => ({ id: `s-${start}`, start, end, label: '', location: '', ...extra });

const booking = (id: string, extra: Partial<Booking> = {}): Booking => ({
  id,
  clientId: '',
  title: id,
  packageId: null,
  packageName: 'Paket',
  packagePrice: 1_000_000,
  addons: [],
  discount: 0,
  sessions: [],
  columnId: 'jadwal',
  order: 0,
  payments: [],
  dueDate: '',
  deliveryDate: '',
  notes: '',
  invoiceNo: '',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

/** A file as an older version wrote it: no templatesVersion, templates without stage or picture. */
function oldFile(templates: MessageTemplate[], extra: Partial<BisnisData> = {}): string {
  const d: Partial<BisnisData> = { ...emptyData(), templates, ...extra };
  delete d.templatesVersion;
  return JSON.stringify(d);
}

const byId = (d: BisnisData, id: string) => d.templates.find((x) => x.id === id);

describe('fromJson', () => {
  it('migrates a file without templatesVersion (not skipped because the fresh default has one)', () => {
    const d = fromJson(
      oldFile([
        { id: 'pricelist', name: 'Pricelist', body: 'p' },
        { id: 'tagihan', name: 'Tagihan pelunasan', body: 't' },
        { id: 'pengingat', name: 'Pengingat jadwal', body: 'diubah sendiri' },
        { id: 'terima-kasih', name: 'Terima kasih', body: 'tk' },
      ]),
    );
    expect(byId(d, 'pengingat')?.columnId).toBe('jadwal');
    expect(byId(d, 'terima-kasih')?.columnId).toBe('selesai');
    expect(byId(d, 'tagihan')?.attach).toBe('invoice');
    expect(byId(d, 'follow-up')?.columnId).toBe('tanya');
    expect(byId(d, 'lunas')).toBeDefined();
    // A body changed by hand is kept.
    expect(byId(d, 'pengingat')?.body).toBe('diubah sendiri');
  });

  it('puts Pelunasan diterima right after Tagihan pelunasan', () => {
    const d = fromJson(oldFile([{ id: 'pricelist', name: 'Pricelist', body: 'p' }, { id: 'tagihan', name: 'Tagihan pelunasan', body: 't' }, { id: 'x', name: 'Lain', body: 'x' }]));
    const ids = d.templates.map((x) => x.id);
    expect(ids.indexOf('lunas')).toBe(ids.indexOf('tagihan') + 1);
  });

  it('gives every stage a template, and a stage added by the studio a starting one', () => {
    const d = fromJson(oldFile([], { columns: [...emptyData().columns, { id: 'cetak', name: 'Cetak album', color: '#fff' }] }));
    for (const c of d.columns) expect(d.templates.some((x) => x.columnId === c.id)).toBe(true);
    expect(d.templates.find((x) => x.columnId === 'cetak')?.name).toBe('Cetak album');
  });

  it('takes out an untouched stand-in when the built-in template gets its stage back', () => {
    const standIn = fromJson(oldFile([], { columns: emptyData().columns })).templates.find((x) => x.columnId === 'jadwal')!;
    const file = JSON.parse(oldFile([{ id: 'pengingat', name: 'Pengingat jadwal', body: 'p' }]));
    file.templatesVersion = 7;
    file.templates.push({ id: 'stand-in', name: 'Jadwal foto', columnId: 'jadwal', body: 'Halo {nama}, kabar terbaru untuk {paket}: booking kamu sekarang di tahap Jadwal foto.\n\nKalau ada yang ingin ditanyakan, kabari kami ya. Terima kasih!' });
    const d = fromJson(JSON.stringify(file));
    expect(byId(d, 'stand-in')).toBeUndefined();
    expect(byId(d, 'pengingat')?.columnId).toBe('jadwal');
    expect(standIn).toBeDefined();
  });

  it('keeps settings a file lacks at their defaults', () => {
    const file = JSON.parse(oldFile(DEFAULT_TEMPLATES));
    delete file.settings.teams;
    delete file.settings.deliveryDays;
    const d = fromJson(JSON.stringify(file));
    expect(d.settings.teams).toBe(1);
    expect(d.settings.deliveryDays).toBe(14);
  });

  it('refuses a file that is not Kelola Bisnis data', () => {
    expect(() => fromJson('{"hello":1}')).toThrow();
  });
});

describe('clashesOf', () => {
  const data = (bookings: Booking[], settings: Partial<BisnisData['settings']> = {}): BisnisData => ({ ...emptyData(), bookings, settings: { ...emptyData().settings, bufferMin: 0, ...settings } });
  const a = booking('a', { sessions: [session('2026-10-30T09:00', '2026-10-30T11:00')] });
  const b = booking('b', { sessions: [session('2026-10-30T10:30', '2026-10-30T12:00')] });
  const c = booking('c', { sessions: [session('2026-10-30T11:30', '2026-10-30T13:00')] });

  it('finds overlapping sessions, not its own', () => {
    expect(clashesOf(data([a, b]), a, a.sessions[0]!)).toHaveLength(1);
    expect(clashesOf(data([a]), a, a.sessions[0]!)).toHaveLength(0);
  });

  it('counts the gap between sessions as busy', () => {
    expect(clashesOf(data([a, c]), a, a.sessions[0]!)).toHaveLength(0);
    expect(clashesOf(data([a, c], { bufferMin: 60 }), a, a.sessions[0]!)).toHaveLength(1);
  });

  it('allows as many sessions at once as there are teams', () => {
    expect(clashesOf(data([a, b], { teams: 2 }), a, a.sessions[0]!)).toHaveLength(0);
    expect(clashesOf(data([a, b, c], { teams: 2, bufferMin: 60 }), a, a.sessions[0]!)).toHaveLength(2);
  });

  it('leaves out bookings in an inactive column (Batal)', () => {
    expect(clashesOf(data([a, { ...b, columnId: 'batal' }]), a, a.sessions[0]!)).toHaveLength(0);
  });

  it('always marks a blocked day, whatever the teams', () => {
    const d = { ...data([a], { teams: 5 }), blocked: [{ id: 'x', date: '2026-10-30', note: 'Libur' }] };
    expect(clashesOf(d, a, a.sessions[0]!)).toEqual([{ kind: 'blocked', note: 'Libur', day: '2026-10-30' }]);
  });
});

describe('deliveryDue', () => {
  it('is the days after the last session', () => {
    expect(deliveryDue([session('2026-10-29T09:00', '2026-10-29T11:00'), session('2026-11-02T09:00', '2026-11-02T11:00')], 14)).toBe('2026-11-16');
  });
  it('crosses months and years', () => {
    expect(deliveryDue([session('2026-12-25T09:00', '2026-12-25T11:00')], 14)).toBe('2027-01-08');
  });
  it('is empty without sessions or with 0 days', () => {
    expect(deliveryDue([], 14)).toBe('');
    expect(deliveryDue([session('2026-10-29T09:00', '2026-10-29T11:00')], 0)).toBe('');
  });
});

describe('money', () => {
  const b = booking('m', { packagePrice: 1_000_000, addons: [{ name: 'Drone', price: 500_000 }], discount: 100_000 });
  it('adds up the total, paid and balance', () => {
    expect(totalOf(b)).toBe(1_400_000);
    const paid = { ...b, payments: [{ id: 'p', date: '2026-10-01', amount: 400_000, method: 'Transfer', note: 'DP' }] };
    expect(paidOf(paid)).toBe(400_000);
    expect(balanceOf(paid)).toBe(1_000_000);
    expect(payState(paid)).toBe('dp');
    expect(payState(b)).toBe('belum');
    expect(payState({ ...b, payments: [{ id: 'p', date: '2026-10-01', amount: 1_400_000, method: 'Transfer', note: '' }] })).toBe('lunas');
  });
});

describe('moveBooking', () => {
  it('puts the booking in the column before the one given, renumbered', () => {
    const d = { ...emptyData(), bookings: [booking('x', { columnId: 'dp', order: 0 }), booking('y', { columnId: 'jadwal', order: 0 }), booking('z', { columnId: 'jadwal', order: 1 })] };
    const out = moveBooking(d, 'x', 'jadwal', 'z');
    const col = out.bookings.filter((b) => b.columnId === 'jadwal').sort((a, b) => a.order - b.order).map((b) => b.id);
    expect(col).toEqual(['y', 'x', 'z']);
  });
});

describe('revert (Urungkan)', () => {
  const x = { id: 'x', v: 1 };
  const y = { id: 'y', v: 1 };
  const z = { id: 'z', v: 1 };
  it('puts a removed item back where it was', () => {
    expect(revert([x, z], [x, y, z], [x, z])).toEqual([x, y, z]);
  });
  it('takes an added item out and an altered one back', () => {
    const y2 = { id: 'y', v: 2 };
    expect(revert([x, y2, z], [x, y], [x, y2, z])).toEqual([x, y]);
  });
  it('leaves what changed afterwards alone', () => {
    const x3 = { id: 'x', v: 3 };
    // y removed by the action; x changed by something else since.
    expect(revert([x3, z], [x, y, z], [x, z])).toEqual([x3, y, z]);
  });
});

describe('numbers', () => {
  it('numbers invoices and receipts by prefix, month and counter', () => {
    const d = { ...emptyData(), settings: { ...emptyData().settings, invoicePrefix: ' inv ', nextInvoice: 7, receiptPrefix: '', nextReceipt: 12 } };
    expect(nextInvoiceNo(d, '2026-10-29')).toEqual({ no: 'inv-202610-007', next: 8 });
    expect(nextReceiptNo(d, '2026-01-05')).toEqual({ no: 'KWT-202601-012', next: 13 });
  });
});

describe('fillTemplate', () => {
  it('fills what the booking has and leaves the rest as typed', () => {
    const d: BisnisData = { ...emptyData(), clients: [{ id: 'c', name: 'Rio', phone: '', email: '', notes: '', createdAt: 1 }] };
    const b = booking('b', { clientId: 'c', packageName: 'Wisuda' });
    expect(fillTemplate('Halo {nama}, {paket} — {jatuh_tempo}', d, 'Studio', b)).toBe('Halo Rio, Wisuda — {jatuh_tempo}');
  });
});
