/**
 * Lens Corrections, as Lightroom's panel. Profile: Remove Chromatic
 * Aberration, Enable Profile Corrections, Setup (Auto: the lens from the
 * photo's EXIF; Custom: one chosen), the Lens Profile (Make, Model,
 * Profile) and Amount (Distortion, Vignetting, 100 the profile's all).
 * Manual: Distortion, and Lens Vignetting's Amount and Midpoint.
 */

import { useEffect, useMemo, useState } from 'react';

import { Select } from '../components/select';
import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { NO_GEOMETRY, type EditSettings } from './geometry';
import { correctionFor, lensCorrectionFor, lensDb, lensName, shotLens, type LensCorrection, type LensManual, type LfLens } from './lens-profile';
import { Slider } from './panels';

const NO_MANUAL: LensManual = { distortion: 0, vignette: 0, midpoint: 50 };

export function LensPanel({
  root,
  photoId,
  a,
  onLive,
  onDone,
}: {
  root: string;
  photoId: number;
  a: EditSettings;
  onLive: (patch: Partial<EditSettings>) => void;
  onDone: () => void;
}) {
  const g = a.geometry ?? NO_GEOMETRY;
  const lens = g.lens;
  const manual = a.lensManual ?? NO_MANUAL;
  const [tab, setTab] = useState<'profile' | 'manual'>('profile');
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const [all, setAll] = useState<LfLens[] | null>(null);
  /** The lens the EXIF names, as found (Setup › Auto). */
  const [auto, setAuto] = useState<string | null>(null);
  useEffect(() => {
    lensDb().then(setAll, () => {});
  }, []);
  useEffect(() => {
    setMissing(null);
    setAuto(null);
    lensCorrectionFor(root, photoId).then((r) => setAuto(r.found?.name ?? null), () => {});
  }, [root, photoId]);

  const put = (l: LensCorrection | undefined) => onLive({ geometry: { ...g, lens: l && (l.profile || l.ca) ? l : undefined } });
  const setManual = (m: Partial<LensManual>) => {
    const next = { ...manual, ...m };
    onLive({ lensManual: next.distortion || next.vignette ? next : undefined });
  };
  /** The lens for a switch turned on: the one chosen, or the photo's own found. */
  const ensure = async (): Promise<LensCorrection | null> => {
    if (lens) return lens;
    setBusy(true);
    try {
      const r = await lensCorrectionFor(root, photoId);
      if (!r.found) {
        setMissing(r.exifLens ? t('Lensa “{lens}” belum ada di database lensfun. Pilih lensanya di bawah.', { lens: r.exifLens }) : t('Foto ini tidak menyimpan nama lensanya. Pilih lensanya di bawah.'));
        return null;
      }
      return { ...r.found, profile: false, ca: false };
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (key: 'profile' | 'ca', on: boolean) => {
    setMissing(null);
    const l = on ? await ensure() : lens;
    if (!l) return;
    put({ ...l, [key]: on });
    onDone();
  };
  /** Setup › Custom: a lens chosen from the lists. */
  const choose = async (picked: LfLens) => {
    const info = await shotLens(root, photoId).catch(() => null);
    const l = correctionFor(picked, info ?? { make: null, model: null, lens: null, focal: null, aperture: null, focal35: null, iso: null, exposure: null }, {
      profile: true,
      ca: lens?.ca ?? false,
      distortion: lens?.distortion ?? 100,
      vignetting: lens?.vignetting ?? 100,
    });
    setMissing(null);
    put(l);
    onDone();
  };

  // The lens chosen is always among the choices, even before the database has loaded.
  const makers = useMemo(
    () => [...new Set([...(all ?? []).map((l) => l.maker), ...(lens ? [lens.maker] : [])])].sort((x, y) => x.localeCompare(y)),
    [all, lens?.maker],
  );
  const maker = lens?.maker ?? '';
  const models = useMemo(
    () => (all ?? []).filter((l) => l.maker === maker).sort((x, y) => lensName(x).localeCompare(lensName(y))),
    [all, maker],
  );
  const row = (label: string, el: React.ReactNode) => (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="w-14 shrink-0 text-right">{label}</span>
      {el}
    </label>
  );
  const check = (on: boolean, label: string, set: (v: boolean) => void) => (
    <label className="flex items-center gap-2.5 text-[13px]">
      <input type="checkbox" checked={on} disabled={busy} onChange={(e) => set(e.target.checked)} className="size-4 accent-[var(--color-gold)]" />
      {label}
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-center gap-3 text-[13px]">
        {(['profile', 'manual'] as const).map((k, i) => (
          <span key={k} className="flex items-center gap-3">
            {i > 0 && <span className="text-line">|</span>}
            <button type="button" onClick={() => setTab(k)} className={cx(tab === k ? 'font-semibold text-fg' : 'text-faint hover:text-muted')}>
              {k === 'profile' ? t('Profil') : t('Manual')}
            </button>
          </span>
        ))}
      </div>

      {tab === 'profile' ? (
        <>
          {check(!!lens?.ca, t('Hapus aberasi kromatik'), (v) => toggle('ca', v))}
          {check(!!lens?.profile, busy ? t('Mencari profil lensa…') : t('Aktifkan koreksi profil'), (v) => toggle('profile', v))}
          {lens?.ca && !lens.tca && <p className="text-[11px] text-faint">{t('Profil lensa ini tidak punya data aberasi kromatik.')}</p>}
          {missing && <p className="text-[11px] text-maybe">{missing}</p>}
          {/* As Lightroom: the profile's settings only once it is on (or to pick the lens by hand when it wasn't found). */}
          {(lens?.profile || missing) && (
          <>
          {row(
            t('Setup'),
            <Select
              value={lens && auto === lens.name ? 'auto' : lens ? 'custom' : 'default'}
              onChange={(v) => {
                if (v !== 'auto') return;
                setBusy(true);
                lensCorrectionFor(root, photoId)
                  .then((r) => r.found && put({ ...r.found, profile: true, ca: lens?.ca ?? false, distortion: lens?.distortion ?? 100, vignetting: lens?.vignetting ?? 100 }))
                  .finally(() => (setBusy(false), onDone()));
              }}
              size="xs"
              className="flex-1"
              options={[
                { value: 'default', label: t('Default') },
                { value: 'auto', label: t('Auto') },
                { value: 'custom', label: t('Custom'), disabled: !lens || auto === lens.name },
              ]}
            />,
          )}
          <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
            <span className="text-center text-xs text-muted">{t('Profil lensa')}</span>
            {row(
              t('Merek'),
              <Select
                value={maker}
                disabled={!all}
                onChange={(m) => {
                  const first = (all ?? []).filter((l) => l.maker === m).sort((x, y) => lensName(x).localeCompare(lensName(y)))[0];
                  if (first) choose(first);
                }}
                size="xs"
                className="flex-1"
                options={[...(!maker ? [{ value: '', label: t('Tidak ada') }] : []), ...makers.map((m) => ({ value: m, label: m }))]}
              />,
            )}
            {row(
              t('Model'),
              <Select
                value={lens?.name ?? ''}
                disabled={!maker}
                onChange={(name) => {
                  const picked = models.find((l) => lensName(l) === name);
                  if (picked) choose(picked);
                }}
                size="xs"
                className="flex-1"
                options={[
                  ...(!lens ? [{ value: '', label: t('Tidak ada') }] : []),
                  ...(lens && !models.some((l) => lensName(l) === lens.name) ? [{ value: lens.name, label: lens.name }] : []),
                  ...models.map((l) => ({ value: lensName(l), label: lensName(l) })),
                ]}
              />,
            )}
            {row(
              t('Profil'),
              <Select
                value={lens ? 'lensfun' : ''}
                disabled
                onChange={() => {}}
                size="xs"
                className="flex-1"
                options={[
                  { value: '', label: t('Tidak ada') },
                  { value: 'lensfun', label: `lensfun (${lens?.name ?? ''})` },
                ]}
              />,
            )}
          </div>
          {lens?.profile && (
          <div className="flex flex-col gap-3 border-t border-line-soft pt-3">
            <span className="text-center text-xs text-muted">{t('Jumlah')}</span>
            <Slider
              label={t('Distorsi')}
              value={lens?.distortion ?? 100}
              min={0}
              max={200}
              center={100}
              disabled={!lens?.profile || !lens.dist}
              onLive={(v) => lens && put({ ...lens, distortion: v })}
              onDone={onDone}
            />
            <Slider
              label={t('Vignetting')}
              value={lens?.vignetting ?? 100}
              min={0}
              max={200}
              center={100}
              disabled={!lens?.profile || !lens.vig}
              onLive={(v) => lens && put({ ...lens, vignetting: v })}
              onDone={onDone}
            />
          </div>
          )}
          </>
          )}
        </>
      ) : (
        <>
          <Slider label={t('Distorsi')} value={manual.distortion} onLive={(v) => setManual({ distortion: v })} onDone={onDone} />
          <div className="flex flex-col gap-3 border-t border-line-soft pt-3">
            <span className="text-xs text-muted">{t('Vignetting lensa')}</span>
            <Slider label={t('Jumlah')} value={manual.vignette} onLive={(v) => setManual({ vignette: v })} onDone={onDone} />
            <Slider label={t('Titik tengah')} value={manual.midpoint} min={0} max={100} center={50} disabled={!manual.vignette} onLive={(v) => setManual({ midpoint: v })} onDone={onDone} />
          </div>
        </>
      )}
    </div>
  );
}
