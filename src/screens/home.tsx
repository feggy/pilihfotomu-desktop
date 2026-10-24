import { open } from '@tauri-apps/plugin-dialog';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clipboard,
  Clock,
  FolderDown,
  FolderSearch,
  FolderX,
  Image as ImageIcon,
  LayoutTemplate,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { TitleBar } from '../components/title-bar';
import { Button, Chip, Dot, cx } from '../components/ui';
import { api, thumbUrl, type SessionSummary } from '../lib/api';
import { date, duration, num, STATUS } from '../lib/format';
import { t, tRust } from '../lib/i18n';
import { useApp } from '../store';

const pickFolder = async () => {
  const picked = await open({ directory: true, title: t('Pilih folder sesi') });
  return typeof picked === 'string' ? picked : null;
};

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

/** "Selamat pagi" … by the clock on this computer. */
function greeting() {
  const h = new Date().getHours();
  return h < 11 ? t('Selamat pagi') : h < 15 ? t('Selamat siang') : h < 18 ? t('Selamat sore') : t('Selamat malam');
}

/** One of the three things the app does, as a big card with a picture of it. */
function ModeCard({
  preview,
  icon: Icon,
  title,
  sub,
  tags,
  onClick,
  highlight,
}: {
  preview: string;
  icon: LucideIcon;
  title: string;
  sub: string;
  tags: string[];
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'group flex flex-col gap-3.5 rounded-[18px] border bg-panel p-3 text-left transition-colors outline-none',
        // Gold only while pointed at (or a folder is dragged over): a click opens the mode, nothing stays selected.
        highlight ? 'border-2 border-gold bg-raised' : 'border-line-soft hover:border-gold/70 focus-visible:border-gold/70',
      )}
    >
      <img src={preview} alt="" className="aspect-[296/196] w-full rounded-xl object-cover" draggable={false} />
      <span className="flex flex-col gap-1.5 px-1.5">
        <span className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2.5">
            <span className="flex size-[30px] items-center justify-center rounded-lg bg-raised text-gold-text">
              <Icon size={16} />
            </span>
            <span className="text-[17px] font-semibold">{title}</span>
          </span>
          <span
            className={cx(
              'flex size-[30px] items-center justify-center rounded-full text-white transition-transform group-hover:translate-x-0.5',
              'bg-raised group-hover:bg-gold-gradient',
            )}
          >
            <ArrowRight size={15} />
          </span>
        </span>
        <span className="text-xs text-muted">{sub}</span>
      </span>
      <span className="mx-1.5 h-px bg-line-soft" />
      <span className="flex flex-wrap gap-1.5 px-1.5 pb-0.5">
        {tags.map((tag) => (
          <span key={tag} className="rounded-md bg-panel-2 px-1.5 py-0.5 text-[10px] text-faint">
            {tag}
          </span>
        ))}
      </span>
    </button>
  );
}

/**
 * One photo of a session's cover stack. A thumbnail that is gone (the cache
 * was cleared, the folder moved) shows a quiet tile, not the browser's
 * broken-image mark.
 */
function Cover({ id, i }: { id: string | undefined; i: number }) {
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
      src={thumbUrl(id)}
      alt=""
      onError={() => setBroken(true)}
      className="absolute top-0 h-11 w-14 rounded-md object-cover ring-2 ring-panel"
      style={style}
    />
  );
}

function SourceOption({ icon: Icon, title, sub, hint, onClick }: { icon: LucideIcon; title: string; sub: string; hint?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col gap-2.5 rounded-[14px] border border-line-soft bg-panel-2 p-4 text-left transition-colors outline-none hover:border-gold/70 focus-visible:border-gold/70"
    >
      <span className="flex items-center justify-between">
        <span className="flex size-[34px] items-center justify-center rounded-lg bg-raised text-gold-text">
          <Icon size={17} />
        </span>
        <ArrowRight size={15} className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
      </span>
      <span className="text-[15px] font-semibold">{title}</span>
      <span className="text-xs text-muted">{sub}</span>
      {hint && <span className="text-[11px] text-faint">{hint}</span>}
    </button>
  );
}

