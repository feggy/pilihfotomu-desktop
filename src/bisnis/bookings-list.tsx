/**
 * Every booking as a table: found by name, narrowed by stage or payment,
 * sorted by when, how much or what is owed. A row opens the booking's detail.
 */

import { ArrowDown, ArrowUp, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Select } from '../components/select';
import { cx } from '../components/ui';
import { t } from '../lib/i18n';
import { PAY_COLOR, PAY_LABEL, balanceOf, clientOf, nextSession, payState, rupiah, shortDate, timeOf, titleOf, totalOf, type PayState } from './model';
import { useBisnis } from './store';
import type { Booking } from './types';
import { Empty } from './ui';

type Sort = 'jadwal' | 'nama' | 'total' | 'sisa' | 'dibuat';

export function BookingsList({ onOpen }: { onOpen: (b: Booking) => void }) {
  const data = useBisnis((s) => s.data)!;
  const [q, setQ] = useState('');
  // '' every stage; 'aktif' all but finished and cancelled; else one column.
  const [stage, setStage] = useState('aktif');
  const [pay, setPay] = useState<'' | PayState>('');
  const [sort, setSort] = useState<{ by: Sort; up: boolean }>({ by: 'jadwal', up: true });

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    const closed = new Set(data.columns.filter((c) => c.inactive || c.done).map((c) => c.id));
    const list = data.bookings.filter((b) => {
      if (stage === 'aktif' ? closed.has(b.columnId) : stage && b.columnId !== stage) return false;
      if (pay && payState(b) !== pay) return false;
      if (!query) return true;
      const c = clientOf(data, b);
      return [titleOf(data, b), b.packageName, c?.phone ?? '', ...b.sessions.map((s) => s.location)].some((x) => x.toLowerCase().includes(query));
    });
    const when = (b: Booking) => nextSession(b)?.start ?? '9999';
    const value: Record<Sort, (b: Booking) => string | number> = {
      jadwal: when,
      nama: (b) => titleOf(data, b).toLowerCase(),
      total: totalOf,
      sisa: balanceOf,
      dibuat: (b) => b.createdAt,
    };
    const f = value[sort.by];
    return list.sort((a, b) => {
      const x = f(a), y = f(b);
      return (x < y ? -1 : x > y ? 1 : 0) * (sort.up ? 1 : -1);
    });
  }, [data, q, stage, pay, sort]);

  const head = (by: Sort, label: string, className = '') => (
    <button type="button" onClick={() => setSort((s) => ({ by, up: s.by === by ? !s.up : true }))} className={cx('flex items-center gap-1 hover:text-fg', sort.by === by && 'text-fg', className)}>
      {label}
      {sort.by === by && (sort.up ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
    </button>
  );

  if (!data.bookings.length)
    return (
      <div className="px-6 pt-6 lg:px-8">
        <Empty icon={<Search size={22} />} title={t('Belum ada booking')} text={t('Booking yang kamu catat muncul di sini, bisa dicari dan diurutkan.')} />
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-6 pt-4 pb-6 lg:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 w-72 items-center gap-2 rounded-[10px] border border-line bg-panel px-3 focus-within:border-gold">
          <Search size={14} className="text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('Cari klien, paket, lokasi…')} className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
        </label>
        <Select
          value={stage}
          onChange={setStage}
          className="!w-48"
          options={[{ value: 'aktif', label: t('Yang masih berjalan') }, { value: '', label: t('Semua tahap') }, ...data.columns.map((c) => ({ value: c.id, label: c.name, color: c.color }))]}
        />
        <Select<'' | PayState>
          value={pay}
          onChange={setPay}
          className="!w-44"
          options={[{ value: '', label: t('Semua pembayaran') }, ...(['belum', 'dp', 'lunas'] as const).map((p) => ({ value: p, label: t(PAY_LABEL[p]), color: PAY_COLOR[p] }))]}
        />
        <span className="ml-auto text-xs text-faint">{t('{n} booking', { n: rows.length })}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line-soft">
        <div className="grid shrink-0 grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_150px_170px_100px_120px_120px] items-center gap-3 border-b border-line-soft bg-panel px-4 py-2.5 text-[11px] font-medium text-faint">
          {head('nama', t('Klien'))}
          <span>{t('Paket')}</span>
          {head('jadwal', t('Jadwal'))}
          <span>{t('Tahap')}</span>
          <span>{t('Pembayaran')}</span>
          {head('total', t('Total'), 'justify-end')}
          {head('sisa', t('Sisa'), 'justify-end')}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {rows.length === 0 && <p className="px-4 py-8 text-center text-xs text-faint">{t('Tidak ada booking yang cocok.')}</p>}
          {rows.map((b) => {
            const s = nextSession(b);
            const state = payState(b);
            const col = data.columns.find((c) => c.id === b.columnId);
            return (
              <div
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(b)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(b)}
                className="grid cursor-pointer grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_150px_170px_100px_120px_120px] items-center gap-3 border-b border-line-soft px-4 py-2.5 text-[13px] last:border-0 hover:bg-panel"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{titleOf(data, b)}</span>
                  {clientOf(data, b)?.phone && <span className="truncate text-[11px] text-faint">{clientOf(data, b)!.phone}</span>}
                </span>
                <span className="truncate text-muted">{b.packageName || '—'}</span>
                <span className="text-xs text-muted tabular-nums">{s ? `${shortDate(s.start.split('T')[0]!)} · ${timeOf(s.start)}` : <span className="text-faint">{t('Belum ada jadwal')}</span>}</span>
                <span className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: col?.color }} />
                  <span className="truncate">{col?.name}</span>
                </span>
                <span className="text-xs font-medium" style={{ color: PAY_COLOR[state] }}>
                  {t(PAY_LABEL[state])}
                </span>
                <span className="text-right tabular-nums">{rupiah(totalOf(b))}</span>
                <span className={cx('text-right tabular-nums', balanceOf(b) > 0 ? 'text-reject' : 'text-faint')}>{rupiah(balanceOf(b))}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
