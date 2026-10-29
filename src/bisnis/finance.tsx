/**
 * Keuangan: money in (payments received) and out (expenses) for a month or
 * a year, what is left over, what clients still owe, which packages earn —
 * counted by the day money moved, as a small studio's books are kept. Export
 * as CSV for a spreadsheet or an accountant.
 */

import { save } from '@tauri-apps/plugin-dialog';
import { openPath } from '@tauri-apps/plugin-opener';
import { ChevronLeft, ChevronRight, FileSpreadsheet, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Segmented, cx } from '../components/ui';
import { api } from '../lib/api';
import { Select } from '../components/select';
import { t } from '../lib/i18n';
import { useApp } from '../store';
import { MONTHS, balanceOf, clientOf, newId, rupiah, shortDate, titleOf, today } from './model';
import { useBisnis } from './store';
import { DateInput } from '../components/date-picker';
import type { BisnisData, Booking } from './types';
import { Field, MoneyInput, SectionTitle, btnGhost, inputCls } from './ui';

type Period = { kind: 'bulan' | 'tahun'; year: number; month: number };

const inPeriod = (day: string, p: Period) => day.startsWith(p.kind === 'tahun' ? `${p.year}-` : `${p.year}-${String(p.month + 1).padStart(2, '0')}-`);

/** Every rupiah that moved in the period: payments in, expenses out. */
function moves(data: BisnisData, p: Period) {
  const income = data.bookings.flatMap((b) => b.payments.filter((x) => inPeriod(x.date, p)).map((x) => ({ booking: b, payment: x })));
  const expenses = data.expenses.filter((e) => inPeriod(e.date, p));
  return { income, expenses };
}

