/**
 * Paket: what the studio sells — packages and the extras on top — shown as
 * they read to a client; added and changed in a form that is saved (or
 * cancelled) as a whole. The pricelist and new bookings read them; bookings
 * already made keep the price they were given.
 */

import { Archive, ArchiveRestore, Clock, Package as PackageIcon, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { newId, rupiah } from './model';
import { useBisnis } from './store';
import type { Addon, Package } from './types';
import { Dialog, Empty, Field, MinutesInput, MoneyInput, SectionTitle, btnGhost, btnPlain, btnPrimary, inputCls } from './ui';

const duration = (min: number) => (min % 60 === 0 ? t('{n} jam', { n: min / 60 }) : min > 60 ? t('{h} jam {m} menit', { h: Math.floor(min / 60), m: min % 60 }) : t('{n} menit', { n: min }));

const blank = (): Package => ({ id: '', name: '', price: 0, description: '', durationMin: 120 });

export function Packages({ startAdding, onStarted }: { startAdding?: boolean; onStarted?: () => void }) {
  const data = useBisnis((s) => s.data)!;
  const [editing, setEditing] = useState<Package | null>(() => (startAdding ? blank() : null));
  useEffect(() => {
    if (startAdding) onStarted?.();
  }, []);
  const [addon, setAddon] = useState<Addon | null>(null);
  const active = data.packages.filter((p) => !p.archived);
  const archived = data.packages.filter((p) => p.archived);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pt-4 pb-10 lg:px-8">
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-8">
        <section className="flex flex-col gap-3">
          <SectionTitle
            action={
              data.packages.length > 0 && (
                <button type="button" onClick={() => setEditing(blank())} className={cx(btnPrimary, 'h-8 px-3 text-xs')}>
                  <Plus size={14} /> {t('Tambah paket')}
                </button>
              )
            }
          >
            {t('Paket')}
          </SectionTitle>
          {data.packages.length === 0 && (
            <Empty
              icon={<PackageIcon size={22} />}
              title={t('Belum ada paket')}
              text={t('Masukkan paket yang kamu jual: nama, harga, dan isinya. Dipakai di booking baru dan pricelist yang dikirim ke calon klien.')}
              action={
                <button type="button" onClick={() => setEditing(blank())} className={btnPrimary}>
                  <Plus size={15} /> {t('Tambah paket')}
                </button>
              }
            />
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {active.map((p) => (
              <PackageCard key={p.id} pkg={p} onEdit={() => setEditing(p)} />
            ))}
          </div>
          {archived.length > 0 && (
            <>
              <span className="mt-2 text-[11px] font-medium text-faint">{t('Diarsipkan: tidak muncul di pricelist dan booking baru')}</span>
              <div className="grid grid-cols-1 gap-3 opacity-60 md:grid-cols-2">
                {archived.map((p) => (
                  <PackageCard key={p.id} pkg={p} onEdit={() => setEditing(p)} />
                ))}
              </div>
            </>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle
            action={
              <button type="button" onClick={() => setAddon({ id: '', name: '', price: 0 })} className={cx(btnGhost, 'h-8 px-3 text-xs')}>
                <Plus size={14} /> {t('Tambah add-on')}
              </button>
            }
          >
            {t('Add-on')}
          </SectionTitle>
          <p className="-mt-1 text-xs text-faint">{t('Tambahan di luar paket, tinggal diklik saat membuat booking: fotografer kedua, album cetak, tambahan jam.')}</p>
          {data.addons.length > 0 && (
            <div className="flex flex-col overflow-hidden rounded-2xl border border-line-soft">
              {data.addons.map((a) => (
                <button key={a.id} type="button" onClick={() => setAddon(a)} className="group flex items-center gap-3 border-b border-line-soft bg-panel px-4 py-3 text-left last:border-0 hover:bg-panel-2">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.name || t('Tanpa nama')}</span>
                  <span className="text-[13px] tabular-nums">{rupiah(a.price)}</span>
                  <Pencil size={13} className="text-faint opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      {editing && <PackageForm initial={editing} onClose={() => setEditing(null)} />}
      {addon && <AddonForm initial={addon} onClose={() => setAddon(null)} />}
    </div>
  );
}

/** A package as a client reads it. */
function PackageCard({ pkg: p, onEdit }: { pkg: Package; onEdit: () => void }) {
  const data = useBisnis((s) => s.data)!;
  const used = data.bookings.filter((b) => b.packageId === p.id).length;
  const items = p.description.split('\n').map((l) => l.trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line-soft bg-panel p-4">
      <div className="flex items-start gap-3">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[15px] font-semibold">{p.name}</span>
          <span className="text-lg font-semibold text-gold-text tabular-nums">{rupiah(p.price)}</span>
        </span>
        <button type="button" onClick={onEdit} className={cx(btnGhost, 'h-8 px-3 text-xs')}>
          <Pencil size={13} /> {t('Edit')}
        </button>
      </div>
      {items.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-muted">
          {items.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-gold-text">•</span> {l}
            </li>
          ))}
        </ul>
      )}
      <span className="mt-auto flex items-center gap-3 text-[11px] text-faint">
        <span className="flex items-center gap-1">
          <Clock size={11} /> {duration(p.durationMin)}
        </span>
        {used > 0 && <span>{t('Dipakai di {n} booking', { n: used })}</span>}
      </span>
    </div>
  );
}

/** A package added or changed: nothing is kept until Simpan. */
function PackageForm({ initial, onClose }: { initial: Package; onClose: () => void }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const isNew = !initial.id;
  const [p, setP] = useState(initial);
  const used = !isNew && data.bookings.some((b) => b.packageId === initial.id);
  const save = () => {
    const saved = { ...p, name: p.name.trim(), id: p.id || newId() };
    update((d) => ({ ...d, packages: isNew ? [...d.packages, saved] : d.packages.map((x) => (x.id === saved.id ? saved : x)) }));
    onClose();
  };
  const setArchived = (archived: boolean) => {
    update((d) => ({ ...d, packages: d.packages.map((x) => (x.id === initial.id ? { ...x, archived } : x)) }));
    onClose();
  };
  return (
    <Dialog
      title={isNew ? t('Paket baru') : t('Edit paket')}
      onClose={onClose}
      width={540}
      footer={
        <>
          {!isNew &&
            (used ? (
              <button type="button" onClick={() => setArchived(!initial.archived)} title={t('Paket yang sudah dipakai booking diarsipkan, tidak dihapus')} className={cx(btnPlain, 'mr-auto')}>
                {initial.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />} {initial.archived ? t('Tampilkan lagi') : t('Arsipkan')}
              </button>
            ) : (
              <button type="button" onClick={() => (update((d) => ({ ...d, packages: d.packages.filter((x) => x.id !== initial.id) })), onClose())} className={cx(btnPlain, 'mr-auto hover:text-reject')}>
                <Trash2 size={14} /> {t('Hapus paket')}
              </button>
            ))}
          <button type="button" onClick={onClose} className={btnPlain}>
            {t('Batal')}
          </button>
          <button type="button" onClick={save} disabled={!p.name.trim()} className={btnPrimary}>
            {t('Simpan')}
          </button>
        </>
      }
    >
      <Field label={t('Nama paket')}>
        <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder={t('mis. Wedding Gold')} autoFocus className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('Harga')}>
          <MoneyInput value={p.price} onChange={(price) => setP({ ...p, price })} />
        </Field>
        <Field label={t('Durasi pemotretan')} hint={t('Untuk jam selesai jadwal baru.')}>
          <MinutesInput value={p.durationMin} onCommit={(durationMin) => setP({ ...p, durationMin })} />
        </Field>
      </div>
      <Field label={t('Isi paket (satu per baris)')} hint={t('Muncul di pricelist dan invoice.')}>
        <textarea value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} rows={6} placeholder={t('2 jam pemotretan\n50 foto edit\nSemua file mentah')} className={cx(inputCls, 'h-auto resize-y py-2 leading-relaxed')} />
      </Field>
      {used && <p className="text-[11px] text-faint">{t('Mengubah harga tidak mengubah booking yang sudah dibuat dengan paket ini.')}</p>}
    </Dialog>
  );
}

function AddonForm({ initial, onClose }: { initial: Addon; onClose: () => void }) {
  const update = useBisnis((s) => s.update);
  const isNew = !initial.id;
  const [a, setA] = useState(initial);
  const save = () => {
    const saved = { ...a, name: a.name.trim(), id: a.id || newId() };
    update((d) => ({ ...d, addons: isNew ? [...d.addons, saved] : d.addons.map((x) => (x.id === saved.id ? saved : x)) }));
    onClose();
  };
  return (
    <Dialog
      title={isNew ? t('Add-on baru') : t('Edit add-on')}
      onClose={onClose}
      width={460}
      footer={
        <>
          {!isNew && (
            <button type="button" onClick={() => (update((d) => ({ ...d, addons: d.addons.filter((x) => x.id !== initial.id) })), onClose())} className={cx(btnPlain, 'mr-auto hover:text-reject')}>
              <Trash2 size={14} /> {t('Hapus add-on')}
            </button>
          )}
          <button type="button" onClick={onClose} className={btnPlain}>
            {t('Batal')}
          </button>
          <button type="button" onClick={save} disabled={!a.name.trim()} className={btnPrimary}>
            {t('Simpan')}
          </button>
        </>
      }
    >
      <Field label={t('Nama add-on')}>
        <input value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} placeholder={t('mis. Album 20 halaman')} autoFocus className={inputCls} />
      </Field>
      <Field label={t('Harga')}>
        <MoneyInput value={a.price} onChange={(price) => setA({ ...a, price })} />
      </Field>
    </Dialog>
  );
}
