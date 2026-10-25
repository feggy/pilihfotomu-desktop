import { create } from 'zustand';

import { api, type FolderInfo, type Options, type Progress, type Reason, type Session, type Status } from './lib/api';

export type Screen =
  | { name: 'home' }
  /** A chosen folder: cull it with AI, or (`mode: 'pesan'`) find the photos a client's message names. */
  | { name: 'setup'; folder: FolderInfo; mode?: 'ai' | 'pesan' }
  | { name: 'progress' }
  | { name: 'review' }
  /** A burst group, or any photos picked by hand (`ids`). */
  | { name: 'compare'; group?: number; ids?: number[] }
  /** Client picks on any folder; uses the open session's thumbnails when it is that folder. */
  | { name: 'picks'; root: string; back: Screen; text?: string; folders?: string[] }
  /** Buat konten: pick a template, fill its photos, edit, export. */
  | { name: 'kreasi'; back: Screen }
  /** Edit foto: develop photos like Lightroom. */
  | { name: 'edit'; back: Screen }
  | { name: 'settings'; back: Screen; section?: 'license' | 'language' | 'analysis' | 'storage' | 'keys' | 'brand' | 'legal' | 'about' };

export interface RecentPhoto {
  id: number;
  name: string;
  thumb: string | null;
  status: Status;
  reason: Reason | null;
}

interface Run {
  folder: FolderInfo;
  total: number;
  done: number;
  grouping: boolean;
  startedAt: number;
  recent: RecentPhoto[];
  counts: Record<Status, number>;
}

interface AppState {
  screen: Screen;
  session: Session | null;
  run: Run | null;
  /** The photo in focus: shown in the side panel, moved with the arrows. */
  selectedId: number | null;
  /** Photos selected together (⌘/Shift-click); always includes selectedId when non-empty. */
  selection: number[];
  error: string | null;
  /** Status/star changes, newest last, for ⌘Z / ⇧⌘Z. */
  undoStack: Change[];
  redoStack: Change[];

  go: (screen: Screen) => void;
  fail: (error: unknown) => void;
  dismissError: () => void;
  select: (id: number | null) => void;
  /** ⌘-click toggles, Shift-click extends from the focused photo over `order`. */
  selectWith: (id: number, mode: 'toggle' | 'range', order: number[]) => void;
  selectAll: (ids: number[]) => void;
  undo: () => void;
  redo: () => void;
  analyze: (folder: FolderInfo, folders: string[], options: Options) => Promise<void>;
  cancel: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  setStatus: (ids: number[], status: Status) => Promise<void>;
  setRating: (ids: number[], rating: number) => Promise<void>;
  /** Decides the open session again with other settings (no file is read). */
  recull: (options: Options) => Promise<void>;
  /** Reading the open session's faces again: how far (null when not running). */
  rereading: { done: number; total: number } | null;
  rereadFaces: () => Promise<void>;
  /** Show the session summary (after an analysis, or from the sidebar). */
  summary: boolean;
  showSummary: (on: boolean) => void;
  markExported: () => void;
}

type Mark = { id: number; status: Status; rating: number };
interface Change {
  before: Mark[];
  after: Mark[];
}
const HISTORY = 200;

const message = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));

