import { useVirtualizer } from '@tanstack/react-virtual';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  Camera,
  Clipboard,
  Crown,
  Cpu,
  Eye,
  FolderSearch,
  ImageOff,
  Layers,
  PanelRight,
  Search,
  Sparkles,
  SunMedium,
  Upload,
  X,
  type LucideIcon,
  Smile,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { TitleBar } from '../components/title-bar';
import { Button, Chip, Dot, IconButton, Kbd, StatusBadge, Stars, STATUS_ICON, cx } from '../components/ui';
import { thumbUrl, type PhotoEntry, type Status } from '../lib/api';
import { clock, duration, eyeSummary,
  smileSummary as smileOf,
  hasSmile, num, REASON, STATUS, toneColor, type ReasonKind } from '../lib/format';
import { actionFor, useKey, type Action } from '../lib/keys';
import { useApp } from '../store';
import { ExportDialog } from './export-dialog';
import { Loupe } from './loupe';

/**
 * Which camera a photo came from: the EXIF model; else the file-name prefix
 * when the name ends in a frame number (IMG_0101 → "IMG_…"); else unknown.
 * Names like "Gemini_Generated_Image_x" have no number, so their "prefix" is
 * the whole name and would make one camera per file.
 */
const cameraOf = (p: PhotoEntry) =>
  p.camera ?? (p.number != null && /^[A-Za-z_]{1,6}$/.test(p.prefix) ? `File ${p.prefix}…` : 'Tanpa info kamera');

type Tab = 'all' | Status;
const STATUS_OF: Partial<Record<Action, Status>> = { pick: 'pick', maybe: 'maybe', reject: 'reject' };


const CARD_MIN = 190;
const GAP = 12;
const CARD_INFO_H = 34;

