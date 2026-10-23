import {
  CircleCheck,
  Copy,
  Crown,
  EyeOff,
  Focus,
  Moon,
  ScanEye,
  UserRound,
  Sun,
  type LucideIcon,
} from 'lucide-react';

import { eyesClosed, smiling, type PhotoEntry, type Reason, type Status } from './api';

const nf = new Intl.NumberFormat('id-ID');
export const num = (n: number) => nf.format(n);

export function bytes(n: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(n)} ${units[i]}`;
}

export function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} dtk`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} mnt ${s % 60} dtk` : `${m} mnt`;
}

export const date = (unixSeconds: number) =>
  new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(unixSeconds * 1000),
  );

/** Capture time is camera-local seconds since 1970, not a UTC instant. */
export const clock = (takenAt: number | null) => {
  if (takenAt == null) return null;
  const d = new Date(takenAt * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};

/** Capture date (camera-local, so read as UTC): "12 Okt 2026". */
export const shotDate = (takenAt: number | null) =>
  takenAt == null
    ? null
    : new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(takenAt * 1000),
      );

export const STATUS: Record<Status, { label: string; one: string; color: string; key: string }> = {
  pick: { label: 'Dipilih', one: 'Pilih', color: 'var(--color-pick)', key: 'P' },
  maybe: { label: 'Dicek', one: 'Cek', color: 'var(--color-maybe)', key: 'U' },
  reject: { label: 'Dilewati', one: 'Lewati', color: 'var(--color-reject)', key: 'X' },
};

export type ReasonKind = Reason['kind'];

export const REASON: Record<ReasonKind, { label: string; icon: LucideIcon; tone: Status | 'gold' }> = {
  blur: { label: 'Blur', icon: Focus, tone: 'reject' },
  softFocus: { label: 'Kurang tajam', icon: ScanEye, tone: 'maybe' },
  subjectSoft: { label: 'Subjek kurang tajam', icon: UserRound, tone: 'maybe' },
  dark: { label: 'Terlalu gelap', icon: Moon, tone: 'maybe' },
  bright: { label: 'Terlalu terang', icon: Sun, tone: 'maybe' },
  duplicate: { label: 'Duplikat', icon: Copy, tone: 'reject' },
  eyesClosed: { label: 'Terdeteksi terpejam', icon: EyeOff, tone: 'maybe' },
  bestInGroup: { label: 'Terbaik di grup', icon: Crown, tone: 'gold' },
};

export const toneColor = (tone: Status | 'gold') =>
  tone === 'gold' ? 'var(--color-gold-text)' : STATUS[tone].color;

export const PassIcon = CircleCheck;

/** "2 dari 3 wajah tersenyum" — informational only, never a fault. */
export function smileSummary(p: PhotoEntry): { label: string; tone: Status | 'gold' } | null {
  const read = (p.faces ?? []).filter((f) => f.smile != null);
  if (!read.length) return null;
  const n = read.filter(smiling).length;
  if (read.length === 1) return n ? { label: 'Tersenyum', tone: 'gold' } : { label: 'Netral', tone: 'pick' };
  return { label: n ? `${n} dari ${read.length} tersenyum` : 'Semua netral', tone: n ? 'gold' : 'pick' };
}

/** Photo has someone smiling (for the sidebar filter). */
export const hasSmile = (p: PhotoEntry) => (p.faces ?? []).some(smiling);

/** "2 dari 2 terbuka" / "1 dari 3 terpejam" — null when eyes weren't checked or no face was found. */
export function eyeSummary(p: PhotoEntry): { label: string; tone: Status } | null {
  if (!p.faces?.length) return null;
  const closed = p.faces.filter(eyesClosed).length;
  return closed
    ? { label: `${closed} dari ${p.faces.length} terpejam`, tone: 'maybe' }
    : { label: p.faces.length === 1 ? 'Terbuka' : `${p.faces.length} wajah terbuka`, tone: 'pick' };
}
