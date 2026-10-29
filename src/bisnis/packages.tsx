/**
 * Paket: what the studio sells — packages (name, price, how long, what is in
 * it) and the extras on top. Edited where they stand; the pricelist and new
 * bookings read them, bookings already made keep the price they were given.
 */

import { Archive, ArchiveRestore, Package as PackageIcon, Plus, Trash2 } from 'lucide-react';

import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { newId } from './model';
import { useBisnis } from './store';
import type { Addon, Package } from './types';
import { Empty, Field, LazyInput, MoneyInput, SectionTitle, btnGhost, btnPrimary, inputCls } from './ui';

export function Packages({ extra }: { extra?: React.ReactNode }) {
  const data = useBisnis((s) => s.data)!;
  const update = useBisnis((s) => s.update);
  const setPkg = (id: string, patch: Partial<Package>) => update((d) => ({ ...d, packages: d.packages.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const setAddon = (id: string, patch: Partial<Addon>) => update((d) => ({ ...d, addons: d.addons.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const addPkg = () => update((d) => ({ ...d, packages: [...d.packages, { id: newId(), name: t('Paket baru'), price: 0, description: '', durationMin: 120 }] }));
  const used = (id: string) => data.bookings.some((b) => b.packageId === id);
  const active = data.packages.filter((p) => !p.archived);
  const archived = data.packages.filter((p) => p.archived);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pt-4 pb-10 lg:px-8">
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
        {extra}
        <section className="flex flex-col gap-3">
          <SectionTitle
            action={
              <button type="button" onClick={addPkg} className={cx(btnPrimary, 'h-8 px-3 text-xs')}>
                <Plus size={14} /> {t('Tambah paket')}
              </button>
            }
          >
            {t('Paket')}
          </SectionTitle>
          {data.packages.length === 0 && (
            <Empty
              icon={<PackageIcon size={22} />}
              title={t('Belum ada paket')}
              text={t('Masukkan paket yang kamu jual: nama, harga, dan isinya. Dipakai di booking baru dan pricelist yang dikirim ke calon klien.')}
            />
          )}
          {[...active, ...archived].map((p) => (
            <div key={p.id} className={cx('flex flex-col gap-3 rounded-2xl border border-line-soft bg-panel p-4', p.archived && 'opacity-60')}>
              <div className="grid grid-cols-[1fr_180px_120px_auto] items-end gap-3">
                <Field label={t('Nama paket')}>
                  <LazyInput value={p.name} onCommit={(name) => setPkg(p.id, { name })} />
                </Field>
                <Field label={t('Harga')}>
                  <MoneyInput value={p.price} onChange={(price) => setPkg(p.id, { price })} />
                </Field>
                <Field label={t('Durasi (jam)')}>
                  <input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={p.durationMin / 60}
                    onChange={(e) => setPkg(p.id, { durationMin: Math.max(30, Math.round(Number(e.target.value) * 60)) })}
                    className={inputCls}
                  />
                </Field>
                <span className="mb-1 flex gap-1">
                  <button
                    type="button"
                    onClick={() => setPkg(p.id, { archived: !p.archived })}
                    title={p.archived ? t('Tampilkan lagi') : t('Arsipkan: disembunyikan dari pricelist dan booking baru')}
                    className="rounded-lg p-2 text-faint hover:bg-raised hover:text-fg"
                  >
                    {p.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                  </button>
                  {!used(p.id) && (
                    <button type="button" onClick={() => update((d) => ({ ...d, packages: d.packages.filter((x) => x.id !== p.id) }))} title={t('Hapus paket')} className="rounded-lg p-2 text-faint hover:bg-raised hover:text-reject">
                      <Trash2 size={15} />
                    </button>
                  )}
                </span>
              </div>
              <Field label={t('Isi paket (satu per baris)')}>
                <textarea
                  defaultValue={p.description}
                  onBlur={(e) => e.target.value !== p.description && setPkg(p.id, { description: e.target.value })}
                  rows={3}
                  placeholder={t('2 jam pemotretan\n50 foto edit\nSemua file mentah')}
                  className={cx(inputCls, 'h-auto resize-y py-2')}
                />
              </Field>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-3">
          <SectionTitle
            action={
              <button type="button" onClick={() => update((d) => ({ ...d, addons: [...d.addons, { id: newId(), name: '', price: 0 }] }))} className={cx(btnGhost, 'h-8 px-3 text-xs')}>
                <Plus size={14} /> {t('Tambah add-on')}
              </button>
            }
          >
            {t('Add-on')}
          </SectionTitle>
          <p className="-mt-1 text-xs text-faint">{t('Tambahan di luar paket, tinggal diklik saat membuat booking: fotografer kedua, album cetak, tambahan jam.')}</p>
          {data.addons.map((a) => (
            <div key={a.id} className="grid grid-cols-[1fr_180px_auto] items-center gap-3">
              <LazyInput value={a.name} onCommit={(name) => setAddon(a.id, { name })} placeholder={t('mis. Album 20 halaman')} />
              <MoneyInput value={a.price} onChange={(price) => setAddon(a.id, { price })} />
              <button type="button" onClick={() => update((d) => ({ ...d, addons: d.addons.filter((x) => x.id !== a.id) }))} title={t('Hapus add-on')} className="rounded-lg p-2 text-faint hover:text-reject">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
