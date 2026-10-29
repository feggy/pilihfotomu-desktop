/**
 * Kelola orang: the people the AI grouped by face, put right by hand. A
 * person can be named, merged with another who is really the same person,
 * and faces put with the wrong person split off or moved. Each person's
 * own eye and sharpness cut-offs follow, so the photos are decided again.
 */

import { Merge, Split, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { api, thumbUrl, type Face, type PhotoEntry } from '../lib/api';
import { everyoneOf, facesOf, num, PERSON_MIN, personName, type Person } from '../lib/format';
import { t } from '../lib/i18n';
import { useApp } from '../store';
import { Select } from './select';
import { Button, Switch, cx } from './ui';

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
              // Reading again shows its progress in Review; this closes.
              onReread={() => (useApp.getState().rereadFaces(), onClose())}
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
  onReread,
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
  onReread: () => void;
}) {
  const faces = useMemo(() => facesOf(photos, person.id), [photos, person.id]);
  // Least alike first: faces put with the wrong person come to the top.
  // One pose taken again and again is one tile (its least alike frame
  // shown), unless opened up; ticking the tile ticks them all.
  const [stack, setStack] = useState(true);
  const items = useMemo(() => {
    const groups = new Map<string, typeof faces>();
    for (const f of faces) {
      const run = f.photo.series ?? (f.photo.group != null ? `b${f.photo.group}` : null);
      const k = stack && run != null ? `s${run}` : `f${f.photo.id}:${f.index}`;
      groups.set(k, [...(groups.get(k) ?? []), f]);
    }
    const alike = (f: (typeof faces)[number]) => f.face.likeness ?? 2;
    return [...groups.values()]
      .map((members) => ({ members, shown: members.reduce((a, b) => (alike(b) < alike(a) ? b : a)) }))
      .sort((a, b) => alike(a.shown) - alike(b.shown) || a.shown.photo.id - b.shown.photo.id);
  }, [faces, stack]);
  const sorted = faces.some((f) => f.face.likeness != null);
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);
  const saveName = () => draft.trim() !== name && onName(draft);
  const [mergeInto, setMergeInto] = useState<number | ''>('');
  // Faces ticked to split off or move, as "photo:index".
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState<number | ''>('');
  const keyOf = (photo: number, index: number) => `${photo}:${index}`;
  const keysOf = (i: number) => items[i]!.members.map((f) => keyOf(f.photo.id, f.index));
  const isOn = (i: number) => keysOf(i).every((k) => picked.has(k));
  const setItems = (list: number[], on: boolean) =>
    setPicked((s) => {
      const keys = list.flatMap(keysOf);
      if (keys.every((k) => s.has(k) === on)) return s;
      const next = new Set(s);
      keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
      return next;
    });

  // Press on a face and drag across others: they all take the state the first
  // one took. Near the grid's top or bottom it scrolls on its own. Shift-click
  // ticks the whole run from the last face clicked.
  const grid = useRef<HTMLDivElement>(null);
  const paint = useRef<{ on: boolean; x: number; y: number } | null>(null);
  const last = useRef<number | null>(null);
  const press = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0 || busy) return;
    e.preventDefault();
    if (e.shiftKey && last.current != null) {
      const [a, b] = [Math.min(last.current, i), Math.max(last.current, i)];
      setItems(Array.from({ length: b - a + 1 }, (_, j) => a + j), true);
      last.current = i;
      return;
    }
    const on = !isOn(i);
    setItems([i], on);
    last.current = i;
    paint.current = { on, x: e.clientX, y: e.clientY };
  };
  useEffect(() => {
    let frame = 0;
    const move = (e: PointerEvent) => {
      if (paint.current) Object.assign(paint.current, { x: e.clientX, y: e.clientY });
    };
    const up = () => (paint.current = null);
    const tick = () => {
      const p = paint.current;
      const box = grid.current;
      if (p && box) {
        const r = box.getBoundingClientRect();
        const edge = 48;
        if (p.y < r.top + edge) box.scrollTop -= Math.ceil((r.top + edge - p.y) / 4);
        else if (p.y > r.bottom - edge) box.scrollTop += Math.ceil((p.y - (r.bottom - edge)) / 4);
        const el = (document.elementFromPoint(p.x, p.y) as HTMLElement | null)?.closest<HTMLElement>('[data-face]');
        if (el && box.contains(el)) setItems([Number(el.dataset.face)], p.on);
      }
      frame = requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    frame = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      cancelAnimationFrame(frame);
    };
  }, [items]);
  const move = (to: number | null) => {
    onMove([...picked].map((k) => k.split(':').map(Number) as [number, number]), to);
    setPicked(new Set());
    setMoveTo('');
  };
  const options = others.map((x) => ({ value: String(x.id), label: label(x.id), note: t('{count} foto', { n: x.photos, count: num(x.photos) }) }));

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
              <Select
                value={String(mergeInto)}
                onChange={(v) => setMergeInto(v === '' ? '' : Number(v))}
                disabled={busy}
                placeholder={t('Pilih orang…')}
                className="!w-48 font-normal"
                options={options}
              />
              <Button icon={Merge} onClick={() => mergeInto !== '' && onMerge(mergeInto)} disabled={busy || mergeInto === ''}>
                {t('Gabungkan')}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 px-6 pt-4 pb-2">
        <span className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold">{t('{count} wajah', { n: faces.length, count: num(faces.length) })}</span>
          <span className="text-[11px] text-faint">{sorted ? t('paling tidak mirip di atas') : ''}</span>
        </span>
        <label className="flex items-center gap-2 text-xs text-muted">
          {t('Ringkas foto beruntun')}
          <Switch label={t('Ringkas foto beruntun')} checked={stack} onChange={setStack} />
        </label>
      </div>
      <p className="shrink-0 px-6 pb-2 text-[11px] text-faint">
        {t('Klik atau seret melewati wajah yang bukan orang ini (Shift+klik untuk rentang), lalu pisahkan atau pindahkan.')}
        {!sorted && (
          <>
            {' '}
            {t('Untuk mengurutkan dari yang paling tidak mirip, baca ulang wajah sesi ini sekali (nama dan koreksi orang ikut diulang).')}{' '}
            <button type="button" onClick={onReread} disabled={busy} className="font-medium text-gold-text hover:underline">
              {t('Baca ulang wajah')}
            </button>
          </>
        )}
      </p>
      <div ref={grid} className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-3 overflow-y-auto px-6 pb-4 select-none">
        {items.map(({ members, shown: { photo, face, index } }, i) => {
          const on = isOn(i);
          const more = members.length - 1;
          return (
            <button
              key={keyOf(photo.id, index)}
              type="button"
              data-face={i}
              onPointerDown={(e) => press(e, i)}
              // The keyboard still ticks one at a time (a click from a key has no detail).
              onClick={(e) => e.detail === 0 && (setItems([i], !on), (last.current = i))}
              disabled={busy}
              title={more ? t('{name} dan {n} foto beruntun', { name: photo.name, n: more }) : photo.name}
              aria-pressed={on}
              className="flex flex-col items-center gap-1.5 rounded-xl p-1.5 hover:bg-panel-2"
            >
              <span className="relative">
                {more > 0 && <span className="absolute -top-1 -right-1 size-[72px] rounded-full bg-raised ring-1 ring-line" />}
                <FaceAvatar photo={photo} face={face} size={72} className={cx('relative ring-offset-2 ring-offset-panel', on ? 'opacity-60 ring-2 ring-reject' : '')} />
                {more > 0 && (
                  <span className="absolute right-0 bottom-0 rounded-full bg-bg px-1.5 py-px text-[10px] font-semibold text-fg ring-1 ring-line">+{more}</span>
                )}
              </span>
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
              <Select
                value={String(moveTo)}
                onChange={(v) => setMoveTo(v === '' ? '' : Number(v))}
                disabled={busy}
                placeholder={t('Pindahkan ke…')}
                className="!w-40"
                options={options}
              />
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

/**
 * "Semua n orang" in Review's filters: everyone at once as a grid of faces,
 * searchable by name, in a panel floating beside the button — the sidebar
 * keeps its short list.
 */
export function PeoplePicker({
  anchor,
  people,
  photos,
  names,
  active,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  people: Person[];
  photos: PhotoEntry[];
  names: Record<string, string> | undefined;
  active: number | null;
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [noPick, setNoPick] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const q = query.trim().toLowerCase();
  const shown = people.filter((x) => (!noPick || x.picks === 0) && (!q || personName(photos, names, x.id).toLowerCase().includes(q)));
  const height = 460;
  const top = Math.max(56, Math.min(anchor.top - 120, window.innerHeight - height - 16));
  return (
    <div className="fixed inset-0 z-40" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={t('Semua orang')}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ left: anchor.right + 12, top, height }}
        className="absolute flex w-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[0_24px_60px_rgb(0_0_0/0.5)]"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-line-soft p-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('Cari nama…')}
            className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 text-[13px] outline-none placeholder:text-faint focus:border-gold"
          />
          <button
            type="button"
            onClick={() => setNoPick((v) => !v)}
            className={cx('h-8 shrink-0 rounded-lg px-2.5 text-xs font-medium', noPick ? 'bg-maybe/15 text-maybe ring-1 ring-maybe/50' : 'text-muted hover:text-fg')}
          >
            {t('Belum ada Pilih')}
          </button>
          <button type="button" onClick={onClose} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={16} />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-4 gap-1 overflow-y-auto p-2">
          {shown.map((x) => (
            <button
              key={x.id}
              type="button"
              onClick={() => onPick(x.id)}
              className={cx('flex flex-col items-center gap-1 rounded-xl p-2', active === x.id ? 'bg-raised ring-1 ring-gold' : 'hover:bg-panel-2')}
            >
              <FaceAvatar photo={x.cover} face={x.face} size={52} />
              <span className={cx('w-full truncate text-center text-xs', names?.[x.id] ? 'font-medium' : 'text-muted')}>{personName(photos, names, x.id)}</span>
              <span
                title={t('{picks} foto Pilih dari {count} foto orang ini', { picks: num(x.picks), n: x.photos, count: num(x.photos) })}
                className={cx('text-[11px]', x.picks === 0 ? 'text-maybe' : 'text-faint')}
              >
                {num(x.picks)}/{num(x.photos)}
              </span>
            </button>
          ))}
          {shown.length === 0 && <p className="col-span-4 py-10 text-center text-xs text-faint">{t('Tidak ada yang cocok.')}</p>}
        </div>
      </div>
    </div>
  );
}
