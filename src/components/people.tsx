/**
 * Kelola orang: the people the AI grouped by face, put right by hand. A
 * person can be named, merged with another who is really the same person,
 * and faces put with the wrong person split off or moved. Each person's
 * own eye and sharpness cut-offs follow, so the photos are decided again.
 */

import { Merge, Split, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { api, thumbUrl, type Face, type PhotoEntry } from '../lib/api';
import { everyoneOf, facesOf, num, PERSON_MIN, personName, type Person } from '../lib/format';
import { t } from '../lib/i18n';
import { useApp } from '../store';
import { Button, cx } from './ui';

/** A person's face cut from a photo. */
export function FaceAvatar({ photo, face, size = 20, className }: { photo: PhotoEntry; face: Face; size?: number; className?: string }) {
  const url = thumbUrl(photo.thumb);
  // A square around the face, a little loose. Face boxes are about square
  // in pixels, so their own w : h gives the photo's shape.
  const w = Math.min(1, face.w * 1.4);
  const h = Math.min(1, w * (face.h / face.w));
  const left = Math.min(Math.max(face.x + face.w / 2 - w / 2, 0), 1 - w);
  const top = Math.min(Math.max(face.y + face.h / 2 - h / 2, 0), 1 - h);
  return (
    <span
      className={cx('block shrink-0 rounded-full bg-line', className)}
      style={{
        width: size,
        height: size,
        backgroundImage: url ? `url("${url}")` : undefined,
        backgroundSize: `${100 / w}% ${100 / h}%`,
        backgroundPosition: `${w < 1 ? (left / (1 - w)) * 100 : 0}% ${h < 1 ? (top / (1 - h)) * 100 : 0}%`,
      }}
    />
  );
}

export function PeopleDialog({ start, onClose }: { start?: number | null; onClose: () => void }) {
  const session = useApp((s) => s.session)!;
  const editPeople = useApp((s) => s.editPeople);
  const photos = session.photos;
  const names = session.people;
  const everyone = useMemo(() => everyoneOf(photos), [photos]);
  const often = everyone.filter((x) => x.photos >= PERSON_MIN);
  const rare = everyone.filter((x) => x.photos < PERSON_MIN);
  const [showRare, setShowRare] = useState(false);
  const [id, setId] = useState<number | null>(start ?? everyone[0]?.id ?? null);
  // Gone once all their faces moved away: the first person instead.
  const person = everyone.find((x) => x.id === id) ?? everyone[0] ?? null;
  const label = (x: number) => personName(photos, names, x);

  const [busy, setBusy] = useState(false);
  const run = async (call: () => Promise<Awaited<ReturnType<typeof api.namePerson>>>) => {
    setBusy(true);
    await editPeople(call);
    setBusy(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-6" onMouseDown={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-label={t('Kelola orang')}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-[min(680px,100%)] w-[920px] max-w-full flex-col overflow-hidden rounded-[18px] border border-line bg-panel shadow-2xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-6 border-b border-line-soft px-6 py-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">{t('Kelola orang')}</h2>
            <p className="text-xs text-faint">
              {t('AI mengelompokkan wajah yang mirip, dan bisa keliru. Beri nama, gabungkan orang yang sama, atau pisahkan wajah yang bukan orangnya.')}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <nav className="flex w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line-soft p-2.5">
            {often.map((x) => (
              <PersonRow key={x.id} person={x} label={label(x.id)} named={!!names?.[x.id]} active={x.id === id} onClick={() => setId(x.id)} />
            ))}
            {rare.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowRare((v) => !v)}
                  className="mt-2 px-2 py-1.5 text-left text-[11px] font-semibold tracking-wide text-faint uppercase hover:text-fg"
                >
                  {showRare ? t('Sembunyikan yang jarang muncul') : t('Jarang muncul ({n})', { n: num(rare.length) })}
                </button>
                {showRare &&
                  rare.map((x) => (
                    <PersonRow key={x.id} person={x} label={label(x.id)} named={!!names?.[x.id]} active={x.id === id} onClick={() => setId(x.id)} />
                  ))}
              </>
            )}
          </nav>

          {person ? (
            <PersonDetail
              key={person.id}
              person={person}
              photos={photos}
              name={names?.[person.id] ?? ''}
              placeholder={label(person.id)}
              others={everyone.filter((x) => x.id !== person.id)}
              label={label}
              busy={busy}
              onName={(name) => run(() => api.namePerson(person.id, name))}
              onMerge={(into) => run(() => api.mergePeople(person.id, into)).then(() => setId(into))}
              onMove={(faces, to) => run(() => api.moveFaces(faces, to))}
            />
          ) : (
            <p className="m-auto text-sm text-faint">{t('Belum ada wajah yang dikenali di sesi ini.')}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonRow({ person, label, named, active, onClick }: { person: Person; label: string; named: boolean; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left', active ? 'bg-raised' : 'hover:bg-panel-2')}
    >
      <FaceAvatar photo={person.cover} face={person.face} size={30} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cx('truncate text-[13px]', active && 'font-semibold', !named && 'text-muted')}>{label}</span>
        <span className="text-[11px] text-faint">{t('{count} foto', { n: person.photos, count: num(person.photos) })}</span>
      </span>
    </button>
  );
}

function PersonDetail({
  person,
  photos,
  name,
  placeholder,
  others,
  label,
  busy,
  onName,
  onMerge,
  onMove,
}: {
  person: Person;
  photos: PhotoEntry[];
  name: string;
  placeholder: string;
  others: Person[];
  label: (id: number) => string;
  busy: boolean;
  onName: (name: string) => void;
  onMerge: (into: number) => void;
  onMove: (faces: [number, number][], to: number | null) => void;
}) {
  const faces = useMemo(() => facesOf(photos, person.id), [photos, person.id]);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const saveName = () => draft.trim() !== name && onName(draft);
  const [mergeInto, setMergeInto] = useState<number | ''>('');
  // Faces ticked to split off or move, as "photo:index".
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState<number | ''>('');
  const keyOf = (photo: number, index: number) => `${photo}:${index}`;
  const toggle = (k: string) => setPicked((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set([...s, k])));
  const move = (to: number | null) => {
    onMove([...picked].map((k) => k.split(':').map(Number) as [number, number]), to);
    setPicked(new Set());
    setMoveTo('');
  };
  const options = others.map((x) => (
    <option key={x.id} value={x.id}>
      {label(x.id)} · {t('{count} foto', { n: x.photos, count: num(x.photos) })}
    </option>
  ));

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-end gap-4 border-b border-line-soft px-6 py-4">
        <FaceAvatar photo={person.cover} face={person.face} size={56} />
        <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs font-medium text-muted">
          {t('Nama')}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            placeholder={placeholder}
            disabled={busy}
            className="h-9 rounded-[10px] border border-line bg-bg px-3 text-[13px] font-normal text-fg outline-none placeholder:text-faint focus:border-gold"
          />
        </label>
        {others.length > 0 && (
          <div className="flex flex-col gap-1 text-xs font-medium text-muted">
            {t('Orang yang sama dengan')}
            <div className="flex gap-2">
              <select
                value={mergeInto}
                onChange={(e) => setMergeInto(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={busy}
                className="h-9 w-48 rounded-[10px] border border-line bg-bg px-2 text-[13px] font-normal text-fg outline-none"
              >
                <option value="">{t('Pilih orang…')}</option>
                {options}
              </select>
              <Button icon={Merge} onClick={() => mergeInto !== '' && onMerge(mergeInto)} disabled={busy || mergeInto === ''}>
                {t('Gabungkan')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-4 pb-2">
        <span className="text-[13px] font-semibold">{t('{count} wajah', { n: faces.length, count: num(faces.length) })}</span>
        <span className="text-[11px] text-faint">{t('Klik wajah yang bukan orang ini, lalu pisahkan atau pindahkan.')}</span>
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3 overflow-y-auto px-6 pb-4">
        {faces.map(({ photo, face, index }) => {
          const k = keyOf(photo.id, index);
          const on = picked.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              disabled={busy}
              title={photo.name}
              aria-pressed={on}
              className="flex flex-col items-center gap-1.5 rounded-xl p-1.5 hover:bg-panel-2"
            >
              <FaceAvatar photo={photo} face={face} size={72} className={cx('ring-offset-2 ring-offset-panel', on ? 'opacity-60 ring-2 ring-reject' : '')} />
              <span className={cx('w-full truncate text-center text-[11px]', on ? 'text-reject' : 'text-faint')}>{photo.name}</span>
            </button>
          );
        })}
      </div>

      {picked.size > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t border-line-soft bg-panel-2 px-6 py-3">
          <span className="mr-auto truncate text-[13px] text-muted">{t('{count} wajah dipilih', { n: picked.size, count: num(picked.size) })}</span>
          <Button variant="plain" onClick={() => setPicked(new Set())} disabled={busy}>
            {t('Batal')}
          </Button>
          {others.length > 0 && (
            <>
              <select
                value={moveTo}
                onChange={(e) => setMoveTo(e.target.value === '' ? '' : Number(e.target.value))}
                disabled={busy}
                className="h-9 w-40 rounded-[10px] border border-line bg-bg px-2 text-[13px] text-fg outline-none"
              >
                <option value="">{t('Pindahkan ke…')}</option>
                {options}
              </select>
              <Button onClick={() => moveTo !== '' && move(moveTo)} disabled={busy || moveTo === ''}>
                {t('Pindahkan')}
              </Button>
            </>
          )}
          <Button variant="primary" icon={Split} onClick={() => move(null)} disabled={busy}>
            {t('Jadikan orang baru')}
          </Button>
        </div>
      )}
    </div>
  );
}
