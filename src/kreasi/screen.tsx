import { useEffect } from 'react';

import { TitleBar } from '../components/title-bar';
import { t } from '../lib/i18n';
import { useApp, type Screen } from '../store';
import { Editor } from './editor';
import { Fill, sessionSource } from './fill';
import { Gallery } from './gallery';
import { useKreasi } from './store';

/** Buat konten: Pilih template → Isi foto → Edit & ekspor. */
export function KreasiScreen({ back }: { back: Screen }) {
  const step = useKreasi((s) => s.step);
  const go = useApp((s) => s.go);

  // Coming from a session: its photos are the source; otherwise a folder is picked in Isi foto.
  useEffect(() => {
    const { source, setSource } = useKreasi.getState();
    const s = useApp.getState().session;
    if (back.name !== 'home' && s && source?.root !== s.root) setSource(sessionSource());
  }, [back]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar title={t('Buat konten')} />
      {step === 'galeri' ? (
        <Gallery onBack={() => (useKreasi.getState().reset(), go(back))} />
      ) : step === 'isi' ? (
        <Fill />
      ) : (
        <Editor />
      )}
    </div>
  );
}
