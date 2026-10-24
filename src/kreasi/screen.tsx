import { useEffect } from 'react';

import { saveDraft } from './drafts';

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
        <Gallery onBack={() => (useKreasi.getState().reset(), go(back))} />
      ) : step === 'isi' ? (
        <Fill />
      ) : (
        <Editor />
      )}
    </div>
  );
}

/**
 * Saves the design 0.8 s after it last changed, once it has a photo or an
 * edit — an untouched template is not worth a draft.
 */
function useAutosave() {
  useEffect(() => {
    let timer: number | null = null;
    const unsub = useKreasi.subscribe((now, before) => {
      const dragEnded = before.gesture && !now.gesture;
      if (!dragEnded && now.doc === before.doc && now.source === before.source && now.name === before.name) return;
      if (!now.doc || !now.template || !now.draftId || now.gesture) return;
      const touched = now.past.length > 0 || now.doc.slots.some((s) => s?.file.fileId.startsWith('foto-'));
      if (!touched) return;
      if (timer != null) clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const s = useKreasi.getState();
        if (!s.doc || !s.template || !s.draftId) return;
        try {
          const at = await saveDraft({ id: s.draftId, name: s.name, templateId: s.template.id, templateName: s.template.name, doc: s.doc, source: s.source });
          useKreasi.getState().setSavedAt(at);
        } catch (e) {
          console.error('draft not saved', e);
        }
      }, 800);
    });
    return () => {
      unsub();
      if (timer != null) clearTimeout(timer);
    };
  }, []);
}
