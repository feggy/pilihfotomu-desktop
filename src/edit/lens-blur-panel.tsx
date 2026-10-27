/**
 * Lens Blur's sliders: Apply (reads the photo's depth, a moment), how soft,
 * the distance in focus, and how deep the sharp part reaches.
 */

import { Focus, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { Button } from '../components/ui';
import { t } from '../lib/i18n';
import { autoFocus, depthOf } from './lens-blur';
import { Slider } from './panels';
import type { EditSettings } from './geometry';

export function LensBlurPanel({
  root,
  photoId,
  a,
  faces,
  onLive,
  onDone,
}: {
  root: string;
  photoId: number;
  a: EditSettings;
  /** The faces found in the photo (shares of it): the largest is focused on. */
  faces: { x: number; y: number; w: number; h: number }[];
  onLive: (patch: Partial<EditSettings>) => void;
  onDone: () => void;
}) {
  const lb = a.lensBlur;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = async () => {
    setError(null);
    setBusy(true);
    try {
      const d = await depthOf(root, photoId);
      onLive({ lensBlur: { amount: 50, focus: autoFocus(d, faces), range: 20 } });
      onDone();
    } catch {
      setError(t('Kedalaman foto ini tidak bisa dibaca.'));
    } finally {
      setBusy(false);
    }
  };
  const refocus = async () => {
    if (!lb) return;
    const d = await depthOf(root, photoId).catch(() => null);
    if (!d) return;
    onLive({ lensBlur: { ...lb, focus: autoFocus(d, faces) } });
    onDone();
  };
  if (!lb || lb.amount <= 0)
    return (
      <div className="flex flex-col gap-2">
        <p className="text-[11px] leading-snug text-faint">
          {t('Latar dibuat lembut seperti lensa bukaan besar, menurut jarak tiap bagian foto yang dibaca AI di komputer ini.')}
        </p>
        <Button icon={Sparkles} onClick={apply} disabled={busy}>
          {busy ? t('Membaca kedalaman…') : t('Terapkan Lens Blur')}
        </Button>
        {error && <p className="text-[11px] text-reject">{error}</p>}
      </div>
    );
  const set = (patch: Partial<typeof lb>) => onLive({ lensBlur: { ...lb, ...patch } });
  return (
    <div className="flex flex-col gap-3">
      <Slider label={t('Jumlah blur')} value={lb.amount} min={0} max={100} center={0} onLive={(v) => set({ amount: v })} onDone={onDone} />
      <Slider
        label={t('Fokus')}
        value={lb.focus}
        min={0}
        max={100}
        center={0}
        show={(v) => (v < 15 ? t('Dekat') : v > 85 ? t('Jauh') : String(v))}
        onLive={(v) => set({ focus: v })}
        onDone={onDone}
      />
      <Slider label={t('Rentang fokus')} value={lb.range} min={0} max={100} center={0} onLive={(v) => set({ range: v })} onDone={onDone} />
      <Button icon={Focus} onClick={refocus}>
        {t('Fokus ke subjek')}
      </Button>
    </div>
  );
}
