import { Check, ClipboardCopy, Cpu, Layers, Smile, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { Button, Dot } from '../components/ui';
import { isManual } from '../lib/api';
import { duration, hasSmile, num, REASON, STATUS, toneColor, type ReasonKind } from '../lib/format';
import { t, tj } from '../lib/i18n';
import { shootLabel } from '../lib/shoot';
import { useApp } from '../store';

/** Reasons worth counting in a summary, in the order a photographer reads them. */
const FOUND: ReasonKind[] = ['blur', 'softFocus', 'subjectSoft', 'eyesClosed', 'duplicate', 'similar', 'dark', 'bright'];

/** Read in the current language when shown. */
const STRICTNESS_LABEL = { loose: 'Longgar', balanced: 'Seimbang', strict: 'Ketat' } as const;

/**
 * What the AI did with a session, in numbers — shown once after an analysis
 * and from the sidebar. "Salin ringkasan" gives a plain-text version to
 * paste into a chat.
 */
export function SummaryDialog({ onClose, onExport }: { onClose: () => void; onExport: () => void }) {
  const session = useApp((s) => s.session)!;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = useMemo(() => {
    const photos = session.photos;
    const status = { pick: 0, maybe: 0, reject: 0 };
    const reasons = {} as Record<ReasonKind, number>;
    const groups = new Set<number>();
    for (const p of photos) {
      status[p.status]++;
      for (const r of new Set(p.reasons.map((r) => r.kind))) reasons[r] = (reasons[r] ?? 0) + 1;
      if (p.group != null) groups.add(p.group);
    }
    return {
      total: photos.length,
      status,
      reasons,
      groups: groups.size,
      smiles: photos.filter(hasSmile).length,
      manual: photos.filter(isManual).length,
      unreadable: photos.filter((p) => p.error).length,
    };
  }, [session]);

  const found = FOUND.filter((k) => s.reasons[k]);
  const pct = (n: number) => `${Math.round((n / Math.max(1, s.total)) * 100)}%`;
  const settings = `${shootLabel(session.options.shootType ?? 'auto')} · ${t(STRICTNESS_LABEL[session.options.strictness])}`;

  const text = [
    `pilihfotomu · ${session.name}`,
    t('{total} foto → {pick} dipilih · {maybe} dicek · {reject} dilewati', {
      total: num(s.total),
      pick: num(s.status.pick),
      maybe: num(s.status.maybe),
      reject: num(s.status.reject),
    }),
    found.length ? found.map((k) => `${REASON[k].label} ${num(s.reasons[k])}`).join(' · ') : '',
    s.groups ? t('{count} grup burst', { n: s.groups, count: num(s.groups) }) : '',
    t('Diproses dalam {time}, offline di perangkat sendiri.', { time: duration(session.durationMs) }),
  ]
    .filter(Boolean)
    .join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      useApp.getState().fail(e);
    }
  };

  return (
    <div className="fixed inset-x-0 top-10 bottom-0 z-40 flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={t('Ringkasan sesi')}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-full w-[560px] max-w-full flex-col gap-5 overflow-y-auto rounded-[18px] border border-line bg-panel p-7 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-xl font-semibold">{t('Ringkasan sesi')}</h2>
            <p className="truncate text-xs text-faint">
              {session.name} · {settings}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('Tutup')} className="text-faint hover:text-fg">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-[15px]">
            {tj('{total} {arrow} {picked}', {
              total: <b className="font-semibold">{t('{count} foto', { n: s.total, count: num(s.total) })}</b>,
              arrow: <span className="text-faint">→</span>,
              picked: (
                <b className="font-semibold" style={{ color: STATUS.pick.color }}>
                  {t('{count} dipilih', { count: num(s.status.pick) })}
                </b>
              ),
            })}
          </p>
          <div className="flex h-2 overflow-hidden rounded-full bg-line">
            {(['pick', 'maybe', 'reject'] as const).map((st) => (
              <span key={st} style={{ width: pct(s.status[st]), background: STATUS[st].color }} />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(['pick', 'maybe', 'reject'] as const).map((st) => (
              <div key={st} className="flex flex-col gap-0.5 rounded-xl bg-panel-2 px-3 py-2.5">
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  <Dot color={STATUS[st].color} size={7} /> {STATUS[st].label}
                </span>
                <span className="text-lg font-semibold tabular-nums">{num(s.status[st])}</span>
                <span className="text-[11px] text-faint">{pct(s.status[st])}</span>
              </div>
            ))}
          </div>
        </div>

        {(found.length > 0 || s.groups > 0 || s.smiles > 0) && (
          <div className="flex flex-col gap-1 rounded-xl bg-panel-2 p-3.5">
            <span className="pb-1 text-xs font-semibold">{t('Yang ditemukan AI')}</span>
            {found.map((k) => {
              const Icon = REASON[k].icon;
              return (
                <Row key={k} label={REASON[k].label} value={num(s.reasons[k])}>
                  <Icon size={14} style={{ color: toneColor(REASON[k].tone) }} />
                </Row>
              );
            })}
            {s.groups > 0 && (
              <Row label={t('Grup burst')} value={num(s.groups)}>
                <Layers size={14} className="text-gold-text" />
              </Row>
            )}
            {s.smiles > 0 && (
              <Row label={t('Ada yang tersenyum')} value={num(s.smiles)}>
                <Smile size={14} className="text-gold-text" />
              </Row>
            )}
          </div>
        )}

        <p className="flex items-start gap-2 text-xs text-muted">
          <Cpu size={14} className="mt-px shrink-0 text-pick" />
          <span>
            {t('Diproses dalam {time}, offline di perangkat ini.', { time: duration(session.durationMs) })}
            {s.manual > 0 && ` ${t('{count} foto sudah diubah manual.', { n: s.manual, count: num(s.manual) })}`}
            {s.unreadable > 0 &&
              ` ${t('{count} file tidak bisa dibaca (masuk Cek).', { n: s.unreadable, count: num(s.unreadable) })}`}
          </span>
        </p>

        <div className="flex flex-wrap justify-end gap-2.5">
          <Button icon={copied ? Check : ClipboardCopy} onClick={copy}>
            {copied ? t('Tersalin') : t('Salin ringkasan')}
          </Button>
          <Button icon={Upload} onClick={onExport}>
            {t('Ekspor')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('Mulai review')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between text-xs">
      <span className="flex items-center gap-2 text-muted">
        {children}
        {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
