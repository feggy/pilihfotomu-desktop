/**
 * The editor's Brand panel: the studio's logo and name onto the design, and
 * the watermark. The brand itself is set in Pengaturan › Brand studio.
 */

import { Settings2, Stamp, Type, UserRound } from 'lucide-react';

import { Segmented, Switch, cx } from '../components/ui';
import { t } from '../lib/i18n';
import { useApp } from '../store';
import { addText, type Edit } from './actions';
import { LOGO_STICKER, useBrand } from './brand';
import { newId, type CollageDoc, type Watermark, type WatermarkPosition } from './engine/document';
import { personalize } from './personalize';
import { useKreasi } from './store';

const POSITIONS: { id: WatermarkPosition; label: string }[] = [
  { id: 'kiri-atas', label: 'Kiri atas' },
  { id: 'kanan-atas', label: 'Kanan atas' },
  { id: 'kiri-bawah', label: 'Kiri bawah' },
  { id: 'tengah-bawah', label: 'Tengah bawah' },
  { id: 'kanan-bawah', label: 'Kanan bawah' },
];

export function BrandPanel({ doc, edit, onAdd }: { doc: CollageDoc; edit: (fn: Edit) => void; onAdd: (a: { edit: Edit; id: string }) => void }) {
  const brand = useBrand();
  const go = useApp((s) => s.go);
  const wm = doc.watermark;
  const setWm = (patch: Partial<Watermark>) => edit((d) => ({ ...d, watermark: { ...d.watermark, ...patch } }));
  const empty = !brand.studio.trim() && !brand.logo;

  const addLogo = () => {
    const id = newId();
    onAdd({
      id,
      edit: (d) => ({
        ...d,
        stickers: [
          ...d.stickers,
          { id, sticker: LOGO_STICKER, x: 0.5 / d.slides, y: 0.85, size: 0.22 / d.slides, rotate: 0, color: '#ffffff', ratio: brand.logoRatio },
        ],
      }),
    });
  };
  const addName = () => {
    const a = addText(brand.studio.trim(), 0.045, 600);
    onAdd({
      id: a.id,
      edit: (d) => {
        const next = a.edit(d);
        return brand.font ? { ...next, texts: next.texts.map((x) => (x.id === a.id ? { ...x, font: brand.font! } : x)) } : next;
      },
    });
  };

  const client = useKreasi((s) => s.client);
  const setClient = useKreasi((s) => s.setClient);
  const dateValue = client.date != null ? new Date(client.date * 1000).toISOString().slice(0, 10) : '';
  const apply = () => {
    edit((d) => personalize(d, client, brand.studio));
    setClient({ applied: client.name.trim() });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5 rounded-lg border border-line-soft bg-bg p-3">
        <span className="flex items-center gap-2 text-xs font-semibold">
          <UserRound size={14} className="text-gold-text" /> {t('Data klien')}
        </span>
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          {t('Nama klien')}
          <input
            value={client.name}
            onChange={(e) => setClient({ name: e.target.value })}
            placeholder={t('mis. Rina & Dimas')}
            className="h-8 rounded-md border border-line bg-panel px-2 text-xs text-fg outline-none placeholder:text-faint focus:border-gold"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          {t('Tanggal acara')}
          <input
            type="date"
            value={dateValue}
            onChange={(e) => setClient({ date: e.target.value ? Date.parse(`${e.target.value}T00:00:00Z`) / 1000 : null })}
            className="h-8 rounded-md border border-line bg-panel px-2 text-xs text-fg outline-none focus:border-gold"
          />
        </label>
        <button type="button" onClick={apply} className="h-8 rounded-md bg-raised text-xs font-medium hover:bg-line">
          {t('Terapkan ke desain')}
        </button>
        <span className="text-[11px] leading-snug text-faint">
          {t('Mengganti nama, tanggal dan nama studio contoh di template. Template berikutnya terisi sendiri.')}
        </span>
      </div>
      {empty ? (
        <p className="text-xs leading-relaxed text-muted">{t('Isi nama studio dan logo sekali, lalu pakai di semua desain.')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {brand.logo && (
            <button type="button" onClick={addLogo} className="flex items-center gap-3 rounded-lg border border-line-soft bg-bg p-2 text-left hover:border-gold">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-[repeating-conic-gradient(#2a3a33_0_25%,#1a2622_0_50%)] bg-[length:10px_10px] p-1">
                <img src={brand.logo} alt="" className="max-h-full max-w-full" />
              </span>
              <span className="text-xs font-medium">{t('Tambah logo')}</span>
            </button>
          )}
          {brand.studio.trim() && (
            <button type="button" onClick={addName} className="flex items-center gap-3 rounded-lg border border-line-soft bg-bg p-2 text-left hover:border-gold">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-raised">
                <Type size={16} className="text-gold-text" />
              </span>
              <span className="min-w-0 truncate text-xs font-medium">{brand.studio}</span>
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-line-soft bg-bg p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs font-semibold">
            <Stamp size={14} className="text-gold-text" /> {t('Watermark')}
          </span>
          <Switch
            label={t('Watermark')}
            checked={wm.enabled}
            disabled={empty}
            onChange={(enabled) => setWm({ enabled, kind: wm.kind === 'gambar' && !brand.logo ? 'teks' : wm.kind })}
          />
        </div>
        {wm.enabled && (
          <>
            {brand.logo && (
              <Segmented<Watermark['kind']>
                value={wm.kind}
                onChange={(kind) => setWm({ kind })}
                options={[
                  { value: 'teks', label: t('Nama') },
                  { value: 'gambar', label: t('Logo') },
                ]}
              />
            )}
            <div className="grid grid-cols-2 gap-1">
              {POSITIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setWm({ position: p.id, custom: null })}
                  className={cx(
                    'h-7 rounded-md text-[11px]',
                    wm.position === p.id && !wm.custom ? 'bg-raised font-semibold text-fg ring-1 ring-line' : 'text-muted hover:text-fg',
                  )}
                >
                  {t(p.label)}
                </button>
              ))}
            </div>
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              {t('Ukuran')}
              <input type="range" min={0.015} max={0.06} step={0.001} value={wm.size} onChange={(e) => setWm({ size: Number(e.target.value) })} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">
              {t('Transparansi')}
              <input type="range" min={0.2} max={1} step={0.01} value={wm.opacity} onChange={(e) => setWm({ opacity: Number(e.target.value) })} />
            </label>
            {wm.kind === 'teks' && (
              <Segmented<Watermark['tone']>
                value={wm.tone}
                onChange={(tone) => setWm({ tone })}
                options={[
                  { value: 'terang', label: t('Terang') },
                  { value: 'gelap', label: t('Gelap') },
                ]}
              />
            )}
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => go({ name: 'settings', back: useApp.getState().screen, section: 'brand' })}
        className="flex items-center gap-1.5 self-start text-xs font-medium text-gold-text hover:underline"
      >
        <Settings2 size={13} /> {t('Atur brand studio')}
      </button>
    </div>
  );
}
