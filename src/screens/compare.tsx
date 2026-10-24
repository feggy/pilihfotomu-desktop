import { ArrowLeft, Check, ChevronLeft, ChevronRight, Crown } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import { TitleBar } from '../components/title-bar';
import { Button, Dot, IconButton, Kbd, StatusBadge, cx } from '../components/ui';
import { thumbUrl, type Status } from '../lib/api';
import { clock, eyeSummary, num, STATUS, toneColor } from '../lib/format';
import { t } from '../lib/i18n';
import { actionFor, useKey, type Action } from '../lib/keys';
import { useApp } from '../store';

const STATUS_OF: Partial<Record<Action, Status>> = { pick: 'pick', maybe: 'maybe', reject: 'reject' };

/** A burst group (with group-to-group stepping), or any photos chosen by hand. */
export function Compare({ group, ids }: { group?: number; ids?: number[] }) {
  const session = useApp((s) => s.session)!;
  const selectedId = useApp((s) => s.selectedId);
  const select = useApp((s) => s.select);
  const setStatus = useApp((s) => s.setStatus);
  const go = useApp((s) => s.go);
  const kPick = useKey('pick');
  const kReject = useKey('reject');

  const groups = useMemo(
    () => [...new Set(session.photos.map((p) => p.group).filter((g): g is number => g != null))].sort((a, b) => a - b),
    [session.photos],
  );
  const manual = !!ids?.length;
  const members = manual
    ? ids!.map((id) => session.photos.find((p) => p.id === id)!).filter(Boolean)
    : session.photos.filter((p) => p.group === group).sort((a, b) => (a.takenAt ?? 0) - (b.takenAt ?? 0));
  const at = group == null ? -1 : groups.indexOf(group);
  const active = members.find((p) => p.id === selectedId) ?? members[0];

  const jump = (d: number) => {
    if (manual) return;
    const g = groups[at + d];
    if (g == null) return;
    const first = session.photos.find((p) => p.group === g);
    if (first) select(first.id);
    go({ name: 'compare', group: g });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      const n = Number(k);
      if (n >= 1 && n <= members.length) return select(members[n - 1].id);
      const action = actionFor(k);
      const mark = action && STATUS_OF[action];
      if (mark && active) return void setStatus([active.id], mark);
      if (k === 'arrowright') return select(members[Math.min(members.length - 1, members.indexOf(active) + 1)].id);
      if (k === 'arrowleft') return select(members[Math.max(0, members.indexOf(active) - 1)].id);
      if (k === 'enter' && !manual) return jump(1);
      if (k === 'escape') go({ name: 'review' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!members.length) go({ name: 'review' });
  }, [members.length, go]);
  if (!members.length) return null;
  const t0 = clock(members[0].takenAt);
  const t1 = clock(members[members.length - 1].takenAt);

  return (
    <div className="flex h-full flex-col">
      <TitleBar title={session.name} />
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-line-soft px-6">
        <div className="flex items-center gap-3.5">
          <IconButton icon={ArrowLeft} label={t('Kembali ke review')} onClick={() => go({ name: 'review' })} />
          <div className="flex flex-col gap-0.5">
            <span className="text-[15px] font-semibold">
              {manual
                ? t('Bandingkan {count} foto', { n: members.length, count: num(members.length) })
                : t('Grup burst · {count} foto', { n: members.length, count: num(members.length) })}
            </span>
            <span className="text-xs text-faint">
              {manual ? t('Foto yang kamu pilih') : t0 && t1 ? `${t0} – ${t1}` : t('Foto berurutan yang mirip')}
            </span>
          </div>
        </div>
        <div className={cx('flex items-center gap-2.5', manual && 'hidden')}>
          <IconButton icon={ChevronLeft} label={t('Grup sebelumnya')} disabled={at <= 0} onClick={() => jump(-1)} />
          <span className="text-[13px] text-muted tabular-nums">
            {t('Grup {at} dari {total}', { at: num(at + 1), total: num(groups.length) })}
          </span>
          <IconButton icon={ChevronRight} label={t('Grup berikutnya')} disabled={at >= groups.length - 1} onClick={() => jump(1)} />
          <span className="mx-1 h-6 w-px bg-line" />
          <Button variant="primary" icon={Check} kbd="Enter" disabled={at >= groups.length - 1} onClick={() => jump(1)}>
            {t('Lanjut')}
          </Button>
        </div>
      </div>

      <main className="flex min-h-0 flex-1 items-start justify-center gap-3.5 overflow-auto p-6">
        {members.map((p, i) => {
          const best = p.reasons.some((r) => r.kind === 'bestInGroup');
          const on = p.id === active.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => select(p.id)}
              className={cx(
                'flex max-h-full min-w-[220px] max-w-[420px] flex-1 flex-col gap-2.5 rounded-[14px] p-2.5 text-left',
                on ? 'bg-gold/[0.08] ring-2 ring-gold' : 'bg-panel ring-1 ring-line-soft hover:ring-line',
              )}
            >
              <div className="relative min-h-0 overflow-hidden rounded-[10px] bg-raised">
                {p.thumb ? (
                  <img src={thumbUrl(p.thumb)} alt="" className="block max-h-[62vh] w-full object-contain" />
                ) : (
                  <div className="aspect-[3/2] w-full" />
                )}
                <span className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
                  <StatusBadge status={p.status} size={22} />
                  <Kbd>{i + 1}</Kbd>
                </span>
                {best && (
                  <span className="absolute top-2.5 right-2.5 inline-flex h-6 items-center gap-1 rounded-full bg-gold px-2 text-[11px] font-semibold text-bg">
                    <Crown size={12} /> {t('Terbaik')}
                  </span>
                )}
              </div>
              <span className="flex items-center justify-between">
                <span className="text-[13px] font-semibold">{p.name}</span>
                <span className="text-[11px] text-faint">{clock(p.takenAt)}</span>
              </span>
              {eyeSummary(p) && (
                <span className="flex items-center justify-between text-[11px]">
                  <span className="text-faint">{t('Mata')}</span>
                  <span className="flex items-center gap-1.5 font-medium">
                    <Dot size={6} color={toneColor(eyeSummary(p)!.tone)} />
                    {eyeSummary(p)!.label}
                  </span>
                </span>
              )}
              <span className="flex items-center justify-between text-[11px]">
                <span className="text-faint">{t('Ketajaman')}</span>
                <span className="flex items-center gap-1.5 font-medium">
                  <Dot
                    size={6}
                    color={
                      (p.metrics?.sharpness ?? 0) >= 42 ? STATUS.pick.color : (p.metrics?.sharpness ?? 0) >= 25 ? STATUS.maybe.color : STATUS.reject.color
                    }
                  />
                  {p.metrics ? `${Math.round(p.metrics.sharpness)}%` : '—'}
                </span>
              </span>
            </button>
          );
        })}
      </main>

      <footer className="flex h-[30px] shrink-0 items-center gap-3.5 border-t border-line-soft bg-panel px-4 text-[11px] text-faint">
        {[
          [`1-${members.length}`, t('Pilih foto')],
          [kPick, t('Pilih')],
          [kReject, t('Lewati')],
          ['Enter', t('Grup berikutnya')],
          ['Esc', t('Kembali')],
        ].map(([k, l]) => (
          <span key={k} className="flex items-center gap-1.5">
            <Kbd>{k}</Kbd>
            {l}
          </span>
        ))}
      </footer>
    </div>
  );
}
