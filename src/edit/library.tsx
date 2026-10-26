/**
 * Edit foto › Library, as Lightroom's: the catalog of sessions on the left
 * (culled in Pilih foto, or folders opened just to edit), the photos of the
 * one chosen in a grid, chosen with click / ⌘ / Shift, then Edit. A folder
 * never culled opens straight here (Impor folder): all its photos, no
 * analysis needed.
 */

import { open } from '@tauri-apps/plugin-dialog';
import { ArrowLeft, Check, FolderPlus, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { TitleBar } from '../components/title-bar';
import { Button, cx } from '../components/ui';
import { api, thumbUrl, type PhotoEntry, type SessionSummary } from '../lib/api';
import { num } from '../lib/format';
import { t, tRust } from '../lib/i18n';
import { useApp, type Screen } from '../store';
import { isEdited } from './looks';
import type { EditSettings } from './geometry';

type Filter = 'pick' | 'all' | 'edited';

export function Library({ back }: { back: Screen }) {
  const go = useApp((s) => s.go);
  const fail = useApp((s) => s.fail);
  const session = useApp((s) => s.session);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const reload = () => api.listSessions().then(setSessions, () => setSessions([]));
  useEffect(() => {
    reload();
  }, []);

  const choose = async (s: SessionSummary) => {
    if (session?.id === s.id) return;
    setOpening(s.id);
    try {
      const opened = await api.openSession(s.id);
      useApp.setState({ session: opened });
    } catch (e) {
      fail(e);
    } finally {
      setOpening(null);
    }
  };
  // Nothing open yet: the newest session.
  useEffect(() => {
    const first = sessions?.find((s) => s.available);
    if (!session && first) choose(first);
  }, [sessions]);

  const importFolder = async () => {
    const root = await open({ directory: true, title: t('Pilih folder foto yang mau diedit') });
    if (typeof root !== 'string') return;
    setOpening('import');
    try {
      useApp.setState({ session: await api.openForEdit(root) });
      reload();
    } catch (e) {
      fail(tRust(String(e)));
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar title={t('Edit foto')} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-line-soft">
          <div className="flex items-center gap-2.5 px-4 py-3">
            <button type="button" onClick={() => go(back)} aria-label={t('Kembali')} className="text-muted hover:text-fg">
              <ArrowLeft size={18} />
            </button>
            <span className="text-[11px] font-semibold tracking-wide text-faint uppercase">{t('Katalog')}</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2">
            {sessions?.filter((s) => s.available).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => choose(s)}
                className={cx('flex items-center gap-2.5 rounded-lg p-2 text-left', session?.id === s.id ? 'bg-raised' : 'hover:bg-panel-2')}
              >
                <span
                  className="h-9 w-12 shrink-0 rounded bg-line bg-cover bg-center"
                  style={{ backgroundImage: s.covers[0] ? `url("${thumbUrl(s.covers[0])}")` : undefined }}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cx('truncate text-[13px]', session?.id === s.id && 'font-semibold')}>{s.name}</span>
                  <span className="flex items-center gap-1.5 truncate text-[11px] text-faint">
                    {s.kind === 'edit' ? <SlidersHorizontal size={10} /> : <Sparkles size={10} />}
                    {s.kind === 'edit' ? t('{count} foto', { n: s.total, count: num(s.total) }) : t('{count} Pilih', { n: s.picks, count: num(s.picks) })}
                    {!!s.edited && <span className="text-gold-text">· {t('{count} diedit', { n: s.edited, count: num(s.edited) })}</span>}
                  </span>
                </span>
                {opening === s.id && <span className="size-3 animate-spin rounded-full border-2 border-gold border-t-transparent" />}
              </button>
            ))}
            {sessions && !sessions.some((s) => s.available) && (
              <p className="px-2 py-4 text-xs text-faint">{t('Belum ada sesi. Impor folder foto untuk mulai mengedit.')}</p>
            )}
          </div>
          <div className="border-t border-line-soft p-3">
            <Button icon={FolderPlus} onClick={importFolder} disabled={opening === 'import'} className="w-full">
              {opening === 'import' ? t('Membuka folder…') : t('Impor folder…')}
            </Button>
            <p className="pt-2 text-[11px] leading-snug text-faint">{t('Folder yang belum dipilah juga bisa: semua fotonya langsung siap diedit.')}</p>
          </div>
        </aside>
        {session ? <Grid key={session.id} back={back} /> : <p className="m-auto text-sm text-faint">{opening ? t('Membuka…') : t('Pilih sesi di kiri, atau impor folder.')}</p>}
      </div>
    </div>
  );
}