export function Home({ dragging }: { dragging: boolean }) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const openSession = useApp((s) => s.openSession);
  const go = useApp((s) => s.go);

  const [confirming, setConfirming] = useState<string | null>(null);
  // Session whose folder couldn't be found when clicked.
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

  useEffect(() => {
    api.listSessions().then(setSessions, () => setSessions([]));
  }, []);

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

  // Client picks only need the file names in a folder — no analysis first.
  const clientPicks = async () => {
    const root = await pickFolder();
    if (root) go({ name: 'picks', root, back: { name: 'home' } });
  };
  // "Pilih foto" starts from either the whole session or the client's list.
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    if (!choosing) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setChoosing(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choosing]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      {choosing && (
        <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={() => setChoosing(false)}>
          <div
            role="dialog"
            aria-label={t('Mulai dari mana?')}
            onMouseDown={(e) => e.stopPropagation()}
            className="flex w-[560px] max-w-full flex-col gap-5 rounded-[18px] border border-line bg-panel p-6 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold">{t('Mulai dari mana?')}</h2>
                <p className="text-xs text-muted">{t('Pilah semua foto sesi, atau langsung cari foto yang diminta klien.')}</p>
              </div>
              <button type="button" onClick={() => setChoosing(false)} aria-label={t('Tutup')} className="text-muted hover:text-fg">
                <X size={18} />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <SourceOption
                icon={Sparkles}
                title={t('Pilah folder sesi')}
                sub={t('AI memilah semua foto jadi Pilih, Cek, dan Lewati.')}
                hint={t('Atau seret folder ke jendela')}
                onClick={() => (setChoosing(false), chooseFolder())}
              />
              <SourceOption
                icon={Clipboard}
                title={t('Dari pesan klien')}
                sub={t('Tempel pesan WhatsApp berisi nomor foto, kami carikan filenya — tanpa dipilah dulu.')}
                onClick={() => (setChoosing(false), clientPicks())}
              />
            </div>
          </div>
        </div>
      )}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-7 px-6 pt-10 pb-10 lg:px-8 lg:pt-12">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] text-gold-text">{greeting()}</span>
              <h1 className="text-2xl font-semibold lg:text-[28px]">{t('Mau mengerjakan apa hari ini?')}</h1>
            </div>
            <span
              className={cx(
                'flex items-center gap-2 rounded-[10px] border px-3 py-2 text-xs',
                dragging ? 'border-gold bg-gold/10 text-gold-text' : 'border-line-soft bg-panel text-muted',
              )}
            >
              <FolderDown size={15} /> {dragging ? t('Lepas untuk memilah foto di folder ini') : t('Seret folder ke mana saja di jendela ini')}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:gap-5">
            <ModeCard
              highlight={dragging}
              preview="/home/pilih.jpg"
              icon={Sparkles}
              title={t('Pilih foto##mode')}
              sub={t('Ratusan foto sesi dipilah otomatis jadi Pilih, Cek, dan Lewati, lengkap dengan alasannya.')}
              tags={[t('Offline'), 'RAW & JPEG', '⌘O']}
              onClick={() => setChoosing(true)}
            />
            <ModeCard
              preview="/home/edit.jpg"
              icon={SlidersHorizontal}
              title={t('Edit foto')}
              sub={t('Atur cahaya dan warna ala Lightroom, dengan AI denoise, masking, dan preset.')}
              tags={[t('Preset Lightroom'), 'XMP']}
              onClick={() => go({ name: 'edit', back: { name: 'home' } })}
            />
            <ModeCard
              preview="/home/konten.jpg"
              icon={LayoutTemplate}
              title={t('Buat konten')}
              sub={t('Story dan feed Instagram dari template. Pilih template, isi fotonya, selesai.')}
              tags={['Story 9:16', 'Feed 4:5', '1:1']}
              onClick={() => go({ name: 'kreasi', back: { name: 'home' } })}
            />
          </div>

          <section className="flex flex-col gap-2.5">
            <h2 className="text-sm font-semibold">{t('Sesi terakhir')}</h2>
            {sessions?.length === 0 && (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-faint">
                {t('Belum ada sesi. Sesi yang sudah dipilah akan muncul di sini.')}
              </p>
            )}
            {sessions?.map((s) =>
              missing === s.id ? (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-maybe/60 bg-maybe/[0.06] p-3"
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
                        s.covers[i] || i === 0 ? <Cover key={i} id={s.covers[i]} i={i} /> : null,
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-sm font-semibold">{s.name}</span>
                      <span className="truncate text-xs text-faint">
                        {t('{date} · {count} foto · diproses {time}', { date: date(s.createdAt), n: s.total, count: num(s.total), time: duration(s.durationMs) })}
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
        </div>
      </main>
    </div>
  );
}
