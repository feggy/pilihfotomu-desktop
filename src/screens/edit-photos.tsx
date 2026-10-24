import { ArrowLeft, SlidersHorizontal } from 'lucide-react';

import { TitleBar } from '../components/title-bar';
import { Button } from '../components/ui';
import { t } from '../lib/i18n';
import { useApp, type Screen } from '../store';

/** Edit foto lands in the next stage of work; until then, say so plainly. */
export function EditPhotos({ back }: { back: Screen }) {
  const go = useApp((s) => s.go);
  return (
    <div className="flex h-full flex-col">
      <TitleBar title={t('Edit foto')} />
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-panel-2 text-gold-text">
          <SlidersHorizontal size={28} />
        </span>
        <h1 className="text-xl font-semibold">{t('Edit foto sedang dibuat')}</h1>
        <p className="max-w-md text-sm text-muted">
          {t('Panel ala Lightroom, preset, AI denoise, dan masking menyusul di tahap berikutnya. Untuk sekarang, Pilih foto dan Buat konten sudah bisa dipakai.')}
        </p>
        <Button icon={ArrowLeft} onClick={() => go(back)}>
          {t('Kembali')}
        </Button>
      </main>
    </div>
  );
}
