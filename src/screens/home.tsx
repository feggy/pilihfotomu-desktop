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
  LayoutTemplate,
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
  primary,
  highlight,
}: {
  preview: string;
  icon: LucideIcon;
  title: string;
  sub: string;
  tags: string[];
  onClick: () => void;
  primary?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'group flex flex-col gap-3.5 rounded-[18px] border bg-panel p-3 text-left transition-colors',
        highlight ? 'border-2 border-gold bg-raised' : primary ? 'border-gold/70 hover:border-gold' : 'border-line-soft hover:border-line',
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
              primary ? 'bg-gold-gradient' : 'bg-raised',
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

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
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
              primary
              highlight={dragging}
              preview="/home/pilih.jpg"
              icon={Sparkles}
              title={t('Pilih foto##mode')}
              sub={t('Ratusan foto sesi dipilah otomatis jadi Pilih, Cek, dan Lewati, lengkap dengan alasannya.')}
              tags={[t('Offline'), 'RAW & JPEG', '⌘O']}
              onClick={() => chooseFolder()}
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

          <button
            type="button"
            onClick={clientPicks}
            className="-mt-3 flex items-center gap-3 self-start rounded-xl border border-line-soft bg-panel px-3.5 py-2.5 text-left hover:border-line"
          >
            <Clipboard size={16} className="shrink-0 text-gold-text" />
            <span className="text-[13px]">
              <span className="font-medium">{t('Klien kirim daftar foto?')}</span>{' '}
              <span className="text-muted">{t('Tempel pesan WhatsApp-nya, kami carikan fotonya — tanpa perlu dipilah dulu.')}</span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-faint" />
          </button>

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
                        s.covers[i] ? (
                          <img
                            key={i}
                            src={thumbUrl(s.covers[i])}
                            alt=""
                            className="absolute top-0 h-11 w-14 rounded-md object-cover ring-2 ring-panel"
                            style={{ left: i * 9, opacity: i ? 0.75 - i * 0.15 : 1 }}
                          />
                        ) : (
                          i === 0 && <span key={i} className="absolute top-0 left-0 h-11 w-14 rounded-md bg-raised" />
                        ),
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
