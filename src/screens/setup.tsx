import {
  ArrowLeft,
  Check as CheckIcon,
  Copy,
  EyeOff,
  Folder,
  FolderOpen,
  FolderTree,
  Minus,
  Focus,
  ShieldCheck,
  Smile,
  Sparkles,
  SunMedium,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { TitleBar, isMac } from '../components/title-bar';
import { Button, Chip, IconTile, Segmented, Switch, cx } from '../components/ui';
import type { FolderInfo, FolderSummary, Options, Strictness } from '../lib/api';
import { checkState, defaultFolders, folderTree, toggleAll, type FolderNode } from '../lib/folders';
import { bytes, num } from '../lib/format';
import { t } from '../lib/i18n';
import { GENERAL, SHOOT_TYPES, shootRule, useDefaults, withShootType } from '../lib/shoot';
import { useApp } from '../store';

const STRICTNESS_HINT: Record<Strictness, string> = {
  loose: 'Longgar: hanya yang jelas blur dibuang. Duplikat tetap di Cek.',
  balanced: 'Seimbang: foto yang ragu-ragu masuk Cek, bukan langsung dilewati.',
  strict: 'Ketat: standar ketajaman lebih tinggi, foto yang dipilih lebih sedikit.',
};

/** What a strictness level does, in the current language. */
export const strictnessHint = (s: Strictness) => t(STRICTNESS_HINT[s]);

export function Setup({ folder }: { folder: FolderInfo }) {
  const go = useApp((s) => s.go);
  const analyze = useApp((s) => s.analyze);
  // Starts from Pengaturan › Analisis; changes here are for this folder only.
  const [options, setOptions] = useState<Options>(() => useDefaults.getState().options);
  const set = (patch: Partial<Options>) => setOptions((o) => ({ ...o, ...patch }));
  const shootType = options.shootType;
  const setShootType = (type: Options['shootType']) => setOptions((o) => withShootType(o, type));
  const [chosen, setChosen] = useState<string[]>(() => defaultFolders(folder.folders));
  const toggle = (paths: string[]) => setChosen((c) => toggleAll(paths, c));
  const tree = useMemo(() => folderTree(folder.folders), [folder.folders]);
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
            <ArrowLeft size={16} /> {t('Kembali')}
          </button>

          <div className="flex items-center gap-3.5 rounded-2xl border border-line-soft bg-panel p-4">
            <IconTile icon={Folder} size={44} color="var(--color-gold-text)" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate text-base font-semibold">{folder.name}</span>
              <span className="truncate text-xs text-faint">{folder.root}</span>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[13px] font-medium">
                {t('{count} foto', { n: photos, count: num(photos) })} · {bytes(size)}
              </span>
              <span className="text-[11px] text-faint">{formats || t('Belum ada folder dipilih')}</span>
            </div>
          </div>

          {folder.folders.length > 1 && (
            <section className="flex flex-col gap-2.5">
              <div className="flex items-end justify-between">
                <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                  <FolderTree size={16} className="text-muted" /> {t('Isi folder')}
                </h2>
                <span className="text-xs text-faint">{t('Centang yang mau dipilah')}</span>
              </div>
              <div className="flex flex-col overflow-hidden rounded-xl border border-line-soft bg-panel">
                {/* The chosen folder itself, then its subfolders as a tree under it. */}
                {(() => {
                  const root = folder.folders.find((f) => f.name === '');
                  return root ? (
                    <FolderRow
                      name={folder.name}
                      summary={root}
                      state={chosen.includes('') ? 'on' : 'off'}
                      onToggle={() => toggle([''])}
                      badge={<Chip color="var(--color-gold-text)">{t('Folder utama')}</Chip>}
                    />
                  ) : (
                    <div className="flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5">
                      <span className="size-4 shrink-0" />
                      <FolderOpen size={15} className="text-gold-text" />
                      <span className="truncate text-[13px] font-medium">{folder.name}</span>
                      <span className="text-xs text-faint">{t('tidak ada foto langsung di sini')}</span>
                    </div>
                  );
                })()}
                {tree.map((node) => (
                  <FolderRow
                    key={node.path}
                    name={node.name}
                    node={node}
                    state={checkState(node.paths, chosen)}
                    onToggle={() => toggle(node.paths)}
                    badge={null}
                  />
                ))}
              </div>
              <p className="text-xs text-faint">
                {t('Tiap folder dipilih sendiri, termasuk folder di dalam subfolder. Folder yang tidak dicentang tidak dipilah dan tidak diubah.')}
              </p>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-[15px] font-semibold">{t('Jenis pemotretan')}</h2>
            <button
              type="button"
              onClick={() => setShootType('auto')}
              className={cx(
                'flex items-center gap-3.5 rounded-xl border p-3.5 text-left',
                shootType === 'auto' ? 'border-2 border-gold bg-gold/10' : 'border-line-soft bg-panel hover:border-line',
              )}
            >
              <IconTile icon={GENERAL.icon} size={40} color="var(--color-gold-text)" className="bg-gold/20" />
              <span className="flex flex-1 flex-col gap-1">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {GENERAL.label} <Chip color="var(--color-gold-text)">{t('Bawaan')}</Chip>
                </span>
                <span className="text-xs text-muted">Cocok untuk kebanyakan sesi. {GENERAL.rule}</span>
              </span>
              <Radio on={shootType === 'auto'} />
            </button>
            <p className="text-xs text-faint">{t('Atau pilih sendiri supaya lebih tepat:')}</p>
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
            <p className="flex gap-2 rounded-lg bg-panel-2 px-3 py-2.5 text-xs text-muted">
              <Sparkles size={14} className="mt-px shrink-0 text-gold-text" />
              {shootRule(shootType)} {t('Bisa diganti nanti di layar Review tanpa analisis ulang.')}
            </p>
          </section>

          <section className="flex flex-col gap-2.5">
            <h2 className="text-[15px] font-semibold">{t('Ketat seleksi')}</h2>
            <Segmented<Strictness>
              value={options.strictness}
              onChange={(strictness) => set({ strictness })}
              options={[
                { value: 'loose', label: t('Longgar') },
                { value: 'balanced', label: t('Seimbang') },
                { value: 'strict', label: t('Ketat') },
              ]}
            />
            <p className="text-xs text-faint">{strictnessHint(options.strictness)}</p>
          </section>
        </div>

        <aside className="flex w-full max-w-[744px] shrink-0 flex-col gap-4 xl:w-[380px] xl:pt-[46px]">
          <div className="flex flex-col rounded-2xl border border-line-soft bg-panel p-5">
            <h2 className="mb-1 text-[15px] font-semibold">{t('Yang dicek AI')}</h2>
            <Check icon={Focus} label={t('Blur / tidak fokus')} sub={t('Diukur di bagian paling tajam, bukan latar bokeh')} on={options.checkBlur} onChange={(checkBlur) => set({ checkBlur })} />
            <Check icon={EyeOff} label={t('Mata terpejam')} sub={t('Masuk Cek; dilewati hanya di mode Ketat')} on={options.checkEyes} onChange={(checkEyes) => set({ checkEyes })} />
            <Check icon={Copy} label={t('Duplikat & burst')} sub={t('Simpan yang terbaik per grup')} on={options.checkDuplicates} onChange={(checkDuplicates) => set({ checkDuplicates })} />
            <Check icon={SunMedium} label={t('Eksposur')} sub={t('Terlalu gelap atau terlalu terang')} on={options.checkExposure} onChange={(checkExposure) => set({ checkExposure })} />
            <Check icon={Smile} label={t('Ekspresi')} sub={t('Di grup burst, yang tersenyum diutamakan · tidak pernah membuang foto')} on={options.checkSmile} onChange={(checkSmile) => set({ checkSmile })} />
          </div>
          <div className="flex items-start gap-2.5 rounded-xl bg-pick/10 p-3.5">
            <ShieldCheck size={18} className="shrink-0 text-pick" />
            <p className="text-xs text-muted">
              {isMac
                ? t('Diproses offline di Mac ini. Foto tidak di-upload dan file asli tidak diubah.')
                : t('Diproses offline di komputer ini. Foto tidak di-upload dan file asli tidak diubah.')}
            </p>
          </div>
          <Button
            variant="primary"
            size="lg"
            icon={Sparkles}
            disabled={nothingToCheck || photos === 0}
            onClick={() => analyze(folder, chosen, options)}
          >
            {t('Mulai pilih otomatis')}
          </Button>
          {folder.folders.length === 0 ? (
            <p className="text-xs text-reject">{t('Folder ini tidak berisi foto RAW atau JPEG.')}</p>
          ) : (
            photos === 0 && <p className="text-xs text-maybe">{t('Centang minimal satu folder.')}</p>
          )}
          {nothingToCheck && <p className="text-xs text-maybe">{t('Nyalakan minimal satu pengecekan.')}</p>}
        </aside>
      </main>
    </div>
  );
}

/**
 * One line of the folder tree: the chosen folder itself (`summary`), or a
 * subfolder at any depth (`node`), indented by its depth. A folder's box
 * picks everything under it; "some" shows a dash.
 */
function FolderRow({
  name,
  summary,
  node,
  state,
  onToggle,
  badge,
}: {
  name: string;
  summary?: FolderSummary;
  node?: FolderNode<FolderSummary>;
  state: 'on' | 'some' | 'off';
  onToggle: () => void;
  badge: React.ReactNode;
}) {
  const photos = node ? node.photos : summary!.photos;
  const size = node ? node.bytes : summary!.bytes;
  const formats = node ? null : Object.keys(summary!.formats).join(', ');
  const own = node?.own;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'some' ? 'mixed' : state === 'on'}
      onClick={onToggle}
      style={node ? { paddingLeft: 14 + node.depth * 22 } : undefined}
      className="relative flex items-center gap-3 border-b border-line-soft px-3.5 py-2.5 text-left last:border-0 hover:bg-panel-2"
    >
      <span
        className={cx(
          'flex size-4 shrink-0 items-center justify-center rounded border',
          state !== 'off' ? 'border-gold bg-gold' : 'border-faint',
        )}
      >
        {state === 'on' && <CheckIcon size={11} strokeWidth={3} className="text-bg" />}
        {state === 'some' && <Minus size={11} strokeWidth={3} className="text-bg" />}
      </span>
      {node ? (
        node.hasChildren ? (
          <FolderOpen size={15} className="shrink-0 text-muted" />
        ) : (
          <Folder size={15} className="shrink-0 text-muted" />
        )
      ) : (
        <FolderOpen size={15} className="shrink-0 text-gold-text" />
      )}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className={cx('truncate text-[13px]', state !== 'off' ? 'font-medium text-fg' : 'text-muted')}>{name}</span>
        {badge}
      </span>
      <span className="shrink-0 text-xs text-faint">
        {node?.hasChildren && own
          ? t('{own} di sini · {count} total', { own: num(own.photos), n: photos, count: num(photos) })
          : t('{count} foto', { n: photos, count: num(photos) })}
        {formats ? ` · ${formats}` : own && !node?.hasChildren ? ` · ${Object.keys(own.formats).join(', ')}` : ''} · {bytes(size)}
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
          {label} {soon && <Chip color="var(--color-faint)">{t('Segera')}</Chip>}
        </span>
        <span className="text-[11px] text-faint">{sub}</span>
      </div>
      <Switch label={label} checked={on} disabled={soon} onChange={(v) => onChange?.(v)} />
    </div>
  );
}