function Grid({ back }: { back: Screen }) {
  const go = useApp((s) => s.go);
  const session = useApp((s) => s.session)!;
  const edits = (session.edits ?? {}) as Record<string, EditSettings>;
  const hasPicks = session.kind !== 'edit' && session.photos.some((p) => p.status === 'pick');
  const [filter, setFilter] = useState<Filter>(hasPicks ? 'pick' : 'all');
  const photos = useMemo(
    () =>
      session.photos.filter((p) =>
        filter === 'pick' ? p.status === 'pick' : filter === 'edited' ? isEdited(edits[p.id]) : p.status !== 'reject' || session.kind === 'edit',
      ),
    [session.photos, filter, edits],
  );
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const last = useRef<number | null>(null);

  // Thumbnails a folder opened just to edit doesn't have yet, a page at a time.
  useEffect(() => {
    const missing = session.photos.filter((p) => !p.thumb).map((p) => p.id);
    if (!missing.length) return;
    let alive = true;
    (async () => {
      for (let i = 0; i < missing.length && alive; i += 48) {
        const got = await api.thumbnails(session.root, missing.slice(i, i + 48)).catch(() => ({}) as Record<number, string | null>);
        if (!alive) return;
        useApp.setState(({ session: s }) =>
          s && s.id === session.id ? { session: { ...s, photos: s.photos.map((p) => (got[p.id] ? { ...p, thumb: got[p.id]! } : p)) } } : {},
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [session.id]);

  const click = (e: React.MouseEvent, i: number) => {
    const id = photos[i]!.id;
    if (e.shiftKey && last.current != null) {
      const [a, b] = [Math.min(last.current, i), Math.max(last.current, i)];
      setPicked(new Set(photos.slice(a, b + 1).map((p) => p.id)));
    } else if (e.metaKey || e.ctrlKey) {
      setPicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
      last.current = i;
    } else {
      setPicked(new Set([id]));
      last.current = i;
    }
  };
  const edit = (start?: number) => {
    const list = picked.size > 1 ? photos.filter((p) => picked.has(p.id)) : photos;
    if (!list.length) return;
    const from = start ?? (picked.size === 1 ? [...picked][0] : undefined);
    go({ name: 'edit', back: { name: 'edit', back }, ids: list.map((p) => p.id), start: from });
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setPicked(new Set(photos.map((p) => p.id)));
      } else if (e.key === 'Enter' || e.key.toLowerCase() === 'd') edit();
      else if (e.key === 'Escape') setPicked(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const counts = {
    pick: session.photos.filter((p) => p.status === 'pick').length,
    all: session.photos.length,
    edited: session.photos.filter((p) => isEdited(edits[p.id])).length,
  };
  const tabs: [Filter, string][] = hasPicks ? [['pick', t('Pilih')], ['all', t('Semua')], ['edited', t('Diedit')]] : [['all', t('Semua')], ['edited', t('Diedit')]];
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-line-soft px-5 py-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] font-semibold">{session.name}</span>
          <span className="truncate text-[11px] text-faint">{session.root}</span>
        </div>
        <div className="ml-auto flex gap-0.5 rounded-[10px] bg-panel p-[3px]">
          {tabs.map(([f, label]) => (
            <button
              key={f}
              type="button"
              onClick={() => (setFilter(f), setPicked(new Set()))}
              className={cx('flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs', filter === f ? 'bg-raised font-semibold text-fg' : 'text-muted hover:text-fg')}
            >
              {label} <span className="font-normal text-faint">{num(counts[f])}</span>
            </button>
          ))}
        </div>
      </header>
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2 overflow-y-auto p-4 select-none">
        {photos.map((p, i) => (
          <Cell key={p.id} p={p} on={picked.has(p.id)} edited={isEdited(edits[p.id])} onClick={(e) => click(e, i)} onOpen={() => edit(p.id)} />
        ))}
        {!photos.length && <p className="col-span-full py-16 text-center text-sm text-faint">{filter === 'edited' ? t('Belum ada foto yang diedit.') : t('Tidak ada foto di sini.')}</p>}
      </div>
      <footer className="flex shrink-0 items-center gap-3 border-t border-line-soft bg-panel px-5 py-3">
        <span className="mr-auto text-[13px] text-muted">
          {picked.size > 1
            ? t('{count} foto dipilih', { n: picked.size, count: num(picked.size) })
            : t('Klik dua kali untuk mengedit · ⌘/Shift+klik untuk memilih beberapa · ⌘A semua')}
        </span>
        <Button variant="primary" icon={SlidersHorizontal} onClick={() => edit()} disabled={!photos.length}>
          {picked.size > 1 ? t('Edit {count} foto', { n: picked.size, count: num(picked.size) }) : t('Edit {count} foto', { n: photos.length, count: num(photos.length) })}
        </Button>
      </footer>
    </main>
  );
}

function Cell({ p, on, edited, onClick, onOpen }: { p: PhotoEntry; on: boolean; edited: boolean; onClick: (e: React.MouseEvent) => void; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onOpen}
      title={p.name}
      className={cx('group flex flex-col gap-1 rounded-lg p-1.5 text-left', on ? 'bg-gold/10 ring-2 ring-gold' : 'hover:bg-panel-2')}
    >
      <span className="relative flex aspect-[3/2] w-full items-center justify-center overflow-hidden rounded bg-bg">
        {p.thumb ? <img src={thumbUrl(p.thumb)} alt="" loading="lazy" className="max-h-full max-w-full object-contain" draggable={false} /> : <span className="size-full animate-pulse bg-line" />}
        {edited && <span className="absolute top-1 right-1 size-2 rounded-full bg-gold ring-1 ring-black/40" title={t('Sudah diedit')} />}
        {on && (
          <span className="absolute top-1 left-1 flex size-4 items-center justify-center rounded-full bg-gold text-white">
            <Check size={11} />
          </span>
        )}
      </span>
      <span className="truncate px-0.5 text-[11px] text-faint">{p.name}</span>
    </button>
  );
}
