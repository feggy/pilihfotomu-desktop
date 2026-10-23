import { open } from '@tauri-apps/plugin-dialog';
import { Check, ChevronRight, Clipboard, Clock, Folder, FolderOpen, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { TitleBar } from '../components/title-bar';
import { Button, Chip, Dot } from '../components/ui';
import { api, thumbUrl, type SessionSummary } from '../lib/api';
import { date, duration, num, STATUS } from '../lib/format';
import { useApp } from '../store';

const pickFolder = async () => {
  const picked = await open({ directory: true, title: 'Pilih folder sesi' });
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

export function Home({ dragging }: { dragging: boolean }) {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const openSession = useApp((s) => s.openSession);
  const go = useApp((s) => s.go);

  const [confirming, setConfirming] = useState<string | null>(null);
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
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-8 px-6 pt-10 pb-10 lg:px-8 lg:pt-14">
          <div className="flex items-center gap-4">
            <img src="/brand-icon.png" alt="" className="size-12 rounded-[14px]" />
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold lg:text-[28px]">Mulai sesi baru</h1>
              <p className="text-sm text-muted">Pilih folder sesi, biar pilihfotomu yang memilah foto terbaiknya.</p>
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row">
            <button
              type="button"
              onClick={() => chooseFolder()}
              className={
                'flex min-h-[200px] flex-1 flex-col items-center justify-center gap-3.5 rounded-2xl border bg-panel p-6 transition-colors lg:h-[220px] ' +
                (dragging ? 'border-2 border-gold bg-raised' : 'border-gold/70 hover:border-gold')
              }
            >
              <span className="flex size-14 items-center justify-center rounded-2xl bg-gold/15 text-gold-text">
                <FolderOpen size={26} />
              </span>
              <span className="text-base font-semibold">{dragging ? 'Lepas untuk membuka folder' : 'Seret folder sesi ke sini'}</span>
              <span className="text-center text-xs text-faint">RAW Canon, Nikon, Sony, Fujifilm · JPEG</span>
              <span className="mt-1 inline-flex h-[34px] items-center gap-2 rounded-[10px] bg-gold-gradient px-3.5 font-medium text-white">
                <Folder size={15} /> Pilih folder &amp; pilah otomatis
              </span>
            </button>

            <div className="flex flex-col gap-2.5 rounded-2xl border border-line-soft bg-panel p-5 lg:h-[220px] lg:w-[300px]">
              <span className="flex size-10 items-center justify-center rounded-xl bg-raised text-gold-text">
                <Clipboard size={20} />
              </span>
              <h2 className="text-[15px] font-semibold">Klien kirim daftar foto?</h2>
              <p className="text-xs text-muted">
                Pilih folder sesinya, lalu tempel pesan WhatsApp klien. Kami carikan dan kumpulkan fotonya — tanpa perlu
                dipilah dulu.
              </p>
              <div className="flex-1" />
              <Button icon={Clipboard} className="self-start" onClick={clientPicks}>
                Tempel pilihan klien
              </Button>
            </div>
          </div>

          <section className="flex flex-col gap-2.5">
            <h2 className="text-sm font-semibold">Sesi terakhir</h2>
            {sessions?.length === 0 && (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-xs text-faint">
                Belum ada sesi. Sesi yang sudah dipilah akan muncul di sini.
              </p>
            )}
            {sessions?.map((s) =>
              confirming === s.id ? (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-reject/60 bg-reject/[0.06] p-3"
                >
                  <Trash2 size={18} className="shrink-0 text-reject" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-semibold">Hapus “{s.name}” dari daftar?</span>
                    <span className="text-xs text-muted">
                      Hasil pilah dan cache thumbnail dihapus. Foto asli, file XMP, dan folder salinan tidak disentuh.
                    </span>
                  </span>
                  <Button variant="plain" onClick={() => setConfirming(null)}>
                    Batal
                  </Button>
                  <Button variant="danger" icon={Trash2} onClick={() => remove(s.id)}>
                    Hapus
                  </Button>
                </div>
              ) : (
                <div key={s.id} className="group relative flex items-center">
                  <button
                    type="button"
                    onClick={() => openSession(s.id)}
                    className="flex min-w-0 flex-1 items-center gap-4 rounded-xl border border-line-soft bg-panel p-3 pr-14 text-left hover:border-line hover:bg-panel-2"
                  >
                    <span className="hidden gap-1 sm:flex">
                      {[0, 1, 2].map((i) =>
                        s.covers[i] ? (
                          <img key={i} src={thumbUrl(s.covers[i])} alt="" className="h-12 w-16 rounded-md object-cover" />
                        ) : (
                          <span key={i} className="h-12 w-16 rounded-md bg-raised" />
                        ),
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="truncate text-sm font-semibold">{s.name}</span>
                      <span className="truncate text-xs text-faint">
                        {date(s.createdAt)} · {num(s.total)} foto · diproses {duration(s.durationMs)}
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
                    {s.exported ? (
                      <Chip color={STATUS.pick.color} icon={Check}>
                        Sudah diekspor
                      </Chip>
                    ) : (
                      <Chip color={STATUS.maybe.color} icon={Clock}>
                        Belum diekspor
                      </Chip>
                    )}
                    <ChevronRight size={16} className="shrink-0 text-faint" />
                  </button>
                  {/* Outside the row's button (buttons can't nest); shows on hover or keyboard focus. */}
                  <button
                    type="button"
                    onClick={() => setConfirming(s.id)}
                    title="Hapus dari daftar"
                    aria-label={`Hapus ${s.name} dari daftar`}
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
