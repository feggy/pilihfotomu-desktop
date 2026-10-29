import { open } from '@tauri-apps/plugin-dialog';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  ChevronRight,
  Clock,
  FolderDown,
  FolderSearch,
  FolderX,
  Image as ImageIcon,
  LayoutTemplate,
  Play,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { TitleBar } from '../components/title-bar';
import { Button, Chip, Dot, cx } from '../components/ui';
import { api, thumbUrl, type SessionSummary } from '../lib/api';
import { date, duration, num, STATUS } from '../lib/format';
import { t, tRust } from '../lib/i18n';
import { settingsLine } from '../lib/shoot';
import { useApp } from '../store';
import { BoardArt, CullArt, EditArt, StoryArt } from './home-art';

const pickFolder = async () => {
  const picked = await open({ directory: true, title: t('Pilih folder sesi') });
  return typeof picked === 'string' ? picked : null;
};

/** The culling session worked on last (its folder still there), or null. */
export async function lastSession(): Promise<SessionSummary | null> {
  const list = await api.listSessions().catch(() => []);
  return list.find((s) => s.available && s.kind !== 'edit') ?? null;
}

/** Back into the last culling session (File › Lanjutkan sesi terakhir, ⇧⌘O); Pilih foto's start when there is none. */
export async function openLastSession() {
  const s = await lastSession();
  if (s) useApp.getState().openSession(s.id);
  else useApp.getState().go({ name: 'pilih' });
}

/** Opens the folder picker and moves on to the setup screen. */
export async function chooseFolder(path?: string) {
  const { go, fail } = useApp.getState();
  const picked = path ?? (await pickFolder());
  if (!picked) return;
  try {
    go({ name: 'setup', folder: await api.inspectFolder(picked) });
  } catch (e) {
    fail(e);
  }
}

/**
 * One of the things the app does, as a big card: the mode at work above, its
 * name and a line below — and, for Pilih foto, a way straight back into the
 * last session (`extra`, a button of its own).
 */
function ModeCard({ art, icon: Icon, title, sub, onClick, highlight, extra }: { art: React.ReactNode; icon: LucideIcon; title: string; sub: string; onClick: () => void; highlight?: boolean; extra?: React.ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), onClick())}
      className={cx(
        'cursor-pointer',
        'group flex min-h-0 flex-col rounded-[22px] border bg-panel p-2.5 pb-4 text-left transition-colors outline-none',
        // Gold only while pointed at (or a folder is dragged over): a click opens the mode, nothing stays selected.
        highlight ? 'border-gold bg-raised' : 'border-line-soft hover:border-gold/70 focus-visible:border-gold/70',
      )}
    >
      <span className="block h-[246px] overflow-hidden rounded-2xl bg-panel-2 md:h-auto md:min-h-0 md:flex-1">{art}</span>
      <span className="flex flex-col gap-1 px-3 pt-3">
        <span className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-[9px] bg-raised text-gold-text">
            <Icon size={16} />
          </span>
          <span className="shrink-0 text-[18px] font-semibold">{title}</span>
          {/* Beside the title, not under it: the line below stays one line, the same height on every card. */}
          {extra && (
            <span className="ml-auto flex min-w-0 justify-end" onClick={(e) => e.stopPropagation()}>
              {extra}
            </span>
          )}
          <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-full bg-gold-gradient text-white transition-transform group-hover:translate-x-0.5', !extra && 'ml-auto')}>
            <ArrowRight size={15} />
          </span>
        </span>
        <span className="truncate text-[13px] text-muted">{sub}</span>
      </span>
    </div>
  );
}

/**
 * One photo of a session's cover stack. A thumbnail that is gone (the cache
 * was cleared, the folder moved) shows a quiet tile, not the browser's
 * broken-image mark.
 */
function Cover({ id, i, v, onMissing }: { id: string | undefined; i: number; v?: number; onMissing: () => void }) {
  const [broken, setBroken] = useState(false);
  const style = { left: i * 9, opacity: i ? 0.75 - i * 0.15 : 1 };
  if (!id || broken)
    return (
      <span className="absolute top-0 flex h-11 w-14 items-center justify-center rounded-md bg-raised text-faint ring-2 ring-panel" style={style}>
        {i === 0 && <ImageIcon size={16} />}
      </span>
    );
  return (
    <img
      // `v` changes once a lost thumbnail is made again: load it afresh.
      src={v ? `${thumbUrl(id)}?v=${v}` : thumbUrl(id)}
      alt=""
      onError={() => (setBroken(true), onMissing())}
      className="absolute top-0 h-11 w-14 rounded-md object-cover ring-2 ring-panel"
      style={style}
    />
  );
}

