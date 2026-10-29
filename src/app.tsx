import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { saveNow } from './kreasi/autosave';
import { KreasiScreen } from './kreasi/screen';
import { ClientPicks } from './screens/client-picks';
import { EditPhotos } from './screens/edit-photos';
import { Compare } from './screens/compare';
import { chooseFolder, Home, PilihStart } from './screens/home';
import { ProgressScreen } from './screens/progress';
import { Review } from './screens/review';
import { Settings } from './screens/settings';
import { Setup } from './screens/setup';
import { TermsGate } from './components/legal';
import { isMac } from './components/title-bar';
import { api } from './lib/api';
import { lang, syncNativeLang, t, tRust, useLang } from './lib/i18n';
import { useApp, type Screen } from './store';

/**
 * Where ⌘Z undoes typing: a text box. A slider, colour or checkbox that kept
 * focus after a click must not swallow it.
 */
function isTyping(el: Element | null) {
  return (
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && ['text', 'search', 'number', 'email', 'url', 'password', ''].includes(el.type)) ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

/** Undo / redo for whatever the open screen keeps a history of. */
function undoRedo(which: 'undo' | 'redo') {
  const current = useApp.getState().screen;
  if (current.name === 'review' || current.name === 'compare') useApp.getState()[which]();
}

export function App() {
  const screen = useApp((s) => s.screen);
  const session = useApp((s) => s.session);
  const [dragging, setDragging] = useState(false);
  // Every screen reads the language when it renders; re-rendering from the
  // top is what switches it.
  const langPref = useLang((s) => s.pref);
  useEffect(() => {
    document.documentElement.lang = lang();
    syncNativeLang();
  }, [langPref]);

  // Dropping a folder anywhere on the home screen, or Pilih foto's, opens it.
  useEffect(() => {
    const off = getCurrentWebview().onDragDropEvent((e) => {
      const at = useApp.getState().screen.name;
      if (at !== 'home' && at !== 'pilih') return;
      if (e.payload.type === 'enter' || e.payload.type === 'over') setDragging(true);
      else if (e.payload.type === 'leave') setDragging(false);
      else if (e.payload.type === 'drop') {
        setDragging(false);
        if (e.payload.paths[0]) chooseFolder(e.payload.paths[0]);
      }
    });
    return () => {
      off.then((f) => f());
    };
  }, []);

  // ⌘Z / ⇧⌘Z (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y) and ⌘A are the page's alone
  // (the menu bar items have no shortcut, see menu.rs). In a text field they
  // act on the typing; elsewhere on the screen's own history and selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const typing = isTyping(document.activeElement);
      if (k === 'a' && typing) {
        e.preventDefault();
        document.execCommand('selectAll');
        return;
      }
      const which = k === 'z' ? (e.shiftKey ? 'redo' : 'undo') : k === 'y' && !e.shiftKey ? 'redo' : null;
      if (!which) return;
      if (typing) {
        e.preventDefault();
        document.execCommand(which);
      } else if (useApp.getState().screen.name !== 'kreasi') {
        // Buat konten's editor handles its own (editor.tsx), next to its other keys.
        e.preventDefault();
        undoRedo(which);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Closing the window (its button, ⌘W): a design being made is saved first, then the window goes.
  useEffect(() => {
    const off = getCurrentWindow().onCloseRequested(() => saveNow());
    return () => {
      off.then((f) => f());
    };
  }, []);

  // Native menu bar items (src-tauri/src/menu.rs).
  useEffect(() => {
    const off = listen<string>('menu', ({ payload }) => {
      // Quit: a Buat konten design being made is kept under Lanjutkan desain first, without asking.
      if (payload === 'quit') {
        saveNow().finally(() => api.quitApp());
        return;
      }
      const { screen: current, session: open, go: goTo } = useApp.getState();
      if (payload === 'undo' || payload === 'redo') {
        if (isTyping(document.activeElement)) document.execCommand(payload);
        else if (current.name === 'kreasi') window.dispatchEvent(new CustomEvent('pfm:undo', { detail: payload }));
        else undoRedo(payload);
        return;
      }
      if (payload === 'select-all') {
        // As if ⌘A were pressed: each screen handles it its own way.
        if (isTyping(document.activeElement)) document.execCommand('selectAll');
        else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', metaKey: isMac, ctrlKey: !isMac, bubbles: true }));
        return;
      }
      if (current.name === 'progress') return; // don't walk away from a running analysis
      const back = current.name === 'settings' ? current.back : current;
      if (payload === 'settings') goTo({ name: 'settings', back });
      else if (payload === 'shortcuts') goTo({ name: 'settings', back, section: 'keys' });
      else if (payload === 'home') goTo({ name: 'home' });
      else if (payload === 'open-folder') chooseFolder();
      else if (payload === 'client-picks') {
        if (open) goTo({ name: 'picks', root: open.root, back: { name: 'review' } });
        else goTo({ name: 'home' });
      } else if (payload === 'export' && current.name === 'kreasi') {
        window.dispatchEvent(new Event('pfm:kreasi-export'));
      } else if (payload === 'export' && open) {
        if (current.name !== 'review') goTo({ name: 'review' });
        window.dispatchEvent(new Event('pfm:export'));
      }
    });
    return () => {
      off.then((f) => f());
    };
  }, []);


  // Screens that need an open session fall back home without one.
  const needsSession = screen.name === 'review' || screen.name === 'compare';
  const view =
    needsSession && !session ? (
      <Home dragging={dragging} />
    ) : screen.name === 'setup' ? (
      <Setup key={screen.folder.root} folder={screen.folder} mode={screen.mode} />
    ) : screen.name === 'progress' ? (
      <ProgressScreen />
    ) : screen.name === 'review' ? null : screen.name === 'compare' ? (
      <Compare key={screen.ids?.join(',') ?? screen.group} group={screen.group} ids={screen.ids} />
    ) : screen.name === 'picks' ? (
      <ClientPicks key={screen.root} root={screen.root} back={screen.back} text={screen.text} folders={screen.folders} />
    ) : screen.name === 'kreasi' ? (
      <KreasiScreen back={screen.back} />
    ) : screen.name === 'edit' ? (
      <EditPhotos key={screen.ids ? 'editor' : 'library'} back={screen.back} ids={screen.ids} start={screen.start} />
    ) : screen.name === 'pilih' ? (
      <PilihStart dragging={dragging} />
    ) : screen.name === 'settings' ? (
      <Settings key={screen.section ?? 'license'} back={screen.back} initial={screen.section} />
    ) : (
      <Home dragging={dragging} />
    );

  // Review stays mounted under screens opened from it (compare, settings,
  // client picks), hidden but laid out, so coming back finds the same
  // scroll position, selection and open photo.
  const keepReview = !!session && fromReview(screen);

  return (
    <>
      {keepReview && (
        <div className={screen.name === 'review' ? 'contents' : 'invisible fixed inset-0 -z-10'} aria-hidden={screen.name !== 'review'}>
          <Review />
        </div>
      )}
      {view}
      <ErrorToast />
      <TermsGate />
    </>
  );
}

function fromReview(s: Screen): boolean {
  if (s.name === 'review' || s.name === 'compare') return true;
  if (s.name === 'settings' || s.name === 'picks' || s.name === 'kreasi' || s.name === 'edit') return fromReview(s.back);
  return false;
}

function ErrorToast() {
  const error = useApp((s) => s.error);
  const dismiss = useApp((s) => s.dismissError);
  if (!error) return null;
  return (
    <div className="fixed bottom-10 left-1/2 z-50 flex max-w-[560px] -translate-x-1/2 items-start gap-3 rounded-xl border border-reject/60 bg-panel-2 p-3.5 shadow-2xl">
      <TriangleAlert size={16} className="mt-0.5 shrink-0 text-reject" />
      <p className="text-[13px]">{tRust(error)}</p>
      <button type="button" onClick={dismiss} aria-label={t('Tutup')} className="text-faint hover:text-fg">
        <X size={15} />
      </button>
    </div>
  );
}
