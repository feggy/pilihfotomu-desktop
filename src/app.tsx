import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { ClientPicks } from './screens/client-picks';
import { Compare } from './screens/compare';
import { chooseFolder, Home } from './screens/home';
import { ProgressScreen } from './screens/progress';
import { Review } from './screens/review';
import { Settings } from './screens/settings';
import { Setup } from './screens/setup';
import { lang, syncNativeLang, t, tRust, useLang } from './lib/i18n';
import { useApp, type Screen } from './store';

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

  // Dropping a folder anywhere on the home screen opens it.
  useEffect(() => {
    const off = getCurrentWebview().onDragDropEvent((e) => {
      if (useApp.getState().screen.name !== 'home') return;
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

  // Native menu bar items (src-tauri/src/menu.rs).
  useEffect(() => {
    const off = listen<string>('menu', ({ payload }) => {
      const { screen: current, session: open, go: goTo } = useApp.getState();
      if (payload === 'undo' || payload === 'redo') {
        const field = document.activeElement;
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
          document.execCommand(payload);
        } else if (current.name === 'review' || current.name === 'compare') {
          useApp.getState()[payload]();
        }
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
      <Setup key={screen.folder.root} folder={screen.folder} />
    ) : screen.name === 'progress' ? (
      <ProgressScreen />
    ) : screen.name === 'review' ? null : screen.name === 'compare' ? (
      <Compare key={screen.ids?.join(',') ?? screen.group} group={screen.group} ids={screen.ids} />
    ) : screen.name === 'picks' ? (
      <ClientPicks key={screen.root} root={screen.root} back={screen.back} />
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
    </>
  );
}

function fromReview(s: Screen): boolean {
  if (s.name === 'review' || s.name === 'compare') return true;
  if (s.name === 'settings' || s.name === 'picks') return fromReview(s.back);
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
