import {
  CircleCheck,
  Copy,
  Crown,
  EyeOff,
  Focus,
  Images,
  ListOrdered,
  Moon,
  ScanEye,
  UserRound,
  Sun,
  type LucideIcon,
} from 'lucide-react';

import { eyesClosed, smiling, type Face, type PhotoEntry, type Reason, type Status } from './api';
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
  overLimit: reason('Melebihi batas jumlah', ListOrdered, 'maybe'),
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

/**
 * People in a photo, in fixed groups so the filter stays short however
 * crowded the session is. Labels are translated when shown.
 */
export const CROWD = [
  { id: 'none', label: 'Tanpa orang', min: 0, max: 0 },
  { id: 'one', label: '1 orang', min: 1, max: 1 },
  { id: 'two', label: '2 orang', min: 2, max: 2 },
  { id: 'few', label: '3–5 orang', min: 3, max: 5 },
  { id: 'group', label: '6–10 orang', min: 6, max: 10 },
  { id: 'crowd', label: 'Ramai (11+)', min: 11, max: Infinity },
] as const;
export type CrowdKind = (typeof CROWD)[number]['id'];

/** Which group a photo's face count falls in. */
export const crowdOf = (p: PhotoEntry): CrowdKind => {
  const n = p.faces?.length ?? 0;
  return CROWD.find((c) => n >= c.min && n <= c.max)!.id;
};

const typicalCache = new WeakMap<PhotoEntry[], number | null>();

/**
 * The session's usual in-focus face: median over photos of each photo's
 * sharpest face (mirrors `cull::typical_face`; null under 6 photos).
 */
function typicalFace(photos: PhotoEntry[]): number | null {
  if (typicalCache.has(photos)) return typicalCache.get(photos)!;
  const best = photos
    .map((p) => Math.max(...(p.faces ?? []).map((f) => f.sharpness ?? -1)))
    .filter((v) => v >= 0)
    .sort((a, b) => a - b);
  const v = best.length >= 6 ? best[Math.floor(best.length / 2)] : null;
  typicalCache.set(photos, v);
  return v;
}

/**
 * The face's sharpness against the session's usual face, 0–100 % — the
 * frame's own sharpness is its sharpest patch, often the background.
 */
export function faceSharpness(p: PhotoEntry, session: PhotoEntry[]): number | null {
  // Against the same person's usual face when known (`Face::sharp_ref`).
  const usual = typicalFace(session);
  const ratios = (p.faces ?? [])
    .map((f) => (f.sharpness != null && (f.sharpRef ?? usual) ? f.sharpness / (f.sharpRef ?? usual)! : -1))
    .filter((r) => r >= 0);
  if (!ratios.length) return null;
  return Math.min(100, Math.round(Math.max(...ratios) * 100));
}

/** Photos per person, seen at least this often to be listed. */
export const PERSON_MIN = 3;

export interface Person {
  id: number;
  /** Photos they're in, and how many of those are Pilih. */
  photos: number;
  picks: number;
  /** Where to draw them from: the photo with their largest face. */
  cover: PhotoEntry;
  face: Face;
}

const peopleCache = new WeakMap<PhotoEntry[], Person[]>();

/** The session's recurring people, most photographed first. */
export function peopleOf(photos: PhotoEntry[]): Person[] {
  if (peopleCache.has(photos)) return peopleCache.get(photos)!;
  const map = new Map<number, Person>();
  for (const p of photos) {
    const seen = new Set<number>();
    for (const f of p.faces ?? []) {
      if (f.person == null || seen.has(f.person)) continue;
      seen.add(f.person);
      const cur = map.get(f.person) ?? { id: f.person, photos: 0, picks: 0, cover: p, face: f };
      cur.photos++;
      if (p.status === 'pick') cur.picks++;
      if (f.w * f.h > cur.face.w * cur.face.h) Object.assign(cur, { cover: p, face: f });
      map.set(f.person, cur);
    }
  }
  const list = [...map.values()].filter((x) => x.photos >= PERSON_MIN).sort((a, b) => b.photos - a.photos);
  peopleCache.set(photos, list);
  return list;
}

/** The session was analyzed before blink scores and people existed. */
export const oldFaces = (photos: PhotoEntry[]) => {
  const faces = photos.flatMap((p) => p.faces ?? []);
  return faces.length > 0 && faces.every((f) => f.blink == null || f.person === undefined);
};

/** "2 dari 2 terbuka" / "1 dari 3 terpejam" — null when eyes weren't checked or no face was found. */
export function eyeSummary(p: PhotoEntry): { label: string; tone: Status } | null {
  if (!p.faces?.length) return null;
  const closed = p.faces.filter(eyesClosed).length;
  return closed
    ? { label: t('{n} dari {total} terpejam', { n: closed, total: p.faces.length }), tone: 'maybe' }
    : { label: p.faces.length === 1 ? t('Terbuka') : t('{n} wajah terbuka', { n: p.faces.length }), tone: 'pick' };
}
