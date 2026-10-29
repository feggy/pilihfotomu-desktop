/**
 * Drafts saved as the design changes: a moment after the last change, or at
 * once on the way back or out of Buat konten.
 */

import { saveDraft } from './drafts';
import { saveHistory } from './history';
import { useKreasi } from './store';

/** The autosave waiting to run; `saveNow` runs it at once. */
let pending: number | null = null;

/**
 * Saves the open design now, skipping the autosave's wait: on the way back
 * or out, so the last change is never lost. Reads the design before anything
 * awaits, so a reset right after it changes nothing. An untouched template is
 * not worth a draft.
 */
export function saveNow(): Promise<void> {
  if (pending != null) clearTimeout(pending);
  pending = null;
  const s = useKreasi.getState();
  if (!s.doc || !s.template || !s.draftId) return Promise.resolve();
  const touched = s.past.length > 0 || s.future.length > 0 || s.doc.slots.some((x) => x?.file.fileId.startsWith('foto-'));
  if (!touched) return Promise.resolve();
  const history = saveHistory(s.past, s.doc, s.future);
  return saveDraft({ id: s.draftId, name: s.name, templateId: s.template.id, templateName: s.template.name, doc: s.doc, source: s.source, history }).then(
    (at) => {
      if (useKreasi.getState().draftId === s.draftId) useKreasi.getState().setSavedAt(at);
    },
    (e) => console.error('draft not saved', e),
  );
}

/** Saves 0.8 s from now, unless something changes again before. */
export function saveSoon() {
  if (pending != null) clearTimeout(pending);
  pending = window.setTimeout(saveNow, 800);
}

export const savePending = () => pending != null;
