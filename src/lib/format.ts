import {
  CircleCheck,
  Copy,
  Crown,
  EyeOff,
  Focus,
  Images,
  Moon,
  ScanEye,
  UserRound,
  Sun,
  type LucideIcon,
} from 'lucide-react';

import { eyesClosed, smiling, type PhotoEntry, type Reason, type Status } from './api';
import { locale, t } from './i18n';

export const num = (n: number) => new Intl.NumberFormat(locale()).format(n);
/** `n` with exactly `digits` decimals, in the language's own way (0,5 / 0.5). */
export const fixed = (n: number, digits: number) =>
  new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);

export function bytes(n: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(n)} ${units[i]}`;
}

export function duration(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return t('{s} dtk', { s });
  const m = Math.floor(s / 60);
  return s % 60 ? t('{m} mnt {s} dtk', { m, s: s % 60 }) : t('{m} mnt', { m });
}

export const date = (unixSeconds: number) =>
  new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(
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
    : new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(takenAt * 1000),
      );

/** Labels are getters: read in the current language. */
const status = (label: string, one: string, color: string, key: string) => ({
  get label() {
    return t(label);
  },
  get one() {
    return t(one);
  },
  color,
  key,
});

export const STATUS: Record<Status, { readonly label: string; readonly one: string; color: string; key: string }> = {
  pick: status('Dipilih', 'Pilih', 'var(--color-pick)', 'P'),
  maybe: status('Dicek', 'Cek', 'var(--color-maybe)', 'U'),
  reject: status('Dilewati', 'Lewati', 'var(--color-reject)', 'X'),
};

export type ReasonKind = Reason['kind'];

const reason = (label: string, icon: LucideIcon, tone: Status | 'gold') => ({
  get label() {
    return t(label);
  },
  icon,
  tone,
});

export const REASON: Record<ReasonKind, { readonly label: string; icon: LucideIcon; tone: Status | 'gold' }> = {
  blur: reason('Blur', Focus, 'reject'),
  softFocus: reason('Kurang tajam', ScanEye, 'maybe'),
  subjectSoft: reason('Subjek kurang tajam', UserRound, 'maybe'),
  dark: reason('Terlalu gelap', Moon, 'maybe'),
  bright: reason('Terlalu terang', Sun, 'maybe'),
  duplicate: reason('Duplikat', Copy, 'reject'),
  eyesClosed: reason('Terdeteksi terpejam', EyeOff, 'maybe'),
  bestInGroup: reason('Terbaik di grup', Crown, 'gold'),
  similar: reason('Pose mirip', Images, 'maybe'),
};

export const toneColor = (tone: Status | 'gold') =>
  tone === 'gold' ? 'var(--color-gold-text)' : STATUS[tone].color;

export const PassIcon = CircleCheck;

/** "2 dari 3 wajah tersenyum" — informational only, never a fault. */
export function smileSummary(p: PhotoEntry): { label: string; tone: Status | 'gold' } | null {
  const read = (p.faces ?? []).filter((f) => f.smile != null);
  if (!read.length) return null;
  const n = read.filter(smiling).length;
  if (read.length === 1) return n ? { label: t('Tersenyum'), tone: 'gold' } : { label: t('Netral'), tone: 'pick' };
  return {
    label: n ? t('{n} dari {total} tersenyum', { n, total: read.length }) : t('Semua netral'),
    tone: n ? 'gold' : 'pick',
  };
}

/** Photo has someone smiling (for the sidebar filter). */
export const hasSmile = (p: PhotoEntry) => (p.faces ?? []).some(smiling);

/** "2 dari 2 terbuka" / "1 dari 3 terpejam" — null when eyes weren't checked or no face was found. */
export function eyeSummary(p: PhotoEntry): { label: string; tone: Status } | null {
  if (!p.faces?.length) return null;
  const closed = p.faces.filter(eyesClosed).length;
  return closed
    ? { label: t('{n} dari {total} terpejam', { n: closed, total: p.faces.length }), tone: 'maybe' }
    : { label: p.faces.length === 1 ? t('Terbuka') : t('{n} wajah terbuka', { n: p.faces.length }), tone: 'pick' };
}
