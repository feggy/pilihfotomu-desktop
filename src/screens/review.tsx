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
  UserRound,
  Check,
  Columns2,
  Hand,
  SlidersHorizontal,
  Star,
  ChartPie,
  Images,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { TitleBar } from '../components/title-bar';
import { Button, Chip, Dot, IconButton, Kbd, StatusBadge, Stars, STATUS_ICON, cx } from '../components/ui';
import { isManual, thumbUrl, type PhotoEntry, type ShootType, type Status, type Strictness } from '../lib/api';
import { clock, duration, eyeSummary,
  smileSummary as smileOf,
  hasSmile, num, REASON, STATUS, toneColor, type ReasonKind } from '../lib/format';
import { t, tj, tRust, useLang } from '../lib/i18n';
import { actionFor, useKey, type Action } from '../lib/keys';
import { GENERAL, SHOOT_TYPES, shootRule } from '../lib/shoot';
import { useApp } from '../store';
import { ExportDialog } from './export-dialog';
import { Loupe } from './loupe';
import { SummaryDialog } from './summary';

/**
 * Which camera a photo came from: the EXIF model; else the file-name prefix
 * when the name ends in a frame number (IMG_0101 → "IMG_…"); else unknown.
 * Names like "Gemini_Generated_Image_x" have no number, so their "prefix" is
 * the whole name and would make one camera per file.
 */
const cameraOf = (p: PhotoEntry) =>
  p.camera ?? (p.number != null && /^[A-Za-z_]{1,6}$/.test(p.prefix) ? t('File {prefix}…', { prefix: p.prefix }) : t('Tanpa info kamera'));

type Tab = 'all' | Status;
const STATUS_OF: Partial<Record<Action, Status>> = { pick: 'pick', maybe: 'maybe', reject: 'reject' };


const CARD_MIN = 190;
/** Photos shown side by side in a hand-picked comparison. */
const MAX_COMPARE = 4;
const GAP = 12;
const CARD_INFO_H = 34;

