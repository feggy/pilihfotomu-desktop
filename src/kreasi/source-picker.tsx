/**
 * Where a design's photos come from, asked plainly: from this computer
 * (photos or a folder) or from a session already in the app.
 */

import { Check, ChevronDown, Folder, ImagePlus, Images } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cx } from '../components/ui';
import { api, thumbUrl, type SessionSummary } from '../lib/api';
import { date, num } from '../lib/format';
import { t } from '../lib/i18n';
import type { Source } from './store';

export interface SourceActions {
  onFiles: () => void;
  onFolder: () => void;
  onSession: (id: string) => void;
}

/** The app's sessions whose folders can be read now, newest first. */
function useSessions() {
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  useEffect(() => {
    api.listSessions().then((list) => setSessions(list.filter((s) => s.available)), () => setSessions([]));
  }, []);
  return sessions;
}

const countLine = (s: SessionSummary) =>
  s.kind === 'edit' ? t('{count} foto', { n: s.total, count: num(s.total) }) : t('{picks} dipilih dari {count} foto', { picks: num(s.picks), n: s.total, count: num(s.total) });

/** No photos yet: the two ways in, side by side. */
export function SourceChooser({ onFiles, onFolder, onSession }: SourceActions) {
  const sessions = useSessions();
  return (
    <div className="mx-auto flex w-full max-w-[820px] flex-col gap-6 py-8">
      <div className="flex flex-col gap-1 text-center">
        <span className="text-lg font-semibold">{t('Foto dari mana?')}</span>
        <span className="text-[13px] text-muted">{t('Pilih foto dari komputer, atau pakai sesi yang sudah ada di aplikasi.')}</span>
      </div>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-[13px] font-semibold">{t('Dari komputer')}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onFiles}
            className="flex items-center gap-3.5 rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-gold/70"
          >
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gold/15 text-gold-text">
              <ImagePlus size={19} />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{t('Pilih foto##isi')}</span>
              <span className="text-xs text-muted">{t('Satu atau beberapa file, RAW atau JPEG')}</span>
            </span>
          </button>
          <button type="button" onClick={onFolder} className="flex items-center gap-3.5 rounded-xl border border-line bg-panel p-4 text-left transition-colors hover:border-gold/70">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-raised text-muted">
              <Folder size={19} />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{t('Pilih folder')}</span>
              <span className="text-xs text-muted">{t('Semua foto di satu folder')}</span>
            </span>
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <h2 className="text-[13px] font-semibold">{t('Dari sesi di aplikasi')}</h2>
        {sessions?.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-5 text-center text-xs text-faint">{t('Belum ada sesi. Foto yang dipilah atau diedit di aplikasi akan muncul di sini.')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {sessions?.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onSession(s.id)}
                className="flex items-center gap-3 rounded-xl border border-line-soft bg-panel p-2.5 text-left transition-colors hover:border-gold/70 hover:bg-panel-2"
              >
                <Cover src={s.covers[0]} className="h-12 w-16" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-semibold">{s.name}</span>
                  <span className="truncate text-[11px] text-faint">
                    {date(s.createdAt)} · {countLine(s)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** The photos in use, and a menu to take them from somewhere else. */
export function SourceMenu({ source, onFiles, onFolder, onSession }: SourceActions & { source: Source }) {
  const [open, setOpen] = useState(false);
  const sessions = useSessions();
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const pick = (fn: () => void) => () => (setOpen(false), fn());
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-raised';
  return (
    <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={t('Ganti sumber foto')}
        className={cx(
          'flex h-[34px] max-w-72 items-center gap-2 rounded-[10px] border bg-panel px-3 text-xs font-medium',
          open ? 'border-gold' : 'border-line hover:border-faint',
        )}
      >
        <Images size={14} className="shrink-0 text-gold-text" />
        <span className="text-faint">{t('Foto dari')}</span>
        <span className="truncate">{source.name}</span>
        <ChevronDown size={14} className="shrink-0 text-faint" />
      </button>
      {open && (
        <div className="absolute top-10 left-0 z-30 flex max-h-[420px] w-80 flex-col gap-0.5 overflow-y-auto rounded-xl border border-line bg-panel-2 p-1.5 shadow-2xl">
          <span className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold text-faint uppercase">{t('Dari komputer')}</span>
          <button type="button" onClick={pick(onFiles)} className={item}>
            <ImagePlus size={15} className="text-gold-text" /> {t('Pilih foto…')}
          </button>
          <button type="button" onClick={pick(onFolder)} className={item}>
            <Folder size={15} className="text-muted" /> {t('Pilih folder…')}
          </button>
          {!!sessions?.length && (
            <>
              <span className="mt-1 border-t border-line-soft px-2.5 pt-2.5 pb-1 text-[11px] font-semibold text-faint uppercase">{t('Dari sesi di aplikasi')}</span>
              {sessions.map((s) => (
                <button key={s.id} type="button" onClick={pick(() => onSession(s.id))} className={item}>
                  <Cover src={s.covers[0]} className="h-7 w-9" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{s.name}</span>
                    <span className="truncate text-[11px] text-faint">{countLine(s)}</span>
                  </span>
                  {s.root === source.root && <Check size={14} className="shrink-0 text-gold-text" />}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A session's first photo; a quiet tile when it has none or it is gone. */
function Cover({ src, className }: { src: string | undefined; className: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken)
    return (
      <span className={cx('flex shrink-0 items-center justify-center rounded-md bg-raised text-faint', className)}>
        <Images size={14} />
      </span>
    );
  return <img src={thumbUrl(src)} alt="" onError={() => setBroken(true)} className={cx('shrink-0 rounded-md object-cover', className)} />;
}
