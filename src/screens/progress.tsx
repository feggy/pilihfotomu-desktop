import { Check, Circle, LoaderCircle } from 'lucide-react';

import { TitleBar } from '../components/title-bar';
import { Button, Dot, StatusBadge } from '../components/ui';
import { thumbUrl } from '../lib/api';
import { useEta } from '../lib/eta';
import { duration, num, REASON, STATUS } from '../lib/format';
import { useApp } from '../store';

export function ProgressScreen() {
  const run = useApp((s) => s.run);
  const cancel = useApp((s) => s.cancel);
  const { remainingMs: remaining, perMinute } = useEta(run?.done ?? 0, run?.total ?? 0, run?.startedAt ?? Date.now());
  if (!run) return null;

  // Reading photos is most of the work; grouping is the last stretch. The
  // bar only fills once every step below is done.
  const reading = run.done < run.total;
  const pct = (run.total ? run.done / run.total : 0) * 0.9 + (run.grouping ? 0.05 : 0);
  const steps: [string, 'done' | 'active' | 'todo'][] = [
    ['Baca foto, ketajaman & eksposur', reading ? 'active' : 'done'],
    ['Deteksi wajah, mata & senyum', reading ? 'active' : 'done'],
    ['Kelompokkan duplikat', run.grouping ? 'active' : 'todo'],
  ];

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <main className="flex flex-1 flex-col items-center gap-7 overflow-y-auto px-6 pt-10 pb-10 lg:px-8 lg:pt-[72px]">
        <div className="flex w-full max-w-[880px] flex-col gap-1.5">
          <h1 className="text-2xl font-semibold">Memilah {run.folder.name}</h1>
          <p className="text-sm text-muted">Kamu bisa tinggal dulu. Hasilnya langsung terbuka begitu selesai.</p>
        </div>

        <div className="flex w-full max-w-[880px] flex-col gap-3 rounded-2xl border border-line-soft bg-panel p-6">
          <div className="flex items-end justify-between">
            <div className="flex items-end gap-2">
              <span className="text-4xl font-semibold tabular-nums">{num(run.done)}</span>
              <span className="pb-1.5 text-sm text-muted">dari {num(run.total)} foto</span>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-sm font-medium">
                {run.grouping ? 'Menyelesaikan…' : remaining != null ? `Sisa ± ${duration(remaining)}` : 'Menghitung waktu…'}
              </span>
              {perMinute != null && <span className="text-xs text-faint">{num(perMinute)} foto/menit</span>}
            </div>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,#8c6a30,#d9bd88)] transition-[width] duration-300"
              style={{ width: `${pct * 100}%` }}
            />
          </div>
          <div className="flex gap-5">
            {steps.map(([label, state]) => (
              <span key={label} className="flex items-center gap-1.5 text-xs text-muted">
                {state === 'done' && <Check size={14} className="text-pick" />}
                {state === 'active' && <LoaderCircle size={14} className="animate-spin text-gold-text" />}
                {state === 'todo' && <Circle size={14} className="text-faint" />}
                <span className={state === 'todo' ? 'text-faint' : undefined}>{label}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="grid w-full max-w-[880px] grid-cols-3 gap-3">
          {(['pick', 'maybe', 'reject'] as const).map((st) => (
            <div key={st} className="flex flex-col gap-1.5 rounded-xl border border-line-soft bg-panel p-4">
              <span className="flex items-center gap-2 text-[13px] text-muted">
                <Dot color={STATUS[st].color} /> {st === 'pick' ? 'Lolos sejauh ini' : STATUS[st].label}
              </span>
              <span className="flex items-end gap-2">
                <span className="text-[28px] font-semibold tabular-nums">{num(run.counts[st])}</span>
                <span className="pb-1.5 text-xs text-faint">
                  {run.done ? Math.round((run.counts[st] / run.done) * 100) : 0}%
                </span>
              </span>
              {/* Duplicates need every frame of a burst, so they only move here at the end. */}
              {st === 'reject' && <span className="text-[11px] text-faint">+ duplikat dihitung di akhir</span>}
            </div>
          ))}
        </div>
        <p className="-mt-4 w-full max-w-[880px] text-[11px] text-faint">
          Angka sementara. Duplikat baru bisa ditentukan setelah semua foto terbaca, jadi sebagian foto yang lolos
          sekarang akan pindah ke Dilewati di tahap terakhir.
        </p>

        {run.recent.length > 0 && (
          <div className="flex w-full max-w-[880px] flex-col gap-2.5">
            <h2 className="text-[13px] font-semibold text-muted">Baru saja diproses</h2>
            <div className="grid grid-cols-4 gap-2 lg:grid-cols-8">
              {run.recent.map((p) => (
                <div key={p.id} className="flex flex-col gap-1.5">
                  <div className="relative aspect-[3/2] overflow-hidden rounded-lg bg-raised">
                    {p.thumb && <img src={thumbUrl(p.thumb)} alt="" className="size-full object-cover" />}
                    <span className="absolute top-1.5 left-1.5">
                      <StatusBadge status={p.status} size={16} />
                    </span>
                  </div>
                  <span className="truncate text-[11px]" style={{ color: p.reason ? STATUS[p.status].color : 'var(--color-faint)' }}>
                    {p.reason ? REASON[p.reason.kind].label : 'Lolos'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button variant="ghost" onClick={cancel} disabled={run.grouping}>
          Batal
        </Button>
      </main>
    </div>
  );
}
