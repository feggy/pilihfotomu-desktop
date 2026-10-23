import { getVersion } from '@tauri-apps/api/app';
import { ArrowLeft, BadgeCheck, Info, Keyboard, RotateCcw, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { TitleBar, isMac } from '../components/title-bar';
import { Button, Chip, IconButton, Kbd, cx } from '../components/ui';
import { ACTIONS, DEFAULT_KEYS, RESERVED, keyLabel, useKeys, type Action } from '../lib/keys';
import type { Screen } from '../store';
import { useApp } from '../store';

type Section = 'license' | 'keys' | 'about';

const NAV: { id: Section; icon: LucideIcon; label: string }[] = [
  { id: 'license', icon: BadgeCheck, label: 'Lisensi & perangkat' },
  { id: 'keys', icon: Keyboard, label: 'Pintasan keyboard' },
  { id: 'about', icon: Info, label: 'Tentang' },
];

/** Shortcuts that can't be changed. */
const FIXED: [string, string][] = [
  ['← → ↑ ↓', 'Pindah foto'],
  ['1–5 / 0', 'Beri / hapus bintang'],
  ['Space', 'Buka / tutup tampilan besar'],
  ['+ / −', 'Perbesar / perkecil'],
  ['1–9', 'Pilih foto di Bandingkan'],
  ['Enter', 'Grup burst berikutnya'],
  ['Esc', 'Kembali / tutup'],
  [isMac ? '⌘ ,' : 'Ctrl + ,', 'Buka pengaturan'],
];

function KeyEditor() {
  const keys = useKeys((s) => s.keys);
  const setKey = useKeys((s) => s.set);
  const reset = useKeys((s) => s.reset);
  const [listening, setListening] = useState<Action | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const k = e.key.toLowerCase();
      if (k === 'escape') return setListening(null);
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (k.length !== 1 || RESERVED.has(k)) {
        setNote(`“${keyLabel(e.key)}” sudah dipakai untuk fungsi tetap. Pilih huruf lain.`);
        return;
      }
      const other = ACTIONS.find((a) => a.id !== listening && keys[a.id] === k);
      setNote(other ? `${keyLabel(k)} dipindah dari “${other.label}”, yang sekarang memakai ${keyLabel(keys[listening])}.` : null);
      setKey(listening, k);
      setListening(null);
    };
    // Capture: runs before the screen's own shortcut handlers.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, keys, setKey]);

  const changed = ACTIONS.some((a) => keys[a.id] !== DEFAULT_KEYS[a.id]);
  return (
    <div className="flex max-w-[560px] flex-col gap-5">
      <div className="flex items-end justify-between">
        <h1 className="text-[22px] font-semibold">Pintasan keyboard</h1>
        <Button variant="plain" icon={RotateCcw} disabled={!changed} onClick={() => (reset(), setNote(null))}>
          Kembalikan bawaan
        </Button>
      </div>
      <p className="-mt-3 text-[13px] text-muted">Klik tombol di kanan, lalu tekan huruf baru. Contoh: Q / W / E untuk Pick / Maybe / Reject.</p>
      <div className="flex flex-col rounded-2xl border border-line-soft bg-panel px-5 py-2">
        {ACTIONS.map((a) => (
          <div key={a.id} className="flex h-11 items-center justify-between gap-3 border-b border-line-soft last:border-0">
            <span className="text-[13px] text-muted">{a.label}</span>
            <span className="flex items-center gap-3">
              {listening === a.id && (
                <span className="text-xs text-gold-text">
                  Tekan huruf baru · <span className="text-faint">Esc batal</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => (setListening(listening === a.id ? null : a.id), setNote(null))}
                title="Klik untuk mengganti"
                className={cx(
                  'h-8 w-11 shrink-0 rounded-md border text-xs font-semibold transition-colors',
                  listening === a.id
                    ? 'border-gold bg-gold/15 text-gold-text ring-2 ring-gold/30'
                    : 'border-line bg-bg text-fg hover:border-faint',
                )}
              >
                {listening === a.id ? '…' : keyLabel(keys[a.id])}
              </button>
            </span>
          </div>
        ))}
      </div>
      {note && <p className="text-xs text-maybe">{note}</p>}
      <h2 className="pt-2 text-sm font-semibold text-muted">Tetap</h2>
      <div className="flex flex-col rounded-2xl border border-line-soft bg-panel px-5 py-2">
        {FIXED.map(([k, l]) => (
          <div key={k} className="flex h-10 items-center justify-between border-b border-line-soft last:border-0">
            <span className="text-[13px] text-muted">{l}</span>
            <Kbd>{k}</Kbd>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Settings({ back, initial = 'license' }: { back: Screen; initial?: Section }) {
  const go = useApp((s) => s.go);
  const [section, setSection] = useState<Section>(initial);
  const [version, setVersion] = useState('');
  useEffect(() => {
    getVersion().then(setVersion, () => {});
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && go(back);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back, go]);

  return (
    <div className="flex h-full flex-col">
      <TitleBar title="Pengaturan" />
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-52 shrink-0 flex-col gap-0.5 border-r border-line-soft bg-panel p-3 lg:w-60">
          <div className="mb-2 flex items-center gap-2">
            <IconButton icon={ArrowLeft} label="Kembali" onClick={() => go(back)} />
            <span className="text-xs text-faint">Esc</span>
          </div>
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setSection(n.id)}
              className={cx(
                'flex h-9 items-center gap-2.5 rounded-lg px-3 text-[13px]',
                section === n.id ? 'bg-raised font-semibold text-fg' : 'text-muted hover:bg-panel-2',
              )}
            >
              <n.icon size={16} className={section === n.id ? 'text-gold-text' : undefined} />
              {n.label}
            </button>
          ))}
        </nav>
        <main className="flex-1 overflow-y-auto px-6 py-8 lg:px-12 lg:py-9">
          {section === 'license' && (
            <div className="flex max-w-[760px] flex-col gap-5">
              <h1 className="text-[22px] font-semibold">Lisensi &amp; perangkat</h1>
              <div className="flex flex-col gap-3 rounded-2xl border border-line-soft bg-panel p-5">
                <span className="flex items-center gap-2.5 text-base font-semibold">
                  <BadgeCheck size={20} className="text-gold-text" /> Versi pengembangan
                  <Chip color="var(--color-maybe)">Belum perlu aktivasi</Chip>
                </span>
                <p className="text-[13px] text-muted">
                  Aktivasi lisensi (1 lisensi = 1 perangkat, update gratis selamanya) dibuat setelah server lisensi di
                  pilihfotomu-api siap. Untuk sekarang semua fitur terbuka.
                </p>
              </div>
            </div>
          )}
          {section === 'keys' && <KeyEditor />}
          {section === 'about' && (
            <div className="flex max-w-[560px] flex-col gap-3">
              <h1 className="text-[22px] font-semibold">pilihfotomu</h1>
              <p className="text-[13px] text-muted">Versi {version || '—'}</p>
              <p className="text-[13px] text-muted">
                Semua foto diproses di perangkat ini. Tidak ada foto yang di-upload, dan file asli tidak pernah diubah.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
