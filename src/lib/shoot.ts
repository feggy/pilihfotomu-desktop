/**
 * Shoot types and the analysis defaults (Pengaturan › Analisis). What each
 * type changes is decided in `cull::profile`; the `rule` lines here say the
 * same in words — keep both in step.
 */

import { Ellipsis, Flower2, Gem, GraduationCap, Heart, House, Sparkles, User, Users, type LucideIcon } from 'lucide-react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { Options, ShootType } from './api';
import { t } from './i18n';

const RULE = {
  general: 'Semua wajah diperhatikan, termasuk tamu yang berkedip di latar.',
  subject: 'Mata dan fokus dinilai dari subjek utama. Tamu yang berkedip di latar diabaikan.',
  group: 'Foto grup: semua orang dihitung, wajah yang kecil di pinggir pun.',
  none: 'Wajah tidak dinilai. Hanya ketajaman, eksposur, dan duplikat.',
};

interface Shoot {
  id: ShootType;
  icon: LucideIcon;
  readonly label: string;
  readonly sub: string;
  readonly rule: string;
}

/** Texts are getters: read in the current language. */
const shoot = (id: ShootType, icon: LucideIcon, label: string, sub: string, rule: string): Shoot => ({
  id,
  icon,
  get label() {
    return t(label);
  },
  get sub() {
    return t(sub);
  },
  get rule() {
    return t(rule);
  },
});

export const SHOOT_TYPES: Shoot[] = [
  shoot('wedding', Heart, 'Wedding', 'Akad, resepsi, keluarga', RULE.subject),
  shoot('prewedding', Flower2, 'Prewedding', 'Pasangan, outdoor', RULE.subject),
  shoot('lamaran', Gem, 'Lamaran', 'Engagement, siraman', RULE.subject),
  shoot('wisuda', GraduationCap, 'Wisuda', 'Keluarga, toga', RULE.group),
  shoot('event', Users, 'Event', 'Seminar, ulang tahun', RULE.subject),
  shoot('keluarga', House, 'Keluarga', 'Foto keluarga, maternity', RULE.group),
  shoot('portrait', User, 'Portrait', 'Personal, profil, model', RULE.subject),
  shoot('lainnya', Ellipsis, 'Lainnya', 'Produk, makanan, tempat', RULE.none),
];

export const GENERAL = shoot('auto', Sparkles, 'Umum', '', RULE.general);

export const shootLabel = (type: ShootType) => (type === 'auto' ? GENERAL.label : SHOOT_TYPES.find((s) => s.id === type)!.label);
export const shootRule = (type: ShootType) => (type === 'auto' ? GENERAL.rule : SHOOT_TYPES.find((s) => s.id === type)!.rule);

/**
 * Choosing a shoot type also sets the face checks: off for products and the
 * like (nothing to read, and it saves time), back on when going from there
 * to a shoot with people.
 */
export function withShootType(o: Options, shootType: ShootType): Options {
  if (shootType === 'lainnya') return { ...o, shootType, checkEyes: false, checkSmile: false };
  if (o.shootType === 'lainnya') return { ...o, shootType, checkEyes: true, checkSmile: true };
  return { ...o, shootType };
}

export const FACTORY_OPTIONS: Options = {
  strictness: 'balanced',
  shootType: 'auto',
  checkBlur: true,
  checkExposure: true,
  checkDuplicates: true,
  checkEyes: true,
  checkSmile: true,
};

interface DefaultsState {
  options: Options;
  set: (o: Options) => void;
  reset: () => void;
}

/** What a new analysis starts with; set in Pengaturan › Analisis. */
export const useDefaults = create<DefaultsState>()(
  persist(
    (set) => ({
      options: FACTORY_OPTIONS,
      set: (options) => set({ options }),
      reset: () => set({ options: FACTORY_OPTIONS }),
    }),
    {
      name: 'pilihfotomu-analysis-v1',
      merge: (saved, cur) => ({ ...cur, options: { ...FACTORY_OPTIONS, ...((saved as DefaultsState)?.options ?? {}) } }),
    },
  ),
);