export const useApp = create<AppState>((set, get) => ({
  screen: { name: 'home' },
  session: null,
  run: null,
  selectedId: null,
  selection: [],
  error: null,
  undoStack: [],
  redoStack: [],
  summary: false,

  go: (screen) => set({ screen }),
  showSummary: (summary) => set({ summary }),
  fail: (error) => set({ error: message(error) }),
  dismissError: () => set({ error: null }),
  select: (selectedId) => set({ selectedId, selection: [] }),

  selectWith: (id, mode, order) =>
    set(({ selectedId, selection }) => {
      const current = selection.length ? selection : selectedId != null ? [selectedId] : [];
      if (mode === 'toggle') {
        const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
        return { selection: next.length > 1 ? next : [], selectedId: next.includes(id) ? id : (next[0] ?? id) };
      }
      const a = order.indexOf(selectedId ?? id);
      const b = order.indexOf(id);
      if (a < 0 || b < 0) return { selectedId: id, selection: [] };
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      return { selection: range.length > 1 ? range : [], selectedId: id };
    }),

  selectAll: (ids) => set(({ selectedId }) => ({ selection: ids.length > 1 ? ids : [], selectedId: selectedId ?? ids[0] ?? null })),

  undo: () => {
    const { undoStack, redoStack } = get();
    const c = undoStack[undoStack.length - 1];
    if (!c) return;
    set({ undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, c] });
    applyMarks(c.before);
  },

  redo: () => {
    const { undoStack, redoStack } = get();
    const c = redoStack[redoStack.length - 1];
    if (!c) return;
    set({ redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, c] });
    applyMarks(c.after);
  },

  analyze: async (folder, folders, options) => {
    set({
      screen: { name: 'progress' },
      run: {
        folder,
        total: folder.folders.filter((f) => folders.includes(f.name)).reduce((n, f) => n + f.photos, 0),
        done: 0,
        grouping: false,
        startedAt: Date.now(),
        recent: [],
        counts: { pick: 0, maybe: 0, reject: 0 },
      },
    });
    const onProgress = (p: Progress) =>
      set(({ run }) => {
        if (!run) return {};
        if (p.event === 'started') return { run: { ...run, total: p.total } };
        if (p.event === 'grouping') return { run: { ...run, grouping: true } };
        return {
          run: {
            ...run,
            done: Math.max(run.done, p.done),
            counts: { ...run.counts, [p.status]: run.counts[p.status] + 1 },
            recent: [{ id: p.id, name: p.name, thumb: p.thumb, status: p.status, reason: p.reason }, ...run.recent].slice(
              0,
              8,
            ),
          },
        };
      });
    try {
      const session = await api.analyzeFolder(folder.root, folders, options, onProgress);
      set({
        session,
        run: null,
        screen: { name: 'review' },
        selectedId: session.photos[0]?.id ?? null,
        selection: [],
        undoStack: [],
        redoStack: [],
        summary: true,
      });
    } catch (e) {
      const cancelled = message(e) === 'Dibatalkan.';
      set({ run: null, screen: { name: 'setup', folder }, error: cancelled ? null : message(e) });
    }
  },

  cancel: () => api.cancelAnalysis(),

  openSession: async (id) => {
    try {
      // Thumbnails the cache lost come back first, so the grid isn't blank.
      await api.restoreThumbs(id).catch(() => 0);
      const session = await api.openSession(id);
      set({ session, screen: { name: 'review' }, selectedId: session.photos[0]?.id ?? null, selection: [], undoStack: [], redoStack: [], summary: false });
    } catch (e) {
      get().fail(e);
    }
  },

  setStatus: async (ids, status) => {
    const { session } = get();
    if (!session || ids.length === 0) return;
    const before = session;
    // Optimistic: keyboard culling has to feel instant.
    const photos = session.photos.map((p) =>
      ids.includes(p.id)
        ? { ...p, status, manual: true, rating: status === 'pick' ? Math.max(p.rating, 4) : status === 'maybe' ? 3 : 1 }
        : p,
    );
    record(before.photos, photos, ids);
    set({ session: { ...session, photos } });
    try {
      await api.setStatus(ids, status);
    } catch (e) {
      set({ session: before });
      get().fail(e);
    }
  },

  setRating: async (ids, rating) => {
    const { session } = get();
    if (!session || ids.length === 0) return;
    const before = session;
    const photos = session.photos.map((p) => (ids.includes(p.id) ? { ...p, rating, manual: true } : p));
    record(before.photos, photos, ids);
    set({ session: { ...session, photos } });
    try {
      await api.setRating(ids, rating);
    } catch (e) {
      set({ session: before });
      get().fail(e);
    }
  },

  rereading: null,
  rereadFaces: async () => {
    set({ rereading: { done: 0, total: 0 } });
    try {
      const session = await api.rereadFaces((rereading) => set({ rereading }));
      set({ session, undoStack: [], redoStack: [] });
    } catch (e) {
      if (message(e) !== 'Dibatalkan.') get().fail(e);
    } finally {
      set({ rereading: null });
    }
  },

  recull: async (options) => {
    try {
      const session = await api.recull(options);
      // Undo steps refer to verdicts that no longer exist; picking the old
      // setting again brings them back (hand-made changes are kept anyway).
      set({ session, undoStack: [], redoStack: [] });
    } catch (e) {
      get().fail(e);
    }
  },

  markExported: () => set(({ session }) => (session ? { session: { ...session, exported: true } } : {})),
}));

/** Pushes one undoable change (only photos that actually changed). */
function record(before: { id: number; status: Status; rating: number }[], after: typeof before, ids: number[]) {
  const pick = (list: typeof before) =>
    list.filter((p) => ids.includes(p.id)).map(({ id, status, rating }) => ({ id, status, rating }));
  const b = pick(before);
  const a = pick(after);
  if (b.every((m, i) => m.status === a[i].status && m.rating === a[i].rating)) return;
  useApp.setState(({ undoStack }) => ({ undoStack: [...undoStack, { before: b, after: a }].slice(-HISTORY), redoStack: [] }));
}

/** Puts marks back exactly (undo / redo), on screen first, then on disk. */
function applyMarks(marks: Mark[]) {
  const { session, fail } = useApp.getState();
  if (!session) return;
  const by = new Map(marks.map((m) => [m.id, m]));
  useApp.setState({
    session: {
      ...session,
      photos: session.photos.map((p) => {
        const m = by.get(p.id);
        if (!m) return p;
        // Same rule as `Session::set_marks`: back to the AI's verdict is the AI's again.
        const manual = m.status !== p.autoStatus || (p.autoRating != null && m.rating !== p.autoRating);
        return { ...p, status: m.status, rating: m.rating, manual };
      }),
    },
    // Show what was undone.
    selectedId: marks[0]?.id ?? useApp.getState().selectedId,
    selection: marks.length > 1 ? marks.map((m) => m.id) : [],
  });
  api.setMarks(marks).catch(fail);
}
