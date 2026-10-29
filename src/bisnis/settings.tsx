/**
 * Pengaturan of Kelola Bisnis: the board's columns, the gap kept between
 * shoots, days off — and, further down, what other parts add (invoice,
 * reminders, backup) through `sections`.
 */

import { open, save } from '@tauri-apps/plugin-dialog';
import { ArrowDown, ArrowUp, Download, FolderSync, Plus, ShieldAlert, Trash2, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Switch, cx } from '../components/ui';
import { t } from '../lib/i18n';
import { newId, shortDate, today } from './model';
import { useBisnis } from './store';
import { DateInput } from '../components/date-picker';
import { applyBackup, autoBackupError, backupName, exportBackup, lastBackupAt, readBackup } from './backup';
import type { BisnisData, BisnisSettings, BlockedDay, Column } from './types';
import { SaveBar, useDirty } from './unsaved';
import { Field, LazyInput, NumberInput, SectionTitle, TextArea, btnGhost, inputCls } from './ui';

/** What Pengaturan edits before Simpan perubahan. */
type Draft = { columns: Column[]; blocked: BlockedDay[]; settings: BisnisSettings };

const COLORS = ['#8a9a93', '#c9a96e', '#5b9bd5', '#a77bca', '#e0904a', '#5fb87a', '#c96a6a', '#4fb3b3'];

