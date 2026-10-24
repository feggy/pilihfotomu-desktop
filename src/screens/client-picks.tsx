import { open } from '@tauri-apps/plugin-dialog';
import {
  ArrowLeft,
  Check,
  CircleCheck,
  CircleHelp,
  CircleX,
  Folder,
  FolderInput,
  LoaderCircle,
  MessageCircle,
  Plus,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CopyDialog, sourceMix } from '../components/copy-flow';
import { TitleBar } from '../components/title-bar';
import { Button, IconButton, cx } from '../components/ui';
import { api, thumbUrl, type Photo, type PickResult } from '../lib/api';
import { defaultFolders, folderLabel } from '../lib/folders';
import { num } from '../lib/format';
import { t, tj, tRust } from '../lib/i18n';
import { useApp, type Screen } from '../store';

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
const fileName = (p: Photo) => baseName(p.raw ?? p.jpeg ?? p.stem);

export function ClientPicks({
  root,
  back,
  text: pasted = '',
  folders: picked,
}: {
  root: string;
  back: Screen;
  /** Already pasted on the folder's setup page. */
  text?: string;
  /** Subfolders ticked there. */
  folders?: string[];
}) {
  const session = useApp((s) => s.session);
  const go = useApp((s) => s.go);
  const fail = useApp((s) => s.fail);
  const fromSession = session?.root === root ? session : null;

  const [scanned, setScanned] = useState<Photo[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<number, string | null>>({});
  const [text, setText] = useState(pasted);
  const [result, setResult] = useState<PickResult | null>(null);
  const [choice, setChoice] = useState<Record<string, number>>({});
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [quota, setQuota] = useState('');
  const [copying, setCopying] = useState(false);
  const [replyCopied, setReplyCopied] = useState(false);

  // Every photo under the folder, subfolders included (file names only, fast).
  useEffect(() => {
    setScanned(null);
    api.scanPhotos(root).then(setScanned, fail);
  }, [root, fail]);

  // Which folders to search (any depth, each on its own): clients usually
  // pick from the JPGs they were sent, so this is a choice, not "everything".
  const tops = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of scanned ?? []) c.set(p.folder, (c.get(p.folder) ?? 0) + 1);
    return [...c.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  }, [scanned]);
  const [folders, setFolders] = useState<string[] | null>(null);
  useEffect(() => {
    if (scanned && folders == null) setFolders(picked ?? fromSession?.folders ?? defaultFolders(tops.map(([name]) => ({ name }))));
  }, [scanned, folders, picked, fromSession, tops]);

  const photos: Photo[] | null = scanned;
  const searched = (folders ?? []).reduce((n, f) => n + (tops.find(([t]) => t === f)?.[1] ?? 0), 0);
  const byId = useMemo(() => new Map((photos ?? []).map((p) => [p.id, p])), [photos]);
  const sessionThumbs = useMemo(
    () => Object.fromEntries((fromSession?.photos ?? []).map((p) => [p.id, p.thumb])) as Record<number, string | null>,
    [fromSession],
  );
  const thumbOf = (id: number) => sessionThumbs[id] ?? thumbs[id] ?? null;

  // Re-read as the photographer types or pastes; small debounce so a long
  // paste is parsed once.
  useEffect(() => {
    if (!photos || !folders) return;
    const timer = setTimeout(() => {
      if (!text.trim()) return setResult(null);
      api.resolveClientPicks(root, folders, text).then(setResult, fail);
    }, 200);
    return () => clearTimeout(timer);
  }, [text, root, photos, folders, fail]);

  useEffect(() => setReplyCopied(false), [text, choice, added]);

  const chosen = useMemo(() => {
    if (!result) return [] as Photo[];
    const ids = new Set<number>(result.found.map((f) => f.photoId));
    for (const a of result.ambiguous) ids.add(choice[a.query] ?? a.candidates[0]);
    for (const id of added) ids.add(id);
    return [...ids].map((id) => byId.get(id)!).filter(Boolean);
  }, [result, choice, added, byId]);

  // Thumbnails only for what's on screen, made on demand.
  useEffect(() => {
    if (!result) return;
    const want = new Set<number>([
      ...chosen.map((p) => p.id),
      ...result.ambiguous.flatMap((a) => a.candidates),
      ...result.notFound.flatMap((n) => n.suggestions),
    ]);
    const missing = [...want].filter((id) => !(id in thumbs) && !sessionThumbs[id]);
    if (!missing.length) return;
    setThumbs((t) => ({ ...t, ...Object.fromEntries(missing.map((id) => [id, null])) }));
    // '' marks a file whose preview couldn't be read, so it stops pulsing.
    api
      .thumbnails(root, missing)
      .then((got) => setThumbs((t) => ({ ...t, ...Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v ?? ''])) })), fail);
  }, [result, chosen, root, sessionThumbs, thumbs, fail]);

  const limit = Number(quota) || 0;
  const over = limit > 0 && chosen.length > limit;

  const changeFolder = async () => {
    const picked = await open({ directory: true, title: t('Pilih folder sesi') });
    if (typeof picked === 'string') {
      setText('');
      setResult(null);
      setThumbs({});
      setFolders(null);
      go({ name: 'picks', root: picked, back });
    }
  };

  const reply = async () => {
    const names = chosen.map((p) => p.stem).join(', ');
    const missing = result?.notFound.map((n) => n.query) ?? [];
    const lines = [t('Halo kak, pilihan fotonya sudah kami terima: {count} foto.', { n: chosen.length, count: num(chosen.length) }), names];
    if (missing.length) lines.push(t('Nomor ini tidak kami temukan, boleh dicek lagi ya kak: {list}', { list: missing.join(', ') }));
    if (over) lines.push(t('Catatan: paket kakak mencakup {count} foto edit.', { n: limit, count: num(limit) }));
    await navigator.clipboard.writeText(lines.join('\n\n'));
    setReplyCopied(true);
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar title={baseName(root)} />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-line-soft bg-panel p-5 xl:w-[420px] xl:p-6">
          <div className="flex items-center gap-3">
            <IconButton icon={ArrowLeft} label={t('Kembali')} onClick={() => go(back)} />
            <h1 className="text-lg font-semibold">{t('Tempel pilihan klien')}</h1>
          </div>
          <p className="-mt-1 text-xs text-muted">
            {t('Tempel pesan apa adanya. Kata-kata, emoji, dan salah ketik kecil kami abaikan.')}
          </p>
          <div className="flex items-center gap-2.5 rounded-[10px] bg-panel-2 p-2.5">
            <Folder size={16} className="shrink-0 text-gold-text" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-xs font-semibold">{baseName(root)}</span>
              <span className="text-[11px] text-faint">
                {photos ? t('{count} foto dicari', { n: searched, count: num(searched) }) : t('Membaca folder…')}
                {fromSession ? ` · ${t('sesi yang sudah dipilah')}` : ''}
              </span>
            </div>
            <button type="button" onClick={changeFolder} className="shrink-0 text-xs font-medium text-gold-text hover:underline">
              {t('Ganti folder')}
            </button>
          </div>
          {tops.length > 1 && folders && (
            <div className="-mt-1.5 flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-faint">{t('Cari di folder')}</span>
              <div className="flex flex-wrap gap-1.5">
                {tops.map(([name, n]) => {
                  const on = folders.includes(name);
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFolders((f) => (on ? (f ?? []).filter((x) => x !== name) : [...(f ?? []), name]))}
                      className={cx(
                        'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs',
                        on ? 'border-gold/60 bg-gold/10 font-medium text-gold-text' : 'border-line text-muted hover:text-fg',
                      )}
                    >
                      {on && <Check size={12} />}
                      {folderLabel(name)}
                      <span className="text-faint">{num(n)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          <textarea
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!photos}
            placeholder={t('kak ini pilihan aku ya\nIMG_0101, 0104, 0107\n0125-0134\njpg 141 sama 0146')}
            className="min-h-[200px] resize-y rounded-xl border border-gold/70 bg-bg p-3.5 font-mono text-[13px] leading-6 outline-none placeholder:text-faint focus:border-gold disabled:opacity-50"
          />
          {result && result.readAs.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-[10px] bg-panel-2 p-3">
              <span className="text-[11px] font-semibold text-faint">{t('Terbaca sebagai')}</span>
              <div className="flex flex-wrap gap-1.5">
                {result.readAs.map((t, i) => (
                  <span key={i} className="rounded-md bg-raised px-2 py-0.5 font-mono text-[11px]">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {result?.warnings.map((w) => (
            <p key={w} className="flex gap-2 text-xs text-maybe">
              <TriangleAlert size={14} className="shrink-0" /> {tRust(w)}
            </p>
          ))}
          <div className="flex-1" />
          <label className="flex items-center justify-between gap-3 text-xs text-muted">
            {t('Kuota foto edit di paket (opsional)')}
            <input
              value={quota}
              onChange={(e) => setQuota(e.target.value.replace(/\D/g, ''))}
              inputMode="numeric"
              placeholder="50"
              className="h-8 w-20 rounded-lg border border-line bg-bg px-2 text-right text-[13px] outline-none focus:border-gold"
            />
          </label>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-5 xl:p-6">
          {!photos ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-faint">
              <LoaderCircle size={18} className="animate-spin" /> {t('Membaca folder…')}
            </div>
          ) : photos.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-faint">
              <TriangleAlert size={26} />
              <p className="text-sm">{t('Folder ini tidak berisi foto RAW atau JPEG.')}</p>
              <Button onClick={changeFolder}>{t('Pilih folder lain')}</Button>
            </div>
          ) : result && result.readAs.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-faint">
              <TriangleAlert size={26} className="text-maybe" />
              <p className="text-sm text-muted">{t('Tidak ada nomor foto atau nama file yang terbaca.')}</p>
              <p className="max-w-[400px] text-xs">
                {t('Tulis nomor (IMG_0101, 0104, 110-115) atau nama file seperti di folder (boleh sebagian, minimal 6 huruf/angka), satu per baris atau dipisah koma.')}
              </p>
            </div>
          ) : !result ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-faint">
              <MessageCircle size={28} />
              <p className="text-sm">{t('Tempel pesan dari klien di kolom kiri.')}</p>
              <p className="max-w-[380px] text-xs">
                {tj('Bisa nomor (“IMG_0101, 0104, 110-115, jpg 141”) atau nama file lengkap maupun sebagian. Dicocokkan dengan file di folder {folder}.', {
                  folder: <span className="text-muted">{baseName(root)}</span>,
                })}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <Summary icon={CircleCheck} n={result.found.length} label={t('Ditemukan')} color="var(--color-pick)" />
                <Summary icon={CircleHelp} n={result.ambiguous.length} label={t('Perlu dipilih')} color="var(--color-maybe)" />
                <Summary icon={CircleX} n={result.notFound.length} label={t('Tidak ditemukan')} color="var(--color-reject)" />
                <div className="flex flex-col justify-center gap-1.5 rounded-xl bg-panel p-3">
                  <span className="flex justify-between text-[11px] text-muted">
                    {limit ? t('Kuota paket') : t('Total dipilih')}
                    <b className={cx('font-semibold', over ? 'text-reject' : 'text-fg')}>
                      {num(chosen.length)}
                      {limit ? ` / ${num(limit)}` : ''}
                    </b>
                  </span>
                  {limit > 0 && (
                    <span className="h-1.5 overflow-hidden rounded-full bg-line">
                      <span
                        className={cx('block h-full rounded-full', over ? 'bg-reject' : 'bg-gold')}
                        style={{ width: `${Math.min(100, (chosen.length / limit) * 100)}%` }}
                      />
                    </span>
                  )}
                </div>
              </div>

              {result.ambiguous.map((a) => (
                <div key={a.query} className="flex flex-col gap-2.5 rounded-xl border border-maybe bg-panel p-3.5">
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    <CircleHelp size={15} className="text-maybe" />
                    {t('“{query}” ada di {n} foto. Yang mana?', { query: a.query, n: a.candidates.length })}
                  </span>
                  <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
                    {a.candidates.map((id) => {
                      const p = byId.get(id)!;
                      const on = (choice[a.query] ?? a.candidates[0]) === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setChoice((c) => ({ ...c, [a.query]: id }))}
                          className={cx(
                            'flex items-center gap-2.5 rounded-[10px] border p-2 text-left',
                            on ? 'border-gold bg-gold/10' : 'border-line bg-panel-2 hover:border-faint',
                          )}
                        >
                          <Thumb src={thumbOf(id)} className="h-10 w-[60px]" />
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-xs font-semibold">{fileName(p)}</span>
                            <span className="truncate text-[11px] text-faint">{p.folder || t('Folder utama')}</span>
                          </span>
                          <span className={cx('size-4 shrink-0 rounded-full border-[1.5px]', on ? 'border-gold bg-gold' : 'border-faint')} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {result.notFound.map((n) => (
                <div key={n.query} className="flex flex-col gap-2.5 rounded-xl border border-reject bg-panel p-3.5">
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    <CircleX size={15} className="text-reject" />
                    {t('“{query}” tidak ada di folder ini', { query: n.query })}
                  </span>
                  {n.suggestions.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted">{t('Mungkin maksudnya:')}</span>
                      {n.suggestions.map((id) => {
                        const p = byId.get(id)!;
                        const on = added.has(id);
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() =>
                              setAdded((s) => {
                                const next = new Set(s);
                                if (on) next.delete(id);
                                else next.add(id);
                                return next;
                              })
                            }
                            className={cx(
                              'flex items-center gap-2 rounded-lg border py-1 pr-2.5 pl-1',
                              on ? 'border-gold bg-gold/10' : 'border-line bg-panel-2 hover:border-faint',
                            )}
                          >
                            <Thumb src={thumbOf(id)} className="h-7 w-10" />
                            <span className="text-xs font-medium">{p.stem}</span>
                            {on ? <Check size={13} className="text-gold-text" /> : <Plus size={13} className="text-faint" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}

              {chosen.length > 0 && (
                <section className="flex flex-col gap-2.5">
                  <h2 className="text-[13px] font-semibold text-muted">
                    {t('Dipilih · {count} foto', { n: chosen.length, count: num(chosen.length) })}
                    {chosen.some((p) => p.raw && p.jpeg) && (
                      <span className="font-normal text-faint"> · {t('RAW ikut dengan JPG pasangannya')}</span>
                    )}
                  </h2>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
                    {chosen.map((p) => (
                      <div key={p.id} className="flex flex-col gap-1">
                        <Thumb src={thumbOf(p.id)} className="aspect-[3/2] w-full" />
                        <span className="truncate text-[11px] text-faint">{p.stem}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <div className="flex-1" />
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <Button icon={replyCopied ? Check : MessageCircle} onClick={reply} disabled={!chosen.length}>
                  {replyCopied ? t('Balasan tersalin') : t('Salin balasan WhatsApp')}
                </Button>
                <Button variant="primary" icon={FolderInput} onClick={() => setCopying(true)} disabled={!chosen.length}>
                  {t('Salin {count} foto ke folder…', { n: chosen.length, count: num(chosen.length) })}
                </Button>
              </div>
            </>
          )}
        </main>
      </div>
      {copying && (
        <CopyDialog
          root={root}
          ids={chosen.map((p) => p.id)}
          mix={sourceMix(chosen)}
          base={t('Pilihan Klien')}
          onClose={() => setCopying(false)}
        />
      )}
    </div>
  );
}

function Summary({ icon: Icon, n, label, color }: { icon: LucideIcon; n: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl p-3" style={{ background: `color-mix(in srgb, ${color} 10%, var(--color-panel))` }}>
      <Icon size={18} style={{ color }} />
      <span className="flex flex-col">
        <span className="text-lg font-semibold tabular-nums">{num(n)}</span>
        <span className="text-[11px] text-muted">{label}</span>
      </span>
    </div>
  );
}

/** `null` = still loading, `''` = no preview available. */
function Thumb({ src, className }: { src: string | null; className?: string }) {
  return src ? (
    <img src={thumbUrl(src)} alt="" className={cx('shrink-0 rounded-md bg-raised object-cover', className)} />
  ) : (
    <span className={cx('shrink-0 rounded-md bg-raised', src === null && 'animate-pulse', className)} />
  );
}
