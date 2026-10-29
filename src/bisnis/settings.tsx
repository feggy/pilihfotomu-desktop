/**
 * Pengaturan of Kelola Bisnis: the board's columns, the gap kept between
 * shoots, days off — and, further down, what other parts add (invoice,
 * reminders, backup) through `sections`.
 */

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { Switch, cx } from '../components/ui';
import { t } from '../lib/i18n';
import { newId, shortDate, today } from './model';
import { useBisnis } from './store';
import type { BisnisSettings, Column } from './types';
import { Field, LazyInput, SectionTitle, TextArea, btnGhost, inputCls } from './ui';

const COLORS = ['#8a9a93', '#c9a96e', '#5b9bd5', '#a77bca', '#e0904a', '#5fb87a', '#c96a6a', '#4fb3b3'];

export function Settings({ sections }: { sections?: ReactNode }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const setCol = (id: string, patch: Partial<Column>) => update((d) => ({ ...d, columns: d.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const moveCol = (i: number, by: number) =>
    update((d) => {
      const cols = [...d.columns];
      const [c] = cols.splice(i, 1);
      cols.splice(i + by, 0, c!);
      return { ...d, columns: cols };
    });
  // A column taken away hands its bookings to the first column left.
  const removeCol = (id: string) =>
    update((d) => {
      const cols = d.columns.filter((c) => c.id !== id);
      const to = cols[0]!.id;
      return { ...d, columns: cols, bookings: d.bookings.map((b) => (b.columnId === id ? { ...b, columnId: to } : b)) };
    });
  const [newDay, newNote] = ['bisnis-new-day', 'bisnis-new-note'];
  const setSettings = (patch: Partial<BisnisSettings>) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } }));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-4 pb-10 lg:px-8">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8">
        <section className="flex flex-col gap-3">
          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => update((d) => ({ ...d, columns: [...d.columns, { id: newId(), name: t('Kolom baru'), color: COLORS[d.columns.length % COLORS.length]! }] }))}
                className={cx(btnGhost, 'h-8 px-3 text-xs')}
              >
                <Plus size={14} /> {t('Tambah kolom')}
              </button>
            }
          >
            {t('Kolom board')}
          </SectionTitle>
          <p className="-mt-1 text-xs text-faint">{t('Tahap yang dilalui tiap booking. Kolom "tidak aktif" (mis. Batal) tidak dihitung saat cek bentrok, tagihan, dan pengingat.')}</p>
          {data.columns.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 rounded-xl border border-line-soft bg-panel p-2">
              <span className="flex flex-col">
                <button type="button" disabled={i === 0} onClick={() => moveCol(i, -1)} aria-label={t('Naikkan')} className="text-faint hover:text-fg disabled:opacity-25">
                  <ArrowUp size={13} />
                </button>
                <button type="button" disabled={i === data.columns.length - 1} onClick={() => moveCol(i, 1)} aria-label={t('Turunkan')} className="text-faint hover:text-fg disabled:opacity-25">
                  <ArrowDown size={13} />
                </button>
              </span>
              <span className="flex gap-1">
                {COLORS.map((color) => (
                  <button key={color} type="button" onClick={() => setCol(c.id, { color })} aria-label={color} className={cx('size-4 rounded-full', c.color === color ? 'ring-2 ring-fg ring-offset-1 ring-offset-panel' : '')} style={{ background: color }} />
                ))}
              </span>
              <LazyInput value={c.name} onCommit={(name) => name.trim() && setCol(c.id, { name: name.trim() })} className={cx(inputCls, 'h-8 flex-1')} />
              <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
                {t('Tidak aktif')}
                <Switch label={t('Tidak aktif')} checked={!!c.inactive} onChange={(inactive) => setCol(c.id, { inactive })} />
              </label>
              <button
                type="button"
                disabled={data.columns.length <= 1}
                onClick={() => removeCol(c.id)}
                title={t('Hapus kolom (bookingnya pindah ke kolom pertama)')}
                className="rounded-lg p-1.5 text-faint hover:text-reject disabled:opacity-25"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle>{t('Jadwal')}</SectionTitle>
          <Field label={t('Jeda antar jadwal (menit)')} hint={t('Waktu perjalanan dan persiapan. Dua jadwal yang lebih dekat dari ini ditandai bentrok.')} className="max-w-60">
            <input type="number" min={0} step={15} value={data.settings.bufferMin} onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, bufferMin: Math.max(0, Number(e.target.value) || 0) } }))} className={inputCls} />
          </Field>
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle>{t('Hari libur')}</SectionTitle>
          <p className="-mt-1 text-xs text-faint">{t('Booking di hari ini diberi peringatan. Bisa juga ditandai langsung dari Kalender.')}</p>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const date = (form.elements.namedItem(newDay) as HTMLInputElement).value;
              const note = (form.elements.namedItem(newNote) as HTMLInputElement).value.trim();
              if (!date) return;
              update((d) => ({ ...d, blocked: [...d.blocked.filter((x) => x.date !== date), { id: newId(), date, note }].sort((a, b) => a.date.localeCompare(b.date)) }));
              form.reset();
            }}
          >
            <Field label={t('Tanggal')} className="w-44">
              <input name={newDay} type="date" className={inputCls} />
            </Field>
            <Field label={t('Keterangan')} className="flex-1">
              <input name={newNote} placeholder={t('mis. Liburan keluarga')} className={inputCls} />
            </Field>
            <button type="submit" className={btnGhost}>
              <Plus size={14} /> {t('Tambah')}
            </button>
          </form>
          {data.blocked.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-lg bg-panel px-3 py-2 text-[13px]">
              <span className="w-28 shrink-0 font-medium tabular-nums">{shortDate(d.date)}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{d.note || t('Libur')}</span>
              <button type="button" onClick={() => update((x) => ({ ...x, blocked: x.blocked.filter((b) => b.id !== d.id) }))} aria-label={t('Hapus')} className="text-faint hover:text-reject">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-3">
          <SectionTitle>{t('Invoice & pembayaran')}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Awalan nomor invoice')} hint={t('Nomor berikutnya: {no}', { no: `${data.settings.invoicePrefix || 'INV'}-${today().slice(0, 4)}${today().slice(5, 7)}-${String(data.settings.nextInvoice).padStart(3, '0')}` })}>
              <LazyInput value={data.settings.invoicePrefix} onCommit={(invoicePrefix) => setSettings({ invoicePrefix: invoicePrefix.trim().toUpperCase() })} />
            </Field>
            <Field label={t('Urutan berikutnya')}>
              <input type="number" min={1} value={data.settings.nextInvoice} onChange={(e) => setSettings({ nextInvoice: Math.max(1, Number(e.target.value) || 1) })} className={inputCls} />
            </Field>
            <Field label={t('DP minimal (% dari total)')} hint={t('Untuk isian {dp_minimal} di pesan konfirmasi.')}>
              <input type="number" min={0} max={100} step={5} value={data.settings.minDpPercent} onChange={(e) => setSettings({ minDpPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} className={inputCls} />
            </Field>
          </div>
          <Field label={t('Kontak studio (di bawah nama studio pada invoice)')}>
            <TextArea value={data.settings.studioContact} onCommit={(studioContact) => setSettings({ studioContact })} rows={3} placeholder={t('Alamat\n0812-xxxx-xxxx · @namastudio')} />
          </Field>
          <Field label={t('Rekening pembayaran')} hint={t('Muncul di invoice dan pesan WhatsApp ({rekening}).')}>
            <TextArea value={data.settings.paymentInfo} onCommit={(paymentInfo) => setSettings({ paymentInfo })} rows={3} placeholder={t('BCA 1234567890 a.n. Nama Studio')} />
          </Field>
          <Field label={t('Syarat & ketentuan')}>
            <TextArea value={data.settings.terms} onCommit={(terms) => setSettings({ terms })} rows={4} />
          </Field>
        </section>
        {sections}
      </div>
    </div>
  );
}
