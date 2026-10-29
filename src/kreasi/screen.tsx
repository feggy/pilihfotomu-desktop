import { useEffect } from 'react';

import { saveNow, savePending, saveSoon } from './autosave';

import { TitleBar } from '../components/title-bar';
import { t } from '../lib/i18n';
import { useApp, type Screen } from '../store';
import { Editor } from './editor';
import { Fill } from './fill';
import { sessionSource } from './sources';
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

  useAutosave();

  return (
    <div className="flex h-full flex-col">
      <TitleBar title={t('Buat konten')} />
      {step === 'galeri' ? (
        <Gallery onBack={() => (saveNow(), useKreasi.getState().reset(), go(back))} />
      ) : step === 'isi' ? (
        <Fill />
      ) : (
        <Editor />
      )}
    </div>
  );
}

/** Saves the design 0.8 s after it last changed; at once when the screen closes. */
function useAutosave() {
  useEffect(() => {
    const unsub = useKreasi.subscribe((now, before) => {
      const dragEnded = before.gesture && !now.gesture;
      if (!dragEnded && now.doc === before.doc && now.source === before.source && now.name === before.name) return;
      if (!now.doc || !now.template || !now.draftId || now.gesture) return;
      saveSoon();
    });
    return () => {
      unsub();
      if (savePending()) saveNow();
    };
  }, []);
}