export function Finance({ onOpen }: { onOpen: (b: Booking) => void }) {
  const data = useBisnis((s) => s.data)!;
  const now = new Date();
  const [period, setPeriod] = useState<Period>({ kind: 'bulan', year: now.getFullYear(), month: now.getMonth() });
  const step = (by: number) =>
    setPeriod((p) => {
      if (p.kind === 'tahun') return { ...p, year: p.year + by };
      const m = p.month + by;
      return { ...p, year: p.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  const { income, expenses } = useMemo(() => moves(data, period), [data, period]);
  const totalIn = income.reduce((s, x) => s + x.payment.amount, 0);
  const totalOut = expenses.reduce((s, e) => s + e.amount, 0);
  const inactive = new Set(data.columns.filter((c) => c.inactive).map((c) => c.id));
  const owed = data.bookings.filter((b) => !inactive.has(b.columnId) && balanceOf(b) > 0).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const totalOwed = owed.reduce((s, b) => s + balanceOf(b), 0);

  // Received per package, biggest first.
  const byPackage = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of income) m.set(x.booking.packageName || t('Tanpa paket'), (m.get(x.booking.packageName || t('Tanpa paket')) ?? 0) + x.payment.amount);
    return [...m].sort((a, b) => b[1] - a[1]);
  }, [income]);
  // A year: each month in and out.
  const byMonth = useMemo(() => {
    if (period.kind !== 'tahun') return [];
    return MONTHS.map((_, month) => {
      const m = moves(data, { kind: 'bulan', year: period.year, month });
      return { month, in: m.income.reduce((s, x) => s + x.payment.amount, 0), out: m.expenses.reduce((s, e) => s + e.amount, 0) };
    });
  }, [data, period]);
  const peak = Math.max(1, ...byMonth.map((m) => Math.max(m.in, m.out)));

  const label = period.kind === 'tahun' ? String(period.year) : `${t(MONTHS[period.month]!)} ${period.year}`;

  const exportCsv = async () => {
    const rows = [
      ['Tanggal', 'Jenis', 'Kategori / paket', 'Klien', 'Keterangan', 'Jumlah'],
      ...income.map((x) => [x.payment.date, 'Pemasukan', x.booking.packageName, clientOf(data, x.booking)?.name ?? '', [x.payment.note, x.payment.method].filter(Boolean).join(' · '), String(x.payment.amount)]),
      ...expenses.map((e) => {
        const b = e.bookingId ? data.bookings.find((x) => x.id === e.bookingId) : undefined;
        return [e.date, 'Pengeluaran', e.category, b ? titleOf(data, b) : '', e.note, String(-e.amount)];
      }),
    ].sort((a, b) => (a[0] === 'Tanggal' ? -1 : b[0] === 'Tanggal' ? 1 : a[0]!.localeCompare(b[0]!)));
    const csv = rows.map((r) => r.map((c) => (/[",\n;]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\r\n');
    const path = await save({ title: t('Ekspor laporan'), defaultPath: `Keuangan ${label}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!path) return;
    try {
      // With a byte-order mark, so Excel reads the rupiah and names as UTF-8.
      const written = await api.writeUserFile(path, new TextEncoder().encode(`﻿${csv}`));
      openPath(written).catch(() => {});
    } catch (e) {
      useApp.getState().fail(e);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-4 pb-10 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => step(-1)} aria-label={t('Sebelumnya')} className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-fg">
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => step(1)} aria-label={t('Berikutnya')} className="rounded-lg p-1.5 text-muted hover:bg-raised hover:text-fg">
            <ChevronRight size={16} />
          </button>
          <span className="min-w-40 text-[15px] font-semibold">{label}</span>
          <span className="w-44">
            <Segmented
              value={period.kind}
              onChange={(kind) => setPeriod((p) => ({ ...p, kind }))}
              options={[
                { value: 'bulan', label: t('Bulan') },
                { value: 'tahun', label: t('Tahun') },
              ]}
            />
          </span>
          <button type="button" onClick={exportCsv} className={cx(btnGhost, 'ml-auto')}>
            <FileSpreadsheet size={14} /> {t('Ekspor CSV')}
          </button>
        </div>

        <div className="grid grid-cols-4 gap-3">
          {(
            [
              [t('Pemasukan'), totalIn, 'text-pick', t('Pembayaran yang diterima')],
              [t('Pengeluaran'), totalOut, 'text-reject', t('{n} catatan', { n: expenses.length })],
              [t('Laba'), totalIn - totalOut, totalIn - totalOut >= 0 ? 'text-fg' : 'text-reject', t('Pemasukan dikurangi pengeluaran')],
              [t('Piutang'), totalOwed, 'text-maybe', t('Sisa tagihan semua booking aktif')],
            ] as const
          ).map(([name, value, cls, note]) => (
            <div key={name} className="flex flex-col gap-1 rounded-2xl bg-panel px-4 py-3.5">
              <span className="text-[11px] font-medium text-faint">{name}</span>
              <span className={cx('text-xl font-semibold tabular-nums', cls)}>{rupiah(value)}</span>
              <span className="text-[11px] text-faint">{note}</span>
            </div>
          ))}
        </div>

        {period.kind === 'tahun' && (
          <section className="flex flex-col gap-2">
            <SectionTitle>{t('Per bulan')}</SectionTitle>
            <div className="flex flex-col gap-1 rounded-2xl bg-panel p-4">
              {byMonth.map((m) => (
                <div key={m.month} className="grid grid-cols-[48px_1fr_120px_120px] items-center gap-3 text-xs">
                  <span className="text-muted">{t(MONTHS[m.month]!).slice(0, 3)}</span>
                  <span className="flex flex-col gap-0.5">
                    <span className="h-1.5 rounded-full bg-pick/80" style={{ width: `${(m.in / peak) * 100}%` }} />
                    <span className="h-1.5 rounded-full bg-reject/70" style={{ width: `${(m.out / peak) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums">{rupiah(m.in)}</span>
                  <span className="text-right text-faint tabular-nums">− {rupiah(m.out)}</span>
                </div>
              ))}
              <span className="mt-1 flex gap-4 text-[11px] text-faint">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-3 rounded-full bg-pick/80" /> {t('Pemasukan')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-3 rounded-full bg-reject/70" /> {t('Pengeluaran')}
                </span>
              </span>
            </div>
          </section>
        )}

        <div className="grid grid-cols-2 gap-6">
          <section className="flex flex-col gap-2">
            <SectionTitle>{t('Pemasukan per paket')}</SectionTitle>
            <div className="flex flex-col gap-1 rounded-2xl bg-panel p-3">
              {byPackage.length === 0 && <span className="px-1 py-3 text-xs text-faint">{t('Belum ada pembayaran di periode ini.')}</span>}
              {byPackage.map(([name, value]) => (
                <div key={name} className="flex items-center gap-3 px-1 py-1.5 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span className="text-[11px] text-faint">{Math.round((value / Math.max(1, totalIn)) * 100)}%</span>
                  <span className="w-32 text-right font-medium tabular-nums">{rupiah(value)}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="flex flex-col gap-2">
            <SectionTitle>{t('Piutang')}</SectionTitle>
            <div className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded-2xl bg-panel p-3">
              {owed.length === 0 && <span className="px-1 py-3 text-xs text-faint">{t('Semua booking aktif sudah lunas.')}</span>}
              {owed.map((b) => {
                const late = b.dueDate && b.dueDate < today();
                return (
                  <button key={b.id} type="button" onClick={() => onOpen(b)} className="flex items-center gap-3 rounded-lg px-1 py-1.5 text-left text-[13px] hover:bg-raised">
                    <span className="min-w-0 flex-1 truncate">{titleOf(data, b)}</span>
                    <span className={cx('text-[11px]', late ? 'text-reject' : 'text-faint')}>{b.dueDate ? shortDate(b.dueDate) : t('tanpa tenggat')}</span>
                    <span className="w-32 text-right font-medium tabular-nums">{rupiah(balanceOf(b))}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        <Expenses period={period} />
      </div>
    </div>
  );
}

/** The period's expenses, and a line to add one. */
function Expenses({ period }: { period: Period }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const day = inPeriod(today(), period) ? today() : `${period.year}-${String((period.kind === 'tahun' ? 0 : period.month) + 1).padStart(2, '0')}-01`;
  const [draft, setDraft] = useState({ date: day, category: data.expenseCategories[0] ?? '', amount: 0, note: '', bookingId: '' });
  // Typing a category of its own instead of picking one.
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const list = data.expenses.filter((e) => inPeriod(e.date, period)).sort((a, b) => b.date.localeCompare(a.date));
  const add = () => {
    if (!draft.amount) return;
    const category = newCategory.trim() || draft.category;
    update((d) => ({
      ...d,
      expenses: [...d.expenses, { id: newId(), date: draft.date, amount: draft.amount, category, note: draft.note.trim(), bookingId: draft.bookingId || null }],
      expenseCategories: d.expenseCategories.includes(category) ? d.expenseCategories : [...d.expenseCategories, category],
    }));
    setDraft({ ...draft, amount: 0, note: '', bookingId: '', category });
    setNewCategory('');
    setAdding(false);
  };
  const recent = [...data.bookings].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30);
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>{t('Pengeluaran')}</SectionTitle>
      <div className="grid grid-cols-[140px_170px_160px_1fr_180px_auto] items-end gap-2 rounded-2xl bg-panel p-3">
        <Field label={t('Tanggal')}>
          <DateInput value={draft.date} onChange={(date) => setDraft({ ...draft, date })} clearable={false} />
        </Field>
        <Field label={t('Kategori')}>
          {adding || !data.expenseCategories.length ? (
            <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder={t('Kategori baru')} autoFocus className={inputCls} />
          ) : (
            <Select
              value={draft.category}
              onChange={(v) => (v === '+' ? setAdding(true) : setDraft({ ...draft, category: v }))}
              options={[...data.expenseCategories.map((c) => ({ value: c, label: c })), { value: '+', label: t('+ Kategori baru…'), divided: true }]}
            />
          )}
        </Field>
        <Field label={t('Jumlah')}>
          <MoneyInput value={draft.amount} onChange={(amount) => setDraft({ ...draft, amount })} />
        </Field>
        <Field label={t('Keterangan')}>
          <input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={t('mis. Bensin ke Kaliurang')} className={inputCls} />
        </Field>
        <Field label={t('Untuk booking (opsional)')}>
          <Select value={draft.bookingId} onChange={(bookingId) => setDraft({ ...draft, bookingId })} options={[{ value: '', label: '—' }, ...recent.map((b) => ({ value: b.id, label: titleOf(data, b) }))]} />
        </Field>
        <button type="button" onClick={add} disabled={!draft.amount} className={cx(btnGhost, 'disabled:opacity-40')}>
          <Plus size={14} /> {t('Catat')}
        </button>
      </div>
      {list.length === 0 && <span className="text-xs text-faint">{t('Belum ada pengeluaran di periode ini.')}</span>}
      {list.map((e) => {
        const b = e.bookingId ? data.bookings.find((x) => x.id === e.bookingId) : undefined;
        return (
          <div key={e.id} className="grid grid-cols-[110px_150px_1fr_160px_auto] items-center gap-3 rounded-lg bg-panel px-3 py-2 text-[13px]">
            <span className="text-muted tabular-nums">{shortDate(e.date)}</span>
            <span className="truncate">{e.category}</span>
            <span className="min-w-0 truncate text-muted">
              {e.note}
              {b && <span className="text-faint"> · {titleOf(data, b)}</span>}
            </span>
            <span className="text-right font-medium text-reject tabular-nums">− {rupiah(e.amount)}</span>
            <button type="button" onClick={() => update((d) => ({ ...d, expenses: d.expenses.filter((x) => x.id !== e.id) }))} aria-label={t('Hapus')} className="text-faint hover:text-reject">
              <Trash2 size={14} />
            </button>
          </div>
        );
      })}
    </section>
  );
}
