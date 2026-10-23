import {
  ArrowLeft,
  Check as CheckIcon,
  Copy,
  EyeOff,
  Flower2,
  Folder,
  FolderOpen,
  FolderTree,
  Gem,
  GraduationCap,
  Heart,
  House,
  Ellipsis,
  Focus,
  ShieldCheck,
  Smile,
  Sparkles,
  SunMedium,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';

import { TitleBar, isMac } from '../components/title-bar';
import { Button, Chip, IconTile, Segmented, Switch, cx } from '../components/ui';
import type { FolderInfo, FolderSummary, Options, Strictness } from '../lib/api';
import { defaultFolders } from '../lib/folders';
import { bytes, num } from '../lib/format';
import { useApp } from '../store';

const SHOOT_TYPES: { id: string; icon: LucideIcon; label: string; sub: string }[] = [
  { id: 'wedding', icon: Heart, label: 'Wedding', sub: 'Akad, resepsi, keluarga' },
  { id: 'prewedding', icon: Flower2, label: 'Prewedding', sub: 'Pasangan, outdoor' },
  { id: 'lamaran', icon: Gem, label: 'Lamaran', sub: 'Engagement, siraman' },
  { id: 'wisuda', icon: GraduationCap, label: 'Wisuda', sub: 'Keluarga, toga' },
  { id: 'event', icon: Users, label: 'Event', sub: 'Seminar, ulang tahun' },
  { id: 'keluarga', icon: House, label: 'Keluarga', sub: 'Foto keluarga, maternity' },
  { id: 'portrait', icon: User, label: 'Portrait', sub: 'Personal, profil, model' },
  { id: 'lainnya', icon: Ellipsis, label: 'Lainnya', sub: 'Produk, makanan, dll.' },
];

const STRICTNESS_HINT: Record<Strictness, string> = {
  loose: 'Longgar: hanya yang jelas blur dibuang. Duplikat tetap di Maybe.',
  balanced: 'Seimbang: foto yang ragu-ragu masuk Maybe, bukan langsung dibuang.',
  strict: 'Ketat: standar ketajaman lebih tinggi, Picks lebih sedikit.',
};

export function Setup({ folder }: { folder: FolderInfo }) {
  const go = useApp((s) => s.go);
  const analyze = useApp((s) => s.analyze);
  // Shoot type is chosen here already so the UI matches the design, but the
  // checks that would use it (faces, eyes) aren't built yet.
  const [shootType, setShootType] = useState('auto');
  const [options, setOptions] = useState<Options>({
    strictness: 'balanced',
    checkBlur: true,
    checkExposure: true,
    checkDuplicates: true,
    checkEyes: true,
    checkSmile: true,
  });
  const set = (patch: Partial<Options>) => setOptions((o) => ({ ...o, ...patch }));
  const [chosen, setChosen] = useState<string[]>(() => defaultFolders(folder.folders));
  const toggle = (name: string) =>
    setChosen((c) => (c.includes(name) ? c.filter((n) => n !== name) : [...c, name]));
  const selected = folder.folders.filter((f) => chosen.includes(f.name));
  const photos = selected.reduce((n, f) => n + f.photos, 0);
  const size = selected.reduce((n, f) => n + f.bytes, 0);
  const byFormat: Record<string, number> = {};
  for (const f of selected) for (const [ext, n] of Object.entries(f.formats)) byFormat[ext] = (byFormat[ext] ?? 0) + n;
  const formats = Object.entries(byFormat)
    .map(([ext, n]) => `${num(n)} ${ext}`)
    .join(' · ');
  const nothingToCheck = !options.checkBlur && !options.checkExposure && !options.checkDuplicates && !options.checkEyes && !options.checkSmile;

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <main className="flex flex-1 flex-col items-center gap-6 overflow-y-auto px-6 pt-8 pb-10 xl:flex-row xl:items-start xl:justify-center xl:gap-8 xl:px-10 xl:pt-12">
        <div className="flex w-full max-w-[744px] flex-col gap-6">
          <button type="button" onClick={() => go({ name: 'home' })} className="flex items-center gap-2 self-start text-muted hover:text-fg">
            <ArrowLeft size={16} /> Kembali
          </button>

          <div className="flex items-center gap-3.5 rounded-2xl border border-line-soft bg-panel p-4">
            <IconTile icon={Folder} size={44} color="var(--color-gold-text)" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-base font-semibold">{folder.name}</span>
              <span className="truncate text-xs text-faint">{folder.root}</span>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[13px] font-medium">
                {num(photos)} foto · {bytes(size)}
              </span>
              <span className="text-[11px] text-faint">{formats || 'Belum ada folder dipilih'}</span>
            </div>
          </div>

          {folder.folders.length > 1 && (
            <section className="flex flex-col gap-2.5">
              <div className="flex items-end justify-between">
                <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                  <FolderTree size={16} className="text-muted" /> Isi folder
                </h2>
                <span className="text-xs text-faint">Centang yang mau dipilah</span>
              </div>
              <div className="flex flex-col overflow-hidden rounded-xl border border-line-soft bg-panel">
                {/* The chosen folder itself, then its subfolders as a tree under it. */}
                {(() => {
                  const root = folder.folders.find((f) => f.name === '');
                  return root ? (
                    <FolderRow
                      name={folder.name}
                      summary={root}
                      on={chosen.includes('')}
                      onToggle={() => toggle('')}
                      badge={<Chip color="var(--color-gold-text)">Folder utama</Chip>}
                    />
                  ) : (
                    <div className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5">
                      <span className="size-4 shrink-0" />
                      <FolderOpen size={15} className="text-gold-text" />
                      <span className="truncate text-[13px] font-medium">{folder.name}</span>
                      <span className="text-xs text-faint">tidak ada foto langsung di sini</span>
                    </div>
                  );
                })()}
                {folder.folders
                  .filter((f) => f.name !== '')
                  .map((f, i, subs) => (
                    <FolderRow
                      key={f.name}
                      name={f.name}
                      summary={f}
                      sub={i === subs.length - 1 ? 'last' : 'middle'}
                      on={chosen.includes(f.name)}
                      onToggle={() => toggle(f.name)}
                      badge={null}
                    />
                  ))}
              </div>
              <p className="text-xs text-faint">
                Subfolder di dalamnya ikut terbaca. Folder yang tidak dicentang tidak dipilah dan tidak diubah.
              </p>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-[15px] font-semibold">Jenis pemotretan</h2>
            <button
              type="button"
              onClick={() => setShootType('auto')}
              className={cx(
                'flex items-center gap-3.5 rounded-xl border p-3.5 text-left',
                shootType === 'auto' ? 'border-2 border-gold bg-gold/10' : 'border-line-soft bg-panel hover:border-line',
              )}
            >
              <IconTile icon={Sparkles} size={40} color="var(--color-gold-text)" className="bg-gold/20" />
              <span className="flex flex-1 flex-col gap-1">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  Otomatis <Chip color="var(--color-gold-text)">Disarankan</Chip>
                </span>
                <span className="text-xs text-muted">AI mengenali jenis sesi dari isi foto.</span>
              </span>
              <Radio on={shootType === 'auto'} />
            </button>
            <p className="text-xs text-faint">Atau pilih sendiri supaya lebih tepat:</p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {SHOOT_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setShootType(t.id)}
                  className={cx(
                    'flex flex-col gap-2 rounded-xl border p-3.5 text-left',
                    shootType === t.id ? 'border-2 border-gold bg-gold/10' : 'border-line-soft bg-panel hover:border-line',
                  )}
                >
                  <t.icon size={20} className={shootType === t.id ? 'text-gold-text' : 'text-muted'} />
                  <span className="text-sm font-semibold">{t.label}</span>
                  <span className="text-[11px] text-faint">{t.sub}</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-faint">
              Jenis pemotretan mengatur apa yang dianggap penting. Contoh Wedding: wajah mempelai harus tajam, tamu yang
              berkedip di latar diabaikan. Produk: cek wajah dimatikan.
            </p>
          </section>

          <section className="flex flex-col gap-2.5">
            <h2 className="text-[15px] font-semibold">Ketat seleksi</h2>
            <Segmented<Strictness>
              value={options.strictness}
              onChange={(strictness) => set({ strictness })}
              options={[
                { value: 'loose', label: 'Longgar' },
                { value: 'balanced', label: 'Seimbang' },
                { value: 'strict', label: 'Ketat' },
              ]}
            />
            <p className="text-xs text-faint">{STRICTNESS_HINT[options.strictness]}</p>
          </section>
        </div>

        <aside className="flex w-full max-w-[744px] shrink-0 flex-col gap-4 xl:w-[380px] xl:pt-[46px]">
          <div className="flex flex-col rounded-2xl border border-line-soft bg-panel p-5">
            <h2 className="mb-1 text-[15px] font-semibold">Yang dicek AI</h2>
            <Check icon={Focus} label="Blur / tidak fokus" sub="Diukur di bagian paling tajam, bukan latar bokeh" on={options.checkBlur} onChange={(checkBlur) => set({ checkBlur })} />
            <Check icon={EyeOff} label="Mata terpejam" sub="Ditandai Maybe untuk dicek; Reject hanya di mode Ketat" on={options.checkEyes} onChange={(checkEyes) => set({ checkEyes })} />
            <Check icon={Copy} label="Duplikat & burst" sub="Simpan yang terbaik per grup" on={options.checkDuplicates} onChange={(checkDuplicates) => set({ checkDuplicates })} />
            <Check icon={SunMedium} label="Eksposur" sub="Terlalu gelap atau terlalu terang" on={options.checkExposure} onChange={(checkExposure) => set({ checkExposure })} />
            <Check icon={Smile} label="Ekspresi" sub="Di grup burst, yang tersenyum diutamakan · tidak pernah membuang foto" on={options.checkSmile} onChange={(checkSmile) => set({ checkSmile })} />
          </div>
          <div className="flex items-start gap-2.5 rounded-xl bg-pick/10 p-3.5">
            <ShieldCheck size={18} className="shrink-0 text-pick" />
            <p className="text-xs text-muted">
              Diproses offline di {isMac ? 'Mac' : 'komputer'} ini. Foto tidak di-upload dan file asli tidak diubah.
            </p>
          </div>
          <Button
            variant="primary"
            size="lg"
            icon={Sparkles}
            disabled={nothingToCheck || photos === 0}
            onClick={() => analyze(folder, chosen, options)}
          >
            Mulai pilih otomatis
          </Button>
          {folder.folders.length === 0 ? (
            <p className="text-xs text-reject">Folder ini tidak berisi foto RAW atau JPEG.</p>
          ) : (
            photos === 0 && <p className="text-xs text-maybe">Centang minimal satu folder.</p>
          )}
          {nothingToCheck && <p className="text-xs text-maybe">Nyalakan minimal satu pengecekan.</p>}
        </aside>
      </main>
    </div>
  );
}

/** One line of the folder tree; subfolders hang off the main folder by a connector. */
function FolderRow({
  name,
  summary: f,
  on,
  onToggle,
  badge,
  sub,
}: {
  name: string;
  summary: FolderSummary;
  on: boolean;
  onToggle: () => void;
  badge: React.ReactNode;
  sub?: 'middle' | 'last';
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onToggle}
      className="relative flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 text-left last:border-0 hover:bg-panel-2"
    >
      {sub && (
        // Tree connector from the main folder's icon down to this row.
        <span aria-hidden className="absolute top-0 left-[45px] w-3">
          <span className={cx('absolute left-0 w-px bg-line', sub === 'last' ? 'top-0 h-[21px]' : 'top-0 h-[45px]')} />
          <span className="absolute top-[21px] left-0 h-px w-3 bg-line" />
        </span>
      )}
      <span
        className={cx('flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-gold bg-gold' : 'border-faint')}
      >
        {on && <CheckIcon size={11} strokeWidth={3} className="text-bg" />}
      </span>
      {sub && <span className="w-4 shrink-0" />}
      {sub ? <Folder size={15} className="shrink-0 text-muted" /> : <FolderOpen size={15} className="shrink-0 text-gold-text" />}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cx('truncate text-[13px]', on ? 'font-medium text-fg' : 'text-muted')}>{name}</span>
        {sub && <Chip color="var(--color-muted)">Subfolder</Chip>}
        {badge}
      </span>
      <span className="shrink-0 text-xs text-faint">
        {num(f.photos)} foto · {Object.keys(f.formats).join(', ')} · {bytes(f.bytes)}
      </span>
    </button>
  );
}

function Radio({ on }: { on: boolean }) {
  return <span className={cx('size-[18px] shrink-0 rounded-full border-[1.5px]', on ? 'border-gold bg-gold' : 'border-faint')} />;
}

function Check({
  icon,
  label,
  sub,
  on,
  onChange,
  soon,
}: {
  icon: LucideIcon;
  label: string;
  sub: string;
  on: boolean;
  onChange?: (v: boolean) => void;
  soon?: boolean;
}) {
  return (
    <div className={cx('flex items-center gap-3 py-3', soon && 'opacity-60')}>
      <IconTile icon={icon} />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-[13px] font-medium">
          {label} {soon && <Chip color="var(--color-faint)">Segera</Chip>}
        </span>
        <span className="text-[11px] text-faint">{sub}</span>
      </div>
      <Switch label={label} checked={on} disabled={soon} onChange={(v) => onChange?.(v)} />
    </div>
  );
}