/**
 * The sessions to carry on with, newest first: open one, find its folder
 * again when it moved, or take it off the list. `only` picks which ones.
 */
function SessionList({ title, empty, only }: { title: string; empty: string; only: (s: SessionSummary) => boolean }) {
  const [all, setSessions] = useState<SessionSummary[] | null>(null);
  const sessions = all?.filter(only) ?? null;
  const openSession = useApp((s) => s.openSession);
  const go = useApp((s) => s.go);

  const [confirming, setConfirming] = useState<string | null>(null);
  // Session clicked whose folder couldn't be found: its card shows what to do.
  const [missing, setMissing] = useState<string | null>(null);

  const reload = () => api.listSessions().then(setSessions, () => setSessions([]));
  const open = async (s: SessionSummary) => {
    // Check again on click: the drive may have been plugged in since the list loaded.
    const fresh = (await api.listSessions().catch(() => null))?.find((x) => x.id === s.id);
    if (fresh && !fresh.available) {
      setSessions((list) => list?.map((x) => (x.id === s.id ? fresh : x)) ?? null);
      setMissing(s.id);
      return;
    }
    setMissing(null);
    if (s.kind === 'edit') {
      // A folder opened only to edit: back to Edit foto's Library with it.
      try {
        useApp.setState({ session: await api.openSession(s.id) });
        go({ name: 'edit', back: { name: 'home' } });
      } catch (e) {
        useApp.getState().fail(e);
      }
      return;
    }
    openSession(s.id);
  };

  // The folder was moved or renamed: let the photographer point to it.
  const [relinkError, setRelinkError] = useState<string | null>(null);
  const relink = async (s: SessionSummary) => {
    const picked = await pickFolder();
    if (!picked) return;
    try {
      const session = await api.relinkSession(s.id, picked);
      setMissing(null);
      setRelinkError(null);
      useApp.setState({ session, selectedId: session.photos[0]?.id ?? null, screen: { name: 'review' } });
    } catch (e) {
      setRelinkError(String(e));
    }
  };
  const fail = useApp((s) => s.fail);

  // Read again when the window comes back and every few seconds: a drive
  // plugged in (or out) shows at once.
  useEffect(() => {
    reload();
    const again = () => document.visibilityState === 'visible' && reload();
    const timer = setInterval(again, 5000);
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, []);

  // Covers whose cache files are gone are made again from the photos, once per session.
  const [restored, setRestored] = useState<Record<string, number>>({});
  const restore = (s: SessionSummary) => {
    if (!s.available || s.id in restored) return;
    setRestored((r) => ({ ...r, [s.id]: 0 }));
    api.restoreThumbs(s.id).then((n) => n > 0 && setRestored((r) => ({ ...r, [s.id]: Date.now() })), () => {});
  };

  const remove = async (id: string) => {
    try {
      await api.deleteSession(id);
      setSessions((list) => list?.filter((x) => x.id !== id) ?? null);
      if (useApp.getState().session?.id === id) useApp.setState({ session: null, selectedId: null });
    } catch (e) {
      fail(e);
    } finally {
      setConfirming(null);
    }
  };

  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {sessions?.length === 0 && (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-faint">
          {empty}
        </p>
      )}
      {sessions?.map((s) =>
        !s.available && missing === s.id ? (
          <div
            key={s.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-line-soft bg-maybe/[0.06] p-3"
          >
            <FolderX size={18} className="shrink-0 text-maybe" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold">{t('Folder “{name}” tidak ditemukan', { name: s.name })}</span>
              <span className="truncate text-xs text-muted">
                {t('Mungkin drive eksternalnya belum tersambung, atau foldernya dipindah / diganti nama.')} {s.root}
              </span>
              {relinkError && <span className="text-xs text-reject">{tRust(relinkError)}</span>}
            </span>
            <Button variant="plain" onClick={() => (setMissing(null), setRelinkError(null))}>
              {t('Tutup')}
            </Button>
            <Button icon={FolderSearch} onClick={() => relink(s)}>
              {t('Cari folder…')}
            </Button>
            <Button icon={Trash2} onClick={() => (setMissing(null), setConfirming(s.id))}>
              {t('Hapus dari daftar')}
            </Button>
            <Button variant="primary" icon={RotateCw} onClick={() => (reload(), open(s))}>
              {t('Coba lagi')}
            </Button>
          </div>
        ) : confirming === s.id ? (
          <div
            key={s.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-reject/60 bg-reject/[0.06] p-3"
          >
            <Trash2 size={18} className="shrink-0 text-reject" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-semibold">{t('Hapus “{name}” dari daftar?', { name: s.name })}</span>
              <span className="text-xs text-muted">
                {t('Hasil pilah dan cache thumbnail dihapus. Foto asli, file XMP, dan folder salinan tidak disentuh.')}
              </span>
            </span>
            <Button variant="plain" onClick={() => setConfirming(null)}>
              {t('Batal')}
            </Button>
            <Button variant="danger" icon={Trash2} onClick={() => remove(s.id)}>
              {t('Hapus')}
            </Button>
          </div>
        ) : (
          <div key={s.id} className="group relative flex items-center">
            <button
              type="button"
              onClick={() => open(s)}
              className="flex min-w-0 flex-1 items-center gap-4 rounded-xl border border-line-soft bg-panel p-3 pr-14 text-left hover:border-line hover:bg-panel-2"
            >
              {/* A small stack of covers: three photos, fanned, in the space of one. */}
              <span className="relative hidden h-11 w-[74px] shrink-0 sm:block">
                {[2, 1, 0].map((i) =>
                  s.covers[i] || i === 0 ? <Cover key={`${i}-${s.available}-${restored[s.id] ?? ''}`} id={s.covers[i]} v={restored[s.id]} i={i} onMissing={() => restore(s)} /> : null,
                )}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold">{s.name}</span>
                  {/* The tag says which mode the session came from. */}
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-gold/10 px-1.5 py-0.5 text-[11px] font-medium text-gold-text">
                    {s.kind === 'edit' ? (
                      <>
                        <SlidersHorizontal size={11} /> {t('Edit foto')}
                      </>
                    ) : (
                      <>
                        <Sparkles size={11} /> {t('Pilih foto##mode')}
                      </>
                    )}
                  </span>
                </span>
                <span className="truncate text-xs text-faint">
                  {t('{date} · {count} foto · diproses {time}', { date: date(s.createdAt), n: s.total, count: num(s.total), time: duration(s.durationMs) })}
                </span>
                <span className="truncate text-xs text-faint">
                  {s.kind === 'edit' ? t('Dibuka untuk diedit · {count} diedit', { n: s.edited ?? 0, count: num(s.edited ?? 0) }) : settingsLine(s.options)}
                </span>
              </span>
              <span className="hidden items-center gap-3.5 text-xs text-muted md:flex">
                <span className="flex items-center gap-1.5">
                  <Dot color={STATUS.pick.color} /> {num(s.picks)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Dot color={STATUS.maybe.color} /> {num(s.maybe)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Dot color={STATUS.reject.color} /> {num(s.rejects)}
                </span>
              </span>
              {!s.available ? (
                <Chip color="var(--color-maybe)" icon={FolderX}>
                  {t('Folder tidak ditemukan')}
                </Chip>
              ) : s.exported ? (
                <Chip color={STATUS.pick.color} icon={Check}>
                  {t('Sudah diekspor')}
                </Chip>
              ) : (
                <Chip color={STATUS.maybe.color} icon={Clock}>
                  {t('Belum diekspor')}
                </Chip>
              )}
              <ChevronRight size={16} className="shrink-0 text-faint" />
            </button>
            {/* Outside the row's button (buttons can't nest); shows on hover or keyboard focus. */}
            <button
              type="button"
              onClick={() => setConfirming(s.id)}
              title={t('Hapus dari daftar')}
              aria-label={t('Hapus {name} dari daftar', { name: s.name })}
              className="absolute right-3 inline-flex size-8 items-center justify-center rounded-lg text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:bg-reject/15 hover:text-reject focus-visible:opacity-100"
            >
              <Trash2 size={15} />
            </button>
          </div>
        ),
      )}
    </section>
  );
}

export function Home({ dragging }: { dragging: boolean }) {
  const go = useApp((s) => s.go);
  const openSession = useApp((s) => s.openSession);
  const [last, setLast] = useState<SessionSummary | null>(null);
  useEffect(() => void lastSession().then(setLast), []);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <main className="flex-1 overflow-y-auto">
        {/* The four modes, each shown at work; two columns fill the window without scrolling (until it gets very short). */}
        <div className="mx-auto flex min-h-full w-full max-w-[1116px] flex-col justify-center gap-5 px-6 py-8 md:h-full md:min-h-[520px] md:py-6 lg:px-0 [@media(max-height:700px)]:gap-4 [@media(max-height:700px)]:py-4">
          <h1 className="text-[26px] font-semibold [@media(max-height:700px)]:text-[22px]">{t('Mau mengerjakan apa?')}</h1>
          <div className="grid grid-cols-1 gap-5 md:max-h-[820px] md:min-h-0 md:flex-1 md:grid-cols-2 md:grid-rows-2">
            <ModeCard art={<BoardArt />} icon={Briefcase} title={t('Kelola Bisnis')} sub={t('Booking klien, jadwal, invoice, dan pesan WhatsApp di satu tempat.')} onClick={() => go({ name: 'bisnis' })} />
            <ModeCard
              highlight={dragging}
              art={<CullArt />}
              icon={Sparkles}
              title={t('Pilih foto##mode')}
              sub={t('Ratusan foto sesi dipilah otomatis jadi Pilih, Cek, dan Lewati.')}
              onClick={() => go({ name: 'pilih' })}
              extra={
                last && (
                  <button type="button" onClick={() => openSession(last.id)} title={`${t('Lanjutkan sesi terakhir')} (⇧⌘O)`} className="flex h-8 max-w-56 min-w-0 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium whitespace-nowrap text-fg hover:border-gold/70">
                    <Play size={12} className="shrink-0 fill-current text-gold-text" />
                    <span className="truncate">{t('Lanjutkan: {name}', { name: last.name })}</span>
                  </button>
                )
              }
            />
            <ModeCard art={<EditArt />} icon={SlidersHorizontal} title={t('Edit foto')} sub={t('Cahaya dan warna ala Lightroom, AI denoise, masking, preset.')} onClick={() => go({ name: 'edit', back: { name: 'home' } })} />
            <ModeCard art={<StoryArt />} icon={LayoutTemplate} title={t('Buat konten')} sub={t('Story dan feed Instagram dari template, langsung dari fotomu.')} onClick={() => go({ name: 'kreasi', back: { name: 'home' } })} />
          </div>
        </div>
      </main>
    </div>
  );
}

/**
 * Pilih foto, before a folder: a new one to cull (picked, or dragged in
 * anywhere), or a session to carry on with.
 */
export function PilihStart({ dragging }: { dragging: boolean }) {
  const go = useApp((s) => s.go);
  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-8 px-6 pt-8 pb-10 lg:px-8">
          <div className="flex items-center gap-3.5">
            <button type="button" onClick={() => go({ name: 'home' })} aria-label={t('Kembali')} className="text-muted hover:text-fg">
              <ArrowLeft size={18} />
            </button>
            <h1 className="text-[20px] font-semibold">{t('Pilih foto##mode')}</h1>
          </div>

          <button
            type="button"
            onClick={() => chooseFolder()}
            className={cx(
              'group flex flex-col items-center gap-4 rounded-[18px] border-[1.5px] border-dashed px-6 py-12 text-center transition-colors',
              dragging ? 'border-gold bg-gold/10' : 'border-line bg-panel hover:border-gold/70 hover:bg-gold/[0.04]',
            )}
          >
            <span className="flex size-14 items-center justify-center rounded-2xl bg-raised text-gold-text">
              <FolderDown size={26} />
            </span>
            <span className="flex flex-col gap-1.5">
              <span className="text-[17px] font-semibold">{dragging ? t('Lepas untuk memilah foto di folder ini') : t('Pilah sesi baru')}</span>
              <span className="text-xs text-muted">{t('Seret folder foto ke sini, atau pilih dari komputer. RAW dan JPEG, semuanya diproses di komputer ini.')}</span>
            </span>
            <span className="flex h-10 items-center gap-2 rounded-[10px] bg-gold-gradient px-4 text-[13px] font-semibold text-white">
              <FolderSearch size={16} /> {t('Pilih folder sesi')} <span className="font-normal opacity-75">⌘O</span>
            </span>
          </button>

          <SessionList
            title={t('Lanjutkan sesi')}
            empty={t('Belum ada sesi. Sesi yang sudah dipilah akan muncul di sini.')}
            only={(s) => s.kind !== 'edit'}
          />
        </div>
      </main>
    </div>
  );
}