export function Review() {
  const session = useApp((s) => s.session)!;
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const selection = useApp((s) => s.selection);
  const selectWith = useApp((s) => s.selectWith);
  const selectAll = useApp((s) => s.selectAll);
  const setStatus = useApp((s) => s.setStatus);
  const setRating = useApp((s) => s.setRating);
  const go = useApp((s) => s.go);

  const [tab, setTab] = useState<Tab>('all');
  const [reason, setReason] = useState<ReasonKind | null>(null);
  const [camera, setCamera] = useState<string | null>(null);
  // Camera names without EXIF are labels in the current language; a filter
  // set in the other one would match nothing.
  const langPref = useLang((s) => s.pref);
  useEffect(() => setCamera(null), [langPref]);
  const [onlySmiles, setOnlySmiles] = useState(false);
  const [stars, setStars] = useState<number | null>(null);
  const [onlyManual, setOnlyManual] = useState(false);
  const summary = useApp((s) => s.summary);
  const showSummary = useApp((s) => s.showSummary);
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
        (stars == null || p.rating === stars) &&
        (!onlyManual || isManual(p)) &&
        (!q || p.name.toLowerCase().includes(q)),
    );
  }, [photos, tab, reason, camera, onlySmiles, stars, onlyManual, query]);
  const smileCount = useMemo(() => photos.filter(hasSmile).length, [photos]);
  const manualCount = useMemo(() => photos.filter(isManual).length, [photos]);
  const starCounts = useMemo(() => {
    const c = [0, 0, 0, 0, 0, 0];
    for (const p of photos) c[p.rating]++;
    return c;
  }, [photos]);
  const filtered = !!(reason || camera || onlySmiles || stars != null || onlyManual || query.trim());
  const clearFilters = () => {
    setReason(null);
    setCamera(null);
    setOnlySmiles(false);
    setStars(null);
    setOnlyManual(false);
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || exporting || lightbox || summary) return;
      if (useApp.getState().screen.name !== 'review') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll(visible.map((p) => p.id));
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const action = actionFor(k);
      const mark = action && STATUS_OF[action];
      const targets = selection.length ? selection : selected ? [selected.id] : [];
      if (mark && targets.length) {
        e.preventDefault();
        setStatus(targets, mark);
        // Lightroom-style auto-advance for one photo, unless it is about to leave the filtered view.
        if (!selection.length && (tab === 'all' || tab === mark)) moveTo(index + 1);
        return;
      }
      if (/^[0-5]$/.test(k) && targets.length) {
        e.preventDefault();
        setRating(targets, Number(k));
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
        if (selection.length) select(selectedId);
      } else if (action === 'compare' && selection.length >= 2) {
        go({ name: 'compare', ids: selection.slice(0, MAX_COMPARE) });
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
              title={t('Tempel daftar foto pilihan klien dari WhatsApp')}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 text-xs font-medium text-fg hover:bg-line"
            >
              <Clipboard size={13} className="text-muted" /> {t('Pilihan klien')}
            </button>
            <button
            type="button"
            onClick={() => setExporting(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md bg-gold-gradient px-2.5 text-xs font-semibold text-white"
          >
            <Upload size={13} /> {t('Ekspor')}
          </button>
          </>
        }
      />
      <div className="flex min-h-0 flex-1">
        {/* ── Sidebar ── */}
        {/* Rows never shrink: a taller list scrolls instead of squeezing every filter. */}
        <aside className="flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line-soft bg-panel p-3 xl:w-60 [&>*]:shrink-0">
          <button
            type="button"
            onClick={() => showSummary(true)}
            title={t('Lihat ringkasan sesi')}
            className="flex flex-col gap-1 rounded-[10px] bg-panel-2 p-3 text-left hover:ring-1 hover:ring-line"
          >
            <span className="truncate text-sm font-semibold">{session.name}</span>
            <span className="flex items-center justify-between text-xs text-faint">
              {t('{count} foto', { n: counts.all, count: num(counts.all) })}
              <span className="flex items-center gap-1 text-gold-text">
                <ChartPie size={12} /> {t('Ringkasan')}
              </span>
            </span>
            <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-line">
              {(['pick', 'maybe', 'reject'] as const).map((s) => (
                <span key={s} style={{ width: `${(counts[s] / total) * 100}%`, background: STATUS[s].color }} />
              ))}
            </div>
          </button>
          <Retune />
          {/* Clearing lives in the bar above the grid ("Tampilkan semua") and on each active row's ✕. */}
          <SideTitle>{t('Saring: alasan AI')}</SideTitle>
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
          {Object.keys(reasonCounts).length === 0 && <p className="px-2.5 py-1 text-xs text-faint">{t('Tidak ada catatan.')}</p>}
          {smileCount > 0 && (
            <>
              <SideTitle>{t('Saring: ekspresi')}</SideTitle>
              <SideRow
                icon={Smile}
                label={t('Ada yang tersenyum')}
                count={smileCount}
                active={onlySmiles}
                onClick={() => setOnlySmiles((v) => !v)}
              />
            </>
          )}
          <SideTitle>{t('Saring: bintang')}</SideTitle>
          {[5, 4, 3, 2, 1, 0]
            .filter((n) => starCounts[n])
            .map((n) => (
              <SideRow
                key={n}
                icon={Star}
                color="var(--color-gold-text)"
                label={n ? t('{n} bintang', { n }) : t('Tanpa bintang')}
                count={starCounts[n]}
                active={stars === n}
                onClick={() => setStars(stars === n ? null : n)}
              />
            ))}
          {manualCount > 0 && (
            <>
              <SideTitle>{t('Saring: perubahan')}</SideTitle>
              <SideRow
                icon={Hand}
                label={t('Diubah manual')}
                count={manualCount}
                active={onlyManual}
                onClick={() => setOnlyManual((v) => !v)}
              />
            </>
          )}
          {cameras.length > 1 && (
            <>
              <SideTitle>{t('Saring: kamera')}</SideTitle>
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
          <div className="flex-1" />
          <div className="flex items-center gap-2.5 rounded-[10px] bg-panel-2 p-2.5">
            <Cpu size={16} className="shrink-0 text-pick" />
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-medium">{t('Selesai dalam {time}', { time: duration(session.durationMs) })}</span>
              <span className="text-[11px] text-faint">{t('Diproses offline di perangkat ini')}</span>
            </div>
          </div>
        </aside>

        {/* ── Center ── */}
        <section className="@container flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line-soft px-4 @3xl:px-5">
            <div className="flex shrink-0 gap-1 rounded-[10px] bg-panel p-[3px]">
              {(['all', 'pick', 'maybe', 'reject'] as const).map((tb) => (
                <button
                  key={tb}
                  type="button"
                  onClick={() => setTab(tb)}
                  className={cx(
                    'flex h-[30px] items-center gap-2 rounded-lg px-3 text-[13px]',
                    tab === tb ? 'border border-line bg-raised font-semibold text-fg' : 'font-medium text-muted hover:text-fg',
                  )}
                >
                  {tb !== 'all' && <Dot color={STATUS[tb].color} />}
                  {tb === 'all' ? t('Semua') : STATUS[tb].label}
                  <span className="hidden text-xs font-normal text-faint tabular-nums @[52rem]:inline">{num(counts[tb])}</span>
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
                    placeholder={t('Cari nama file…')}
                    className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint focus-visible:outline-none"
                  />
                  <button type="button" onClick={() => (setQuery(''), setSearching(false))} aria-label={t('Tutup pencarian')} className="shrink-0">
                    <X size={14} className="text-faint" />
                  </button>
                </label>
              ) : (
                <IconButton icon={Search} label={t('Cari nama file')} onClick={() => setSearching(true)} />
              )}
              <IconButton
                icon={PanelRight}
                label={details ? t('Tutup detail foto') : t('Detail foto')}
                onClick={() => setDetails((v) => !v)}
                className={cx('xl:hidden', details && 'border-gold text-gold-text')}
              />
            </div>
          </div>

          {filtered && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft bg-gold/[0.06] px-5 py-2 text-xs">
              <span className="text-muted">
                {tj('Menampilkan {shown} dari {total} foto', {
                  shown: <b className="font-semibold text-fg">{num(visible.length)}</b>,
                  total: num(counts[tab === 'all' ? 'all' : tab]),
                })}
              </span>
              {camera && <FilterChip label={t('Kamera: {name}', { name: camera })} onClear={() => setCamera(null)} />}
              {reason && <FilterChip label={t('Alasan: {name}', { name: REASON[reason].label })} onClear={() => setReason(null)} />}
              {onlySmiles && <FilterChip label={t('Ada yang tersenyum')} onClear={() => setOnlySmiles(false)} />}
              {stars != null && (
                <FilterChip label={stars ? t('{n} bintang', { n: stars }) : t('Tanpa bintang')} onClear={() => setStars(null)} />
              )}
              {onlyManual && <FilterChip label={t('Diubah manual')} onClear={() => setOnlyManual(false)} />}
              {query.trim() && <FilterChip label={t('Nama: “{query}”', { query: query.trim() })} onClear={() => (setQuery(''), setSearching(false))} />}
              <button type="button" onClick={clearFilters} className="ml-auto font-medium text-gold-text hover:underline">
                {t('Tampilkan semua')}
              </button>
            </div>
          )}
          {selection.length > 1 && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line-soft bg-gold/[0.08] px-5 py-2 text-xs">
              <span className="font-semibold text-fg">
                {t('{count} foto dipilih', { n: selection.length, count: num(selection.length) })}
              </span>
              <span className="text-faint">· {t('tandai semuanya:')}</span>
              {(['pick', 'maybe', 'reject'] as const).map((st) => {
                const Icon = STATUS_ICON[st];
                return (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatus(selection, st)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 font-medium hover:bg-line"
                  >
                    <Icon size={13} style={{ color: STATUS[st].color }} strokeWidth={2.5} />
                    {STATUS[st].one}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => go({ name: 'compare', ids: selection.slice(0, MAX_COMPARE) })}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-raised px-2.5 font-medium hover:bg-line"
                title={selection.length > MAX_COMPARE ? t('Hanya {n} foto pertama', { n: MAX_COMPARE }) : undefined}
              >
                <Columns2 size={13} className="text-muted" /> {t('Bandingkan')}
                {selection.length > MAX_COMPARE ? ` ${t('({n} pertama)', { n: MAX_COMPARE })}` : ''}
              </button>
              <button type="button" onClick={() => select(selectedId)} className="ml-auto font-medium text-gold-text hover:underline">
                {t('Batal pilih')}
              </button>
            </div>
          )}
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
            {visible.length === 0 ? (
              <div className="flex flex-col items-center gap-3 p-10 text-center text-sm text-faint">
                {t('Tidak ada foto di filter ini.')}
                {filtered && <Button onClick={clearFilters}>{t('Hapus filter')}</Button>}
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
                        inSelection={selection.includes(p.id)}
                        onSelect={(e) => {
                          if (e.shiftKey) selectWith(p.id, 'range', visible.map((x) => x.id));
                          else if (e.metaKey || e.ctrlKey) selectWith(p.id, 'toggle', []);
                          else select(p.id);
                        }}
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
          <Inspector
            photo={selected}
            session={photos}
            onCompare={(g) => go({ name: 'compare', group: g })}
            onCompareIds={(ids) => go({ name: 'compare', ids })}
          />
        </div>
      </div>

      <footer className="flex h-[30px] shrink-0 items-center justify-between border-t border-line-soft bg-panel px-4 text-[11px] text-faint">
        <span className="flex items-center gap-3.5">
          {[
            [kPick, t('Pilih')],
            [kMaybe, t('Cek')],
            [kReject, t('Lewati')],
            ['1-5', t('Bintang')],
            ['← →', t('Pindah')],
            ['Space', t('Tampilan besar')],
            [kCompare, t('Bandingkan burst')],
          ].map(([k, l]) => (
            <span key={k} className="flex items-center gap-1.5">
              <Kbd>{k}</Kbd>
              {l}
            </span>
          ))}
        </span>
        <span>
          {t('{count} dipilih', { count: num(counts.pick) })}
          {index >= 0 ? ` · ${t('{at} dari {total}', { at: num(index + 1), total: num(visible.length) })}` : ''}
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
      {summary && !exporting && <SummaryDialog onClose={() => showSummary(false)} onExport={() => (showSummary(false), setExporting(true))} />}
    </div>
  );
}

/** Labels are translated when shown. */
const STRICTNESS: { value: Strictness; label: string }[] = [
  { value: 'loose', label: 'Longgar' },
  { value: 'balanced', label: 'Seimbang' },
  { value: 'strict', label: 'Ketat' },
];

/**
 * Strictness and shoot type, changed after the analysis: the AI decides
 * again from the saved measurements in an instant. Photos changed by hand
 * stay as they are.
 */
function Retune() {
  const session = useApp((s) => s.session)!;
  const recull = useApp((s) => s.recull);
  const o = session.options;
  const shootType = o.shootType ?? 'auto';
  // Faces are only there when the first analysis read them.
  const facesRead = o.checkEyes || o.checkSmile;
  // The checks stay as the analysis ran them; "Lainnya" ignores faces on its own.
  const change = (patch: { strictness?: Strictness; shootType?: ShootType }) => recull({ ...o, shootType, ...patch });
  return (
    <>
      <SideTitle>{t('Atur penilaian')}</SideTitle>
      <div className="flex flex-col gap-2 px-1 pb-1">
        <div className="flex gap-0.5 rounded-lg bg-bg p-0.5" role="radiogroup" aria-label={t('Ketat seleksi')}>
          {STRICTNESS.map((st) => (
            <button
              key={st.value}
              type="button"
              role="radio"
              aria-checked={o.strictness === st.value}
              onClick={() => o.strictness !== st.value && change({ strictness: st.value })}
              className={cx(
                'h-7 flex-1 rounded-md px-1 text-[11px]',
                o.strictness === st.value ? 'bg-raised font-semibold text-fg ring-1 ring-line' : 'font-medium text-muted hover:text-fg',
              )}
            >
              {t(st.label)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-line-soft bg-bg px-2 focus-within:border-gold">
          <SlidersHorizontal size={13} className="shrink-0 text-faint" />
          <select
            aria-label={t('Jenis pemotretan')}
            value={shootType}
            onChange={(e) => change({ shootType: e.target.value as ShootType })}
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-fg outline-none"
          >
            <option value="auto">{GENERAL.label}</option>
            {SHOOT_TYPES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <p className="px-1 text-[11px] leading-snug text-faint">
          {shootRule(shootType)}
          {!facesRead &&
            shootType !== 'lainnya' &&
            ` ${t('Wajah tidak dibaca di analisis ini, jadi mata & senyum tidak dinilai.')}`}
        </p>
        <p className="px-1 text-[11px] leading-snug text-faint">{t('Foto yang sudah diubah manual tidak ikut berubah.')}</p>
      </div>
    </>
  );
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-gold/50 bg-gold/10 pr-1 pl-2.5 font-medium text-gold-text">
      {label}
      <button type="button" onClick={onClear} aria-label={t('Hapus filter {label}', { label })} className="rounded-full p-0.5 hover:bg-gold/20">
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
      title={active ? t('Klik lagi untuk menampilkan semua') : t('Tampilkan hanya {label}', { label })}
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
  inSelection,
  onSelect,
  onOpen,
}: {
  photo: PhotoEntry;
  width: number;
  selected: boolean;
  /** Part of a multi-selection. */
  inSelection: boolean;
  onSelect: (e: React.MouseEvent) => void;
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
        selected ? 'ring-2 ring-gold' : inSelection ? 'ring-2 ring-gold/60' : 'ring-1 ring-line-soft hover:ring-line',
      )}
    >
      <div className="relative aspect-[3/2] w-full bg-raised">
        {inSelection && (
          <span className="absolute top-2 right-2 z-10 flex size-5 items-center justify-center rounded-full bg-gold text-bg">
            <Check size={13} strokeWidth={3} />
          </span>
        )}
        {p.thumb ? (
          <img
            src={thumbUrl(p.thumb)}
            alt=""
            loading="lazy"
            decoding="async"
            className={cx('size-full object-cover', p.status === 'reject' && 'opacity-55')}
          />
        ) : (
          <span className="flex size-full items-center justify-center text-faint" title={p.error ? tRust(p.error) : undefined}>
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
                {t('Tidak bisa dibaca')}
              </span>
            )}
          </span>
        )}
      </div>
      <div className="flex flex-col px-2.5 py-2">
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {best && <Crown size={12} className="shrink-0 text-gold-text" aria-label={t('Terbaik di grup')} />}
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
  onCompareIds,
}: {
  photo: PhotoEntry | null;
  session: PhotoEntry[];
  onCompare: (group: number) => void;
  onCompareIds: (ids: number[]) => void;
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
    !m ? null : m.brightness < 35 || m.shadowsClipped > 0.45 ? [t('Gelap'), 'maybe'] : m.brightness > 225 || m.highlightsClipped > 0.3 ? [t('Terang'), 'maybe'] : [t('Normal'), 'pick'];
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
              onClick={() => setStatus(useApp.getState().selection.length ? useApp.getState().selection : [photo.id], st)}
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
          {t('Diubah manual. Saran AI:')} <span style={{ color: STATUS[photo.autoStatus].color }}>{STATUS[photo.autoStatus].one}</span>
        </p>
      )}

      <div className="flex flex-col gap-0.5 rounded-[10px] bg-panel-2 p-3">
        <span className="flex items-center gap-2 pb-1.5 text-xs font-semibold">
          <Sparkles size={14} className="text-gold-text" /> {t('Kenapa AI menilai begini')}
        </span>
        {photo.error ? (
          <p className="text-xs text-maybe">{t('File tidak bisa dibaca: {error}', { error: tRust(photo.error) })}</p>
        ) : (
          m && (
            <>
              <Metric icon={Sparkles} label={t('Ketajaman foto')} value={`${Math.round(m.sharpness)}%`} tone={sharpTone} />
              {photo.faces?.some((f) => f.sharpness != null) && (
                <Metric
                  icon={UserRound}
                  label={t('Fokus di wajah')}
                  value={photo.reasons.some((r) => r.kind === 'subjectSoft') ? t('Meleset') : t('Kena')}
                  tone={photo.reasons.some((r) => r.kind === 'subjectSoft') ? 'maybe' : 'pick'}
                />
              )}
              <Metric icon={SunMedium} label={t('Eksposur')} value={exposure![0]} tone={exposure![1] as Status} />
              {eyes && <Metric icon={Eye} label={t('Mata')} value={eyes.label} tone={eyes.tone} />}
              {smileOf(photo) && <Metric icon={Smile} label={t('Ekspresi')} value={smileOf(photo)!.label} tone={null} />}
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
                          {t('Mirip {name} yang lebih tajam.', { name: session.find((p) => p.id === r.of)?.name ?? t('foto lain') })}
                        </span>
                      ),
                  )}
                  {photo.reasons.map(
                    (r) =>
                      r.kind === 'similar' && (
                        <span key="sim" className="flex flex-wrap items-center gap-x-2 text-[11px] text-faint">
                          {t('Pose sama dengan {name}, diambil lagi beberapa saat kemudian.', {
                            name: session.find((p) => p.id === r.of)?.name ?? t('foto lain'),
                          })}
                          <button
                            type="button"
                            onClick={() => onCompareIds([photo.id, r.of])}
                            className="inline-flex items-center gap-1 font-medium text-gold-text hover:underline"
                          >
                            <Images size={12} /> {t('Bandingkan')}
                          </button>
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
              <Layers size={14} className="text-gold-text" />{' '}
              {t('Grup burst · {count} foto', { n: siblings.length, count: num(siblings.length) })}
            </span>
            <button type="button" onClick={() => onCompare(photo.group!)} className="text-xs font-medium text-gold-text hover:underline">
              {t('Bandingkan')}
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
          {t('Tampilkan di {app}', { app: navigator.userAgent.includes('Mac') ? 'Finder' : 'Explorer' })}
        </Button>
      )}
    </aside>
  );
}

/** `tone` null = information only: no coloured dot, which would read as a verdict. */
function Metric({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: Status | 'gold' | null }) {
  return (
    // Label never shrinks; a long value wraps under itself, right-aligned.
    <div className="flex min-h-[30px] items-start justify-between gap-3 py-[7px]">
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
        <Icon size={14} className="text-faint" /> {label}
      </span>
      <span className="flex min-w-0 items-center justify-end gap-1.5 text-right text-xs font-medium">
        {tone && <Dot color={toneColor(tone)} size={6} />}
        <span className="min-w-0">{value}</span>
      </span>
    </div>
  );
}
