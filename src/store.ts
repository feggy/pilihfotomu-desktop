import { create } from 'zustand';

import { api, type FolderInfo, type Options, type Progress, type Reason, type Session, type Status } from './lib/api';

export type Screen =
  | { name: 'home' }
  | { name: 'setup'; folder: FolderInfo }
  | { name: 'progress' }
  | { name: 'review' }
  | { name: 'compare'; group: number }
  /** Client picks on any folder; uses the open session's thumbnails when it is that folder. */
  | { name: 'picks'; root: string; back: Screen }
  | { name: 'settings'; back: Screen; section?: 'license' | 'keys' | 'about' };

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
  selectedId: number | null;
  error: string | null;

  go: (screen: Screen) => void;
  fail: (error: unknown) => void;
  dismissError: () => void;
  select: (id: number | null) => void;
  analyze: (folder: FolderInfo, folders: string[], options: Options) => Promise<void>;
  cancel: () => Promise<void>;
  openSession: (id: string) => Promise<void>;
  setStatus: (ids: number[], status: Status) => Promise<void>;
  setRating: (ids: number[], rating: number) => Promise<void>;
  markExported: () => void;
}

const message = (e: unknown) => (typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));

export const useApp = create<AppState>((set, get) => ({
  screen: { name: 'home' },
  session: null,
  run: null,
  selectedId: null,
  error: null,

  go: (screen) => set({ screen }),
  fail: (error) => set({ error: message(error) }),
  dismissError: () => set({ error: null }),
  select: (selectedId) => set({ selectedId }),

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
      set({ session, run: null, screen: { name: 'review' }, selectedId: session.photos[0]?.id ?? null });
    } catch (e) {
      const cancelled = message(e) === 'Dibatalkan.';
      set({ run: null, screen: { name: 'setup', folder }, error: cancelled ? null : message(e) });
    }
  },

  cancel: () => api.cancelAnalysis(),

  openSession: async (id) => {
    try {
      const session = await api.openSession(id);
      set({ session, screen: { name: 'review' }, selectedId: session.photos[0]?.id ?? null });
    } catch (e) {
      get().fail(e);
    }
  },

  setStatus: async (ids, status) => {
    const { session } = get();
    if (!session || ids.length === 0) return;
    const before = session;
    // Optimistic: keyboard culling has to feel instant.
    set({
      session: {
        ...session,
        photos: session.photos.map((p) =>
          ids.includes(p.id)
            ? { ...p, status, rating: status === 'pick' ? Math.max(p.rating, 4) : status === 'maybe' ? 3 : 1 }
            : p,
        ),
      },
    });
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
    set({ session: { ...session, photos: session.photos.map((p) => (ids.includes(p.id) ? { ...p, rating } : p)) } });
    try {
      await api.setRating(ids, rating);
    } catch (e) {
      set({ session: before });
      get().fail(e);
    }
  },

  markExported: () => set(({ session }) => (session ? { session: { ...session, exported: true } } : {})),
}));
