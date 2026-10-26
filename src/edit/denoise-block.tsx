/**
 * Detail › AI Denoise: noise taken away by FFDNet on this computer (Rust,
 * `denoise_photo`), made once per photo and kept; how strongly it is mixed
 * in is a slider. The photo's own noise level is read first, so a clean
 * photo says so instead of being smoothed for nothing.
 */

import { Cpu, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Button, Switch } from '../components/ui';
import { api } from '../lib/api';
import { num } from '../lib/format';
import { t, tRust } from '../lib/i18n';
import { Slider } from './panels';
import type { EditSettings } from './geometry';
import { cleanedImage } from './source';

export function DenoiseBlock({
  root,
  photoId,
  a,
  others,
  onLive,
  onDone,
  onApplyOthers,
}: {
  root: string;
  photoId: number;
  a: EditSettings;
  /** Other photos ticked in the strip. */
  others: number[];
  onLive: (patch: Partial<EditSettings>) => void;
  onDone: () => void;
  /** Turns it on for these photos (once each is cleaned). */
  onApplyOthers: (ids: number[], amount: number) => void;
}) {
  const on = (a.aiDenoise?.amount ?? 0) > 0;
  const [work, setWork] = useState<{ photo: number; of: number; done: number; total: number } | null>(null);
  const [sigma, setSigma] = useState<Record<number, number>>({});
  const [error, setError] = useState<string | null>(null);

  /** Cleans `ids` one after another (the work is heavy), then calls `then`. */
  const clean = async (ids: number[], then: () => void) => {
    setError(null);
    try {
      for (const [i, id] of ids.entries()) {
        setWork({ photo: i + 1, of: ids.length, done: 0, total: 0 });
        const d = await api.denoisePhoto(root, id, (p) => setWork({ photo: i + 1, of: ids.length, ...p }));
        setSigma((s) => ({ ...s, [id]: d.sigma }));
        await cleanedImage(root, id, false);
      }
      then();
    } catch (e) {
      setError(tRust(String(e)));
    } finally {
      setWork(null);
    }
  };
  const toggle = (v: boolean) => {
    if (!v) {
      onLive({ aiDenoise: undefined });
      return onDone();
    }
    clean([photoId], () => {
      onLive({ aiDenoise: { amount: 100 } });
      onDone();
    });
  };
  const s = sigma[photoId];
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line-soft bg-panel-2 p-3">
      <div className="flex items-start gap-2.5">
        <Sparkles size={15} className="mt-0.5 shrink-0 text-gold-text" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] font-semibold">{t('AI Denoise')}</span>
          <span className="text-[11px] text-faint">{t('Hilangkan noise ISO tinggi, detail tetap terjaga.')}</span>
        </span>
        <Switch label={t('AI Denoise')} checked={on} disabled={!!work} onChange={toggle} />
      </div>
      {work && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-muted">
            {work.of > 1 ? t('Foto {at} dari {count}', { at: num(work.photo), n: work.of, count: num(work.of) }) + ' · ' : ''}
            {work.total ? t('Mengurangi noise… {p}%', { p: Math.round((work.done / work.total) * 100) }) : t('Membaca foto ukuran penuh…')}
          </span>
          <span className="h-1 overflow-hidden rounded-full bg-line">
            <span className="block h-full bg-gold transition-[width]" style={{ width: `${work.total ? (work.done / work.total) * 100 : 3}%` }} />
          </span>
        </div>
      )}
      {on && !work && (
        <Slider
          label={t('Kekuatan')}
          value={a.aiDenoise!.amount}
          min={1}
          center={100}
          onLive={(v) => onLive({ aiDenoise: { amount: v } })}
          onDone={onDone}
        />
      )}
      {s != null && s < 4 && !work && <p className="text-[11px] text-maybe">{t('Foto ini hampir tidak ber-noise; AI Denoise hanya sedikit mengubahnya.')}</p>}
      {on && others.length > 0 && !work && (
        <Button onClick={() => clean(others, () => onApplyOthers(others, a.aiDenoise!.amount))}>
          {t('Terapkan ke {count} foto terpilih', { n: others.length, count: num(others.length) })}
        </Button>
      )}
      <span className="flex items-center gap-1.5 text-[11px] text-faint">
        <Cpu size={12} /> {t('Di komputer ini, ±10–15 dtk per foto 24 MP; hasilnya disimpan untuk dipakai lagi.')}
      </span>
      {error && <p className="text-[11px] text-reject">{error}</p>}
    </div>
  );
}