export function Settings({ sections }: { sections?: ReactNode }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  // Changes are made to a copy, kept by Simpan perubahan; Batal (or leaving and discarding) throws them away.
  const snapshot = (): Draft => ({ columns: data.columns, blocked: data.blocked, settings: data.settings });
  const [base, setBase] = useState<Draft>(snapshot);
  const [draft, setDraft] = useState<Draft>(base);
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  useDirty(dirty);
  const saveDraft = () => {
    update((d) => {
      // Only the settings changed here: a counter moved meanwhile by an invoice stays as it is.
      const changed = Object.fromEntries(Object.entries(draft.settings).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(base.settings[k as keyof BisnisSettings])));
      const columns = draft.columns;
      // Bookings of a column taken away go to the first column left.
      const ids = new Set(columns.map((c) => c.id));
      return {
        ...d,
        columns,
        blocked: draft.blocked,
        settings: { ...d.settings, ...changed },
        bookings: d.bookings.map((b) => (ids.has(b.columnId) ? b : { ...b, columnId: columns[0]!.id })),
      };
    });
    const now = useBisnis.getState().data!;
    const next = { columns: now.columns, blocked: now.blocked, settings: now.settings };
    setBase(next);
    setDraft(next);
  };
  const cancel = () => {
    const now = snapshot();
    setBase(now);
    setDraft(now);
  };
  const setCol = (id: string, patch: Partial<Column>) => setDraft((d) => ({ ...d, columns: d.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const moveCol = (i: number, by: number) =>
    setDraft((d) => {
      const cols = [...d.columns];
      const [c] = cols.splice(i, 1);
      cols.splice(i + by, 0, c!);
      return { ...d, columns: cols };
    });
  // A column taken away hands its bookings to the first column left (when saved).
  const removeCol = (id: string) => setDraft((d) => ({ ...d, columns: d.columns.filter((c) => c.id !== id) }));
  // A day off being added.
  const [dayOff, setDayOff] = useState({ date: '', note: '' });
  const setSettings = (patch: Partial<BisnisSettings>) => setDraft((d) => ({ ...d, settings: { ...d.settings, ...patch } }));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-4 pb-28 lg:px-8">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8">
        <section className="flex flex-col gap-3">
          <SectionTitle
            action={
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, columns: [...d.columns, { id: newId(), name: t('Kolom baru'), color: COLORS[d.columns.length % COLORS.length]! }] }))}
                className={cx(btnGhost, 'h-8 px-3 text-xs')}
              >
                <Plus size={14} /> {t('Tambah kolom')}
              </button>
            }
          >
            {t('Kolom board')}
          </SectionTitle>
          <p className="-mt-1 text-xs text-faint">{t('Tahap yang dilalui tiap booking. Kolom "tidak aktif" (mis. Batal) tidak dihitung saat cek bentrok, tagihan, dan pengingat.')}</p>
          {draft.columns.map((c, i) => (
            <div key={c.id} className="flex items-center gap-2 rounded-xl border border-line-soft bg-panel p-2">
              <span className="flex flex-col">
                <button type="button" disabled={i === 0} onClick={() => moveCol(i, -1)} aria-label={t('Naikkan')} className="text-faint hover:text-fg disabled:opacity-25">
                  <ArrowUp size={13} />
                </button>
                <button type="button" disabled={i === draft.columns.length - 1} onClick={() => moveCol(i, 1)} aria-label={t('Turunkan')} className="text-faint hover:text-fg disabled:opacity-25">
                  <ArrowDown size={13} />
                </button>
              </span>
              <span className="flex gap-1">
                {COLORS.map((color) => (
                  <button key={color} type="button" onClick={() => setCol(c.id, { color })} aria-label={color} className={cx('size-4 rounded-full', c.color === color ? 'ring-2 ring-fg ring-offset-1 ring-offset-panel' : '')} style={{ background: color }} />
                ))}
              </span>
              <LazyInput value={c.name} onCommit={(name) => name.trim() && setCol(c.id, { name: name.trim() })} className={cx(inputCls, 'h-8 flex-1')} />
              <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted" title={t('Booking di kolom ini dianggap sudah dikirim: tidak ada pengingat kirim hasil.')}>
                {t('Selesai')}
                <Switch label={t('Selesai')} checked={!!c.done} onChange={(done) => setCol(c.id, { done })} />
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
                {t('Tidak aktif')}
                <Switch label={t('Tidak aktif')} checked={!!c.inactive} onChange={(inactive) => setCol(c.id, { inactive })} />
              </div>
              <button
                type="button"
                disabled={draft.columns.length <= 1}
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
          <Field label={t('Jeda antar jadwal')} hint={t('Waktu perjalanan dan persiapan. Dua jadwal yang lebih dekat dari ini ditandai bentrok.')} className="max-w-60">
            <NumberInput value={draft.settings.bufferMin} onCommit={(bufferMin) => setSettings({ bufferMin })} max={600} unit={t('menit')} />
          </Field>
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle>{t('Hari libur')}</SectionTitle>
          <p className="-mt-1 text-xs text-faint">{t('Booking di hari ini diberi peringatan. Bisa juga ditandai langsung dari Kalender.')}</p>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const date = dayOff.date;
              if (!date) return;
              setDraft((d) => ({ ...d, blocked: [...d.blocked.filter((x) => x.date !== date), { id: newId(), date, note: dayOff.note.trim() }].sort((a, b) => a.date.localeCompare(b.date)) }));
              setDayOff({ date: '', note: '' });
            }}
          >
            <Field label={t('Tanggal')} className="w-44">
              <DateInput value={dayOff.date} onChange={(date) => setDayOff({ ...dayOff, date })} />
            </Field>
            <Field label={t('Keterangan')} className="flex-1">
              <input value={dayOff.note} onChange={(e) => setDayOff({ ...dayOff, note: e.target.value })} placeholder={t('mis. Liburan keluarga')} className={inputCls} />
            </Field>
            <button type="submit" disabled={!dayOff.date} className={cx(btnGhost, 'disabled:opacity-40')}>
              <Plus size={14} /> {t('Tambah')}
            </button>
          </form>
          {draft.blocked.map((d) => (
            <div key={d.id} className="flex items-center gap-3 rounded-lg bg-panel px-3 py-2 text-[13px]">
              <span className="w-28 shrink-0 font-medium tabular-nums">{shortDate(d.date)}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{d.note || t('Libur')}</span>
              <button type="button" onClick={() => setDraft((x) => ({ ...x, blocked: x.blocked.filter((b) => b.id !== d.id) }))} aria-label={t('Hapus')} className="text-faint hover:text-reject">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </section>
        <section className="flex flex-col gap-3">
          <SectionTitle>{t('Invoice & pembayaran')}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('Awalan nomor invoice')} hint={t('Nomor berikutnya: {no}', { no: `${draft.settings.invoicePrefix || 'INV'}-${today().slice(0, 4)}${today().slice(5, 7)}-${String(draft.settings.nextInvoice).padStart(3, '0')}` })}>
              <LazyInput value={draft.settings.invoicePrefix} onCommit={(invoicePrefix) => setSettings({ invoicePrefix: invoicePrefix.trim().toUpperCase() })} />
            </Field>
            <Field label={t('Urutan berikutnya')}>
              <NumberInput value={draft.settings.nextInvoice} onCommit={(nextInvoice) => setSettings({ nextInvoice })} min={1} />
            </Field>
            <Field label={t('Awalan nomor kuitansi')} hint={t('Nomor berikutnya: {no}', { no: `${draft.settings.receiptPrefix || 'KWT'}-${today().slice(0, 4)}${today().slice(5, 7)}-${String(draft.settings.nextReceipt).padStart(3, '0')}` })}>
              <LazyInput value={draft.settings.receiptPrefix} onCommit={(receiptPrefix) => setSettings({ receiptPrefix: receiptPrefix.trim().toUpperCase() })} />
            </Field>
            <Field label={t('Urutan kuitansi berikutnya')}>
              <NumberInput value={draft.settings.nextReceipt} onCommit={(nextReceipt) => setSettings({ nextReceipt })} min={1} />
            </Field>
            <Field label={t('DP minimal (% dari total)')} hint={t('Untuk isian {dp_minimal} di pesan konfirmasi.')}>
              <NumberInput value={draft.settings.minDpPercent} onCommit={(minDpPercent) => setSettings({ minDpPercent })} max={100} unit="%" />
            </Field>
          </div>
          <Field label={t('Kontak studio (di bawah nama studio pada invoice)')}>
            <TextArea value={draft.settings.studioContact} onCommit={(studioContact) => setSettings({ studioContact })} rows={3} placeholder={t('Alamat\n0812-xxxx-xxxx · @namastudio')} />
          </Field>
          <Field label={t('Rekening pembayaran')} hint={t('Muncul di invoice dan pesan WhatsApp ({rekening}).')}>
            <TextArea value={draft.settings.paymentInfo} onCommit={(paymentInfo) => setSettings({ paymentInfo })} rows={3} placeholder={t('BCA 1234567890 a.n. Nama Studio')} />
          </Field>
          <Field label={t('Syarat & ketentuan')}>
            <TextArea value={draft.settings.terms} onCommit={(terms) => setSettings({ terms })} rows={4} />
          </Field>
        </section>
        <section className="flex flex-col gap-3">
          <SectionTitle>{t('Pengingat')}</SectionTitle>
          <p className="-mt-1 text-xs text-faint">{t('Muncul di lonceng Kelola Bisnis dan sebagai notifikasi sistem, selama aplikasi terbuka. Saat aplikasi ditutup tidak ada pengingat: tambahkan jadwal ke Google Calendar agar diingatkan di HP.')}</p>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-panel px-3 py-2.5 text-[13px]">
            {t('Jadwal foto hari ini dan besok')}
            <Switch label={t('Jadwal foto hari ini dan besok')} checked={draft.settings.remindShoot} onChange={(remindShoot) => setSettings({ remindShoot })} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-panel px-3 py-2.5 text-[13px]">
            {t('Hasil yang harus dikirim (2 hari sebelum tenggat)')}
            <Switch label={t('Hasil yang harus dikirim')} checked={draft.settings.remindDelivery} onChange={(remindDelivery) => setSettings({ remindDelivery })} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-panel px-3 py-2.5 text-[13px]">
            {t('Pelunasan, mulai berapa hari sebelum jatuh tempo')}
            <NumberInput value={draft.settings.remindDueDays} onCommit={(remindDueDays) => setSettings({ remindDueDays })} max={60} unit={t('hari')} className="w-28" />
          </div>
        </section>
        <BackupSection />
        {sections}
        {dirty && <SaveBar onSave={saveDraft} onCancel={cancel} />}
      </div>
    </div>
  );
}

/** Backup: the data lives here only — a file now and then, or a cloud-synced folder that gets a copy on every change. */
function BackupSection() {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const [restoring, setRestoring] = useState<{ path: string; data: BisnisData } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const last = lastBackupAt(data);
  const pickFolder = async () => {
    const dir = await open({ directory: true, title: t('Folder backup Kelola Bisnis') });
    if (typeof dir === 'string') update((d) => ({ ...d, settings: { ...d.settings, backupDir: dir } }));
  };
  const exportNow = async () => {
    const path = await save({ title: t('Simpan backup'), defaultPath: backupName(), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!path) return;
    try {
      await exportBackup(path);
      setDone(t('Backup tersimpan.'));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };
  const pickRestore = async () => {
    const path = await open({ title: t('Pilih file backup'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (typeof path !== 'string') return;
    try {
      setRestoring({ path, data: await readBackup(path) });
      setError(null);
    } catch (e) {
      setError(t('File ini bukan backup Kelola Bisnis yang bisa dibaca: {e}', { e: String(e) }));
    }
  };
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle>{t('Backup data')}</SectionTitle>
      <p className="-mt-1 flex items-start gap-2 rounded-xl border border-maybe/50 bg-maybe/[0.06] px-3 py-2.5 text-xs text-muted">
        <ShieldAlert size={15} className="mt-px shrink-0 text-maybe" />
        {t('Semua data Kelola Bisnis hanya tersimpan di komputer ini, tidak di server mana pun. Kalau komputer rusak, hilang, atau aplikasi dihapus, datanya ikut hilang. Menjaga backup adalah tanggung jawab kamu.')}
      </p>
      <div className="flex flex-col gap-2 rounded-xl bg-panel p-3">
        <span className="text-[13px] font-medium">{t('Backup otomatis ke folder')}</span>
        <span className="text-[11px] text-faint">{t('Pilih folder yang disinkronkan ke cloud (iCloud Drive, Google Drive, Dropbox) supaya datanya ikut tersimpan di sana. Disalin setiap ada perubahan, plus satu salinan per hari.')}</span>
        <div className="flex items-center gap-2">
          <span className={cx('min-w-0 flex-1 truncate rounded-lg bg-bg px-2.5 py-2 text-xs', data.settings.backupDir ? 'text-fg' : 'text-faint')}>{data.settings.backupDir ?? t('Belum dipilih')}</span>
          <button type="button" onClick={pickFolder} className={cx(btnGhost, 'h-8 px-3 text-xs')}>
            <FolderSync size={13} /> {data.settings.backupDir ? t('Ganti') : t('Pilih folder')}
          </button>
          {data.settings.backupDir && (
            <button type="button" onClick={() => update((d) => ({ ...d, settings: { ...d.settings, backupDir: null } }))} className="h-8 px-2 text-xs text-faint hover:text-reject">
              {t('Matikan')}
            </button>
          )}
        </div>
        {autoBackupError() && <span className="text-[11px] text-reject">{t('Backup otomatis terakhir gagal: {e}', { e: autoBackupError()! })}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={exportNow} className={btnGhost}>
          <Download size={14} /> {t('Ekspor backup…')}
        </button>
        <button type="button" onClick={pickRestore} className={btnGhost}>
          <Upload size={14} /> {t('Pulihkan dari backup…')}
        </button>
        <span className="text-[11px] text-faint">{last ? t('Backup terakhir: {when}', { when: new Date(last).toLocaleString() }) : t('Belum pernah backup.')}</span>
      </div>
      {done && <span className="text-xs text-pick">{done}</span>}
      {error && <span className="text-xs text-reject">{error}</span>}
      {restoring && (
        <div className="flex flex-col gap-2 rounded-xl border border-reject/60 bg-reject/[0.06] p-3">
          <span className="text-[13px] font-semibold">{t('Ganti semua data dengan backup ini?')}</span>
          <span className="text-xs text-muted">
            {t('Backup berisi {b} booking dan {c} klien. Data yang ada sekarang ({nb} booking) akan diganti.', { b: restoring.data.bookings.length, c: restoring.data.clients.length, nb: data.bookings.length })}
          </span>
          <span className="flex justify-end gap-2">
            <button type="button" onClick={() => setRestoring(null)} className="h-8 px-3 text-xs text-muted hover:text-fg">
              {t('Batal')}
            </button>
            <button type="button" onClick={() => (applyBackup(restoring.data), setRestoring(null), setDone(t('Data dipulihkan dari backup.')))} className="h-8 rounded-lg bg-reject px-3 text-xs font-semibold text-bg">
              {t('Ganti data')}
            </button>
          </span>
        </div>
      )}
    </section>
  );
}