export function Review() {
  const session = useApp((s) => s.session)!;
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const setStatus = useApp((s) => s.setStatus);
  const setRating = useApp((s) => s.setRating);
  const go = useApp((s) => s.go);

  const [tab, setTab] = useState<Tab>('all');
  const [reason, setReason] = useState<ReasonKind | null>(null);
  const [camera, setCamera] = useState<string | null>(null);
  const [onlySmiles, setOnlySmiles] = useState(false);
  const [details, setDetails] = useState(false);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [exporting, setExporting] = useState(false);
  // File › Ekspor… in the menu bar.
  useEffect(() => {
    const open = () => setExporting(true);
    window.addEventListener('pfm:export', open);
    return () => window.removeEventListener('pfm:export', open);
  }, []);

  const photos = session.photos;
  const counts = useMemo(() => {
    const c = { all: photos.length, pick: 0, maybe: 0, reject: 0 };
    for (const p of photos) c[p.status]++;
    return c;
  }, [photos]);
  const reasonCounts = useMemo(() => {
    const c = {} as Record<ReasonKind, number>;
    for (const p of photos) for (const r of p.reasons) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [photos]);
  const cameras = useMemo(() => {
    const c = new Map<string, number>();
    for (const p of photos) c.set(cameraOf(p), (c.get(cameraOf(p)) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [photos]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return photos.filter(
      (p) =>
        (tab === 'all' || p.status === tab) &&
        (!reason || p.reasons.some((r) => r.kind === reason)) &&
        (!camera || cameraOf(p) === camera) &&
        (!onlySmiles || hasSmile(p)) &&
        (!q || p.name.toLowerCase().includes(q)),
    );
  }, [photos, tab, reason, camera, onlySmiles, query]);
  const smileCount = useMemo(() => photos.filter(hasSmile).length, [photos]);
  const filtered = !!(reason || camera || onlySmiles || query.trim());
  const clearFilters = () => {
    setReason(null);
    setCamera(null);
    setOnlySmiles(false);
    setQuery('');
    setSearching(false);
  };

  // ── Grid geometry ───────────────────────────────────────────────
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const inner = Math.max(0, width - 40);
  const cols = Math.max(1, Math.floor((inner + GAP) / (CARD_MIN + GAP)));
  const cardW = cols ? (inner - GAP * (cols - 1)) / cols : CARD_MIN;
  const rowH = cardW * (2 / 3) + CARD_INFO_H + GAP;
  const rows = Math.ceil(visible.length / cols);
  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowH,
    overscan: 4,
  });
  useEffect(() => virtualizer.measure(), [rowH, virtualizer]);

  const selected = photos.find((p) => p.id === selectedId) ?? null;
  const index = visible.findIndex((p) => p.id === selectedId);

  const moveTo = (i: number) => {
    if (!visible.length) return;
    const clamped = Math.max(0, Math.min(visible.length - 1, i));
    select(visible[clamped].id);
    virtualizer.scrollToIndex(Math.floor(clamped / cols), { align: 'auto' });
  };

  // ── Keyboard culling ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The loupe and dialogs handle their own keys; so does any screen
      // shown over this one (it stays mounted underneath to keep its place).
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || exporting || lightbox) return;
      if (useApp.getState().screen.name !== 'review') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const action = actionFor(k);
      const mark = action && STATUS_OF[action];
      if (mark && selected) {
        e.preventDefault();
        setStatus([selected.id], mark);
        // Lightroom-style auto-advance, unless the photo is about to leave the filtered view.
        if (tab === 'all' || tab === mark) moveTo(index + 1);
        return;
      }
      if (/^[0-5]$/.test(k) && selected) {
        e.preventDefault();
        setRating([selected.id], Number(k));
        return;
      }
      const step: Record<string, number> = { arrowright: 1, arrowleft: -1, arrowdown: cols, arrowup: -cols };
      if (step[k] != null) {
        e.preventDefault();
        moveTo(index < 0 ? 0 : index + step[k]);
      } else if (k === ' ' && selected) {
        e.preventDefault();
        // A focused button would also be "clicked" by Space on key-up.
        (document.activeElement as HTMLElement | null)?.blur();
        setLightbox(true);
      } else if (k === 'escape') {
        setDetails(false);
      } else if (action === 'compare' && selected?.group != null) {
        go({ name: 'compare', group: selected.group });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const total = counts.all || 1;
  const kPick = useKey('pick');
  const kMaybe = useKey('maybe');
  const kReject = useKey('reject');
  const kCompare = useKey('compare');

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        title={session.name}
        right={
          <>
            <button
              type="button"
              onClick={() => go({ name: 'picks', root: session.root, back: { name: 'review' } })}
              title="Tempel daftar foto pilihan klien dari WhatsApp"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 text-xs font-medium text-fg hover:bg-line"
            >
              <Clipboard size={13} className="text-muted" /> Pilihan klien
            </button>
            <button
            type="button"
            onClick={() => setExporting(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-gold-gradient px-2.5 text-xs font-semibold text-white"
          >
            <Upload size={13} /> Ekspor
          </button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        {/* ── Sidebar ── */}
        <aside className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line-soft bg-panel p-3 xl:w-60">
          <div className="flex flex-col gap-1 rounded-[10px] bg-panel-2 p-3">
            <span className="truncate text-sm font-semibold">{session.name}</span>
            <span className="text-xs text-faint">{num(counts.all)} foto</span>
            <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-line">
              {(['pick', 'maybe', 'reject'] as const).map((s) => (
                <span key={s} style={{ width: `${(counts[s] / total) * 100}%`, background: STATUS[s].color }} />
              ))}
            </div>
          </div>
          <SideTitle>Saring: alasan AI</SideTitle>
          {(Object.keys(REASON) as ReasonKind[])
            .filter((k) => reasonCounts[k])
            .map((k) => (
              <SideRow
                key={k}
                icon={REASON[k].icon}
                color={toneColor(REASON[k].tone)}
                label={REASON[k].label}
                count={reasonCounts[k]}
                active={reason === k}
                onClick={() => setReason(reason === k ? null : k)}
              />
            ))}
          {Object.keys(reasonCounts).length === 0 && <p className="px-2.5 py-1 text-xs text-faint">Tidak ada catatan.</p>}
          {smileCount > 0 && (
            <>
              <SideTitle>Saring: ekspresi</SideTitle>
              <SideRow
                icon={Smile}
                label="Ada yang tersenyum"
                count={smileCount}
                active={onlySmiles}
                onClick={() => setOnlySmiles((v) => !v)}
              />
            </>
          )}
          {cameras.length > 1 && (
            <>
              <SideTitle>Saring: kamera</SideTitle>
              {cameras.map(([c, n]) => (
                <SideRow
                  key={c}
                  icon={Camera}
                  label={c}
                  count={n}
                  active={camera === c}
                  onClick={() => setCamera(camera === c ? null : c)}
                />
              ))}
            </>
          )}
          {filtered && (
            <button type="button" onClick={clearFilters} className="mx-2.5 mt-2 self-start text-xs font-medium text-gold-text hover:underline">
              Hapus semua filter
            </button>
          )}
          <div className="flex-1" />
          <div className="flex items-center gap-2.5 rounded-[10px] bg-panel-2 p-2.5">
            <Cpu size={16} className="shrink-0 text-pick" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">Selesai dalam {duration(session.durationMs)}</span>
              <span className="text-[11px] text-faint">Diproses offline di perangkat ini</span>
            </div>
          </div>
        </aside>

        {/* ── Center ── */}
        <section className="@container flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-4 @3xl:px-5">
            <div className="flex shrink-0 gap-1 rounded-[10px] bg-panel p-[3px]">
              {(['all', 'pick', 'maybe', 'reject'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={cx(
                    'flex h-[30px] items-center gap-2 rounded-lg px-3 text-[13px]',
                    tab === t ? 'border border-line bg-raised font-semibold text-fg' : 'font-medium text-muted hover:text-fg',
                  )}
                >
                  {t !== 'all' && <Dot color={STATUS[t].color} />}
                  {t === 'all' ? 'Semua' : STATUS[t].label}
                  <span className="hidden text-xs font-normal text-faint tabular-nums @[52rem]:inline">{num(counts[t])}</span>
                </button>
              ))}
            </div>
            {/* Search gives way first when the window is narrow; buttons never get cut. */}
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2.5">
              {searching ? (
                <label className="flex h-[34px] w-64 min-w-24 shrink items-center gap-2 rounded-[10px] border border-line bg-panel px-3 focus-within:border-gold">
                  <Search size={15} className="shrink-0 text-faint" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Escape' && (setQuery(''), setSearching(false))}
                    placeholder="Cari nama file…"
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint focus-visible:outline-none"
                  />
                  <button type="button" onClick={() => (setQuery(''), setSearching(false))} aria-label="Tutup pencarian" className="shrink-0">
                    <X size={14} className="text-faint" />
                  </button>
                </label>
              ) : (
                <IconButton icon={Search} label="Cari nama file" onClick={() => setSearching(true)} />
              )}
              <IconButton
                icon={PanelRight}
                label={details ? 'Tutup detail foto' : 'Detail foto'}
                onClick={() => setDetails((v) => !v)}
                className={cx('xl:hidden', details && 'border-gold text-gold-text')}
              />
            </div>
          </div>

          {filtered && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft bg-gold/[0.06] px-5 py-2 text-xs">
              <span className="text-muted">
                Menampilkan <b className="font-semibold text-fg">{num(visible.length)}</b> dari {num(counts[tab === 'all' ? 'all' : tab])} foto
              </span>
              {camera && <FilterChip label={`Kamera: ${camera}`} onClear={() => setCamera(null)} />}
              {reason && <FilterChip label={`Alasan: ${REASON[reason].label}`} onClear={() => setReason(null)} />}
              {onlySmiles && <FilterChip label="Ada yang tersenyum" onClear={() => setOnlySmiles(false)} />}
              {query.trim() && <FilterChip label={`Nama: “${query.trim()}”`} onClear={() => (setQuery(''), setSearching(false))} />}
              <button type="button" onClick={clearFilters} className="ml-auto font-medium text-gold-text hover:underline">
                Tampilkan semua
              </button>
            </div>
          )}
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center gap-3 p-10 text-center text-sm text-faint">
                Tidak ada foto di filter ini.
                {filtered && <Button onClick={clearFilters}>Hapus filter</Button>}
              </div>
            ) : (
              <div className="relative mx-5 my-5" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((row) => (
                  <div
                    key={row.key}
                    className="absolute inset-x-0 flex"
                    style={{ top: row.start, height: rowH - GAP, gap: GAP }}
                  >
                    {visible.slice(row.index * cols, row.index * cols + cols).map((p) => (
                      <Card
                        key={p.id}
                        photo={p}
                        width={cardW}
                        selected={p.id === selectedId}
                        onSelect={() => select(p.id)}
                        onOpen={() => (select(p.id), setLightbox(true))}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ── Inspector: a column on wide windows, a drawer on narrow ones ── */}
        <div
          className={cx(
            'z-20 shrink-0 xl:static xl:flex',
            details ? 'absolute top-24 right-0 bottom-[30px] flex shadow-2xl' : 'hidden',
          )}
        >
          <Inspector photo={selected} session={photos} onCompare={(g) => go({ name: 'compare', group: g })} />
        </div>
      </div>

      <footer className="flex h-[30px] shrink-0 items-center justify-between border-t border-line-soft bg-panel px-4 text-[11px] text-faint">
        <span className="flex items-center gap-3.5">
          {[
            [kPick, 'Pick'],
            [kMaybe, 'Maybe'],
            [kReject, 'Reject'],
            ['1-5', 'Bintang'],
            ['← →', 'Pindah'],
            ['Space', 'Perbesar'],
            [kCompare, 'Bandingkan burst'],
          ].map(([k, l]) => (
            <span key={k} className="flex items-center gap-1.5">
              <Kbd>{k}</Kbd>
              {l}
            </span>
          ))}
        </span>
        <span>
          {num(counts.pick)} dipilih{index >= 0 ? ` · ${num(index + 1)} dari ${num(visible.length)}` : ''}
        </span>
      </footer>

      {lightbox && selected && (
        <Loupe
          photos={visible}
          root={session.root}
          onClose={() => {
            setLightbox(false);
            if (index >= 0) virtualizer.scrollToIndex(Math.floor(index / cols), { align: 'auto' });
          }}
          onCompare={(g) => go({ name: 'compare', group: g })}
        />
      )}
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
    </div>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-gold/50 bg-gold/10 pr-1 pl-2.5 font-medium text-gold-text">
      {label}
      <button type="button" onClick={onClear} aria-label={`Hapus filter ${label}`} className="rounded-full p-0.5 hover:bg-gold/20">
        <X size={12} />
      </button>
    </span>
  );
}

function SideTitle({ children }: { children: string }) {
  return <div className="px-2.5 pt-3.5 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{children}</div>;
}

function SideRow({
  icon: Icon,
  label,
  count,
  color = 'var(--color-muted)',
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  color?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? 'Klik lagi untuk menampilkan semua' : `Tampilkan hanya ${label}`}
      className={cx(
        'flex h-8 items-center justify-between gap-2 rounded-lg px-2.5',
        active ? 'bg-gold/10 ring-1 ring-gold/60' : 'hover:bg-panel-2',
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon size={15} style={{ color }} className="shrink-0" />
        <span className={cx('truncate text-[13px]', active ? 'font-medium text-fg' : 'text-muted')}>{label}</span>
      </span>
      {active ? <X size={13} className="shrink-0 text-gold-text" /> : <span className="text-xs text-faint tabular-nums">{num(count)}</span>}
    </button>
  );
}

function Card({
  photo: p,
  width,
  selected,
  onSelect,
  onOpen,
}: {
  photo: PhotoEntry;
  width: number;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  // Only a photo that wasn't picked gets a reason on the card — it says why.
  // Everything else is detail for the side panel and the loupe.
  const main = p.status === 'pick' ? null : p.reasons.find((r) => r.kind !== 'bestInGroup');
  const best = p.reasons.some((r) => r.kind === 'bestInGroup');
  return (
    <button
      type="button"
      onClick={onSelect}
      onDoubleClick={onOpen}
      style={{ width }}
      className={cx(
        'flex shrink-0 flex-col overflow-hidden rounded-[10px] bg-panel-2 text-left',
        selected ? 'ring-2 ring-gold' : 'ring-1 ring-line-soft hover:ring-line',
      )}
    >
      <div className="relative aspect-[3/2] w-full bg-raised">
        {p.thumb ? (
          <img
            src={thumbUrl(p.thumb)}
            alt=""
            loading="lazy"
            decoding="async"
            className={cx('size-full object-cover', p.status === 'reject' && 'opacity-55')}
          />
        ) : (
          <span className="flex size-full items-center justify-center text-faint" title={p.error ?? undefined}>
            <ImageOff size={22} />
          </span>
        )}
        <span className="absolute top-2 left-2">
          <StatusBadge status={p.status} />
        </span>
        {(main || p.error) && (
          <span className="absolute bottom-2 left-2 max-w-[calc(100%-16px)]">
            {main ? (
              <span
                className="inline-flex h-[22px] items-center gap-1 rounded-md bg-bg/80 px-2 text-[11px] font-medium backdrop-blur"
                style={{ color: toneColor(REASON[main.kind].tone) }}
              >
                {(() => {
                  const Icon = REASON[main.kind].icon;
                  return <Icon size={12} />;
                })()}
                {REASON[main.kind].label}
              </span>
            ) : (
              <span className="inline-flex h-[22px] items-center rounded-md bg-bg/80 px-2 text-[11px] text-maybe backdrop-blur">
                Tidak bisa dibaca
              </span>
            )}
          </span>
        )}
      </div>
      <div className="flex flex-col px-2.5 py-2">
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {best && <Crown size={12} className="shrink-0 text-gold-text" aria-label="Terbaik di grup" />}
            <span className="truncate text-[11px] font-medium">{p.name}</span>
          </span>
          <Stars value={p.rating} size={9} />
        </span>
      </div>
    </button>
  );
}

function Inspector({
  photo,
  session,
  onCompare,
}: {
  photo: PhotoEntry | null;
  session: PhotoEntry[];
  onCompare: (group: number) => void;
}) {
  const keys = { pick: useKey('pick'), maybe: useKey('maybe'), reject: useKey('reject') };
  const setStatus = useApp((s) => s.setStatus);
  const select = useApp((s) => s.select);
  if (!photo) {
    return <aside className="w-80 shrink-0 border-l border-line-soft bg-panel" />;
  }
  const m = photo.metrics;
  const siblings = photo.group != null ? session.filter((p) => p.group === photo.group) : [];
  const exposure =
    !m ? null : m.brightness < 35 || m.shadowsClipped > 0.45 ? ['Gelap', 'maybe'] : m.brightness > 225 || m.highlightsClipped > 0.3 ? ['Terang', 'maybe'] : ['Normal', 'pick'];
  const sharpTone = !m ? 'maybe' : m.sharpness >= 42 ? 'pick' : m.sharpness >= 25 ? 'maybe' : 'reject';
  const file = photo.raw ?? photo.jpeg;
  const eyes = eyeSummary(photo);
  const changed = photo.status !== photo.autoStatus;

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-3.5 overflow-y-auto border-l border-line-soft bg-panel p-4">
      <div className="aspect-[3/2] w-full overflow-hidden rounded-[10px] bg-raised">
        {photo.thumb && <img src={thumbUrl(photo.thumb)} alt="" className="size-full object-contain" />}
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[15px] font-semibold">{photo.name}</span>
          <Stars value={photo.rating} size={12} />
        </div>
        <span className="text-[11px] text-faint">
          {[photo.folder || null, photo.jpeg && photo.raw ? 'RAW + JPG' : null, clock(photo.takenAt)].filter(Boolean).join(' · ') ||
            '—'}
        </span>
      </div>
      <div className="flex gap-1.5">
        {(['pick', 'maybe', 'reject'] as const).map((st) => {
          const Icon = STATUS_ICON[st];
          const on = photo.status === st;
          return (
            <button
              key={st}
              type="button"
              onClick={() => setStatus([photo.id], st)}
              className={cx(
                'flex h-[34px] flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold',
                on ? 'text-bg' : 'border border-line bg-raised text-fg hover:bg-line',
              )}
              style={on ? { background: STATUS[st].color } : undefined}
            >
              <Icon size={14} style={on ? undefined : { color: STATUS[st].color }} strokeWidth={2.5} />
              {STATUS[st].one}
              <span className={on ? 'opacity-70' : 'text-faint'}>{keys[st]}</span>
            </button>
          );
        })}
      </div>
      {changed && (
        <p className="-mt-1.5 text-[11px] text-faint">
          Diubah manual. Saran AI: <span style={{ color: STATUS[photo.autoStatus].color }}>{STATUS[photo.autoStatus].one}</span>
        </p>
      )}

      <div className="flex flex-col gap-0.5 rounded-[10px] bg-panel-2 p-3">
        <span className="flex items-center gap-2 pb-1.5 text-xs font-semibold">
          <Sparkles size={14} className="text-gold-text" /> Kenapa AI menilai begini
        </span>
        {photo.error ? (
          <p className="text-xs text-maybe">File tidak bisa dibaca: {photo.error}</p>
        ) : (
          m && (
            <>
              <Metric icon={Sparkles} label="Ketajaman" value={`${Math.round(m.sharpness)}%`} tone={sharpTone} />
              <Metric icon={SunMedium} label="Eksposur" value={exposure![0]} tone={exposure![1] as Status} />
              {eyes && <Metric icon={Eye} label="Mata" value={eyes.label} tone={eyes.tone} />}
              {smileOf(photo) && <Metric icon={Smile} label="Ekspresi" value={smileOf(photo)!.label} tone={null} />}
              {photo.reasons.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-2">
                  <div className="flex flex-wrap gap-1.5">
                    {photo.reasons.map((r, i) => (
                      <Chip key={i} color={toneColor(REASON[r.kind].tone)} icon={REASON[r.kind].icon}>
                        {REASON[r.kind].label}
                      </Chip>
                    ))}
                  </div>
                  {photo.reasons.map(
                    (r) =>
                      r.kind === 'duplicate' && (
                        <span key="dup" className="text-[11px] text-faint">
                          Mirip {session.find((p) => p.id === r.of)?.name ?? 'foto lain'} yang lebih tajam.
                        </span>
                      ),
                  )}
                </div>
              )}
            </>
          )
        )}
      </div>

      {siblings.length > 1 && photo.group != null && (
        <div className="flex flex-col gap-2 rounded-[10px] bg-panel-2 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-xs font-semibold">
              <Layers size={14} className="text-gold-text" /> Grup burst · {siblings.length} foto
            </span>
            <button type="button" onClick={() => onCompare(photo.group!)} className="text-xs font-medium text-gold-text hover:underline">
              Bandingkan
            </button>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            {siblings.slice(0, 8).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => select(s.id)}
                className={cx('aspect-[3/2] overflow-hidden rounded-md bg-raised', s.id === photo.id ? 'ring-2 ring-gold' : 'opacity-60 ring-1 ring-line hover:opacity-100')}
              >
                {s.thumb && <img src={thumbUrl(s.thumb)} alt="" className="size-full object-cover" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {file && (
        <Button icon={FolderSearch} className="self-start" onClick={() => revealItemInDir(file)}>
          Tampilkan di {navigator.userAgent.includes('Mac') ? 'Finder' : 'Explorer'}
        </Button>
      )}
    </aside>
  );
}

/** `tone` null = information only: no coloured dot, which would read as a verdict. */
function Metric({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: Status | 'gold' | null }) {
  return (
    <div className="flex h-[30px] items-center justify-between">
      <span className="flex items-center gap-2 text-xs text-muted">
        <Icon size={14} className="text-faint" /> {label}
      </span>
      <span className="flex items-center gap-1.5 text-xs font-medium">
        {tone && <Dot color={toneColor(tone)} size={6} />}
        {value}
      </span>
    </div>
  );
}
