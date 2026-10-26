/**
 * Edit foto's settings outside one photo: the ready-made presets, the
 * photographer's own (kept on this computer), and copying settings from one
 * photo to others as Lightroom's Copy, Paste and Sync do.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { ADJUST_PRESETS, NO_ADJUST, syncAdjust, type AdjustGroup, type PhotoAdjust } from '../kreasi/engine/document';

/** Every group Copy / Paste / Sync carry (masks, AI Denoise and RAW stay with their photo). */
export const ALL_GROUPS: ReadonlySet<AdjustGroup> = new Set(['dasar', 'kurva', 'warna', 'detail', 'efek']);

/** `target` with `look`'s settings in `groups` (all of them unless asked). */
export const applyLook = (look: PhotoAdjust | undefined, target: PhotoAdjust | undefined, groups = ALL_GROUPS) =>
  syncAdjust(look, target, groups, { source: false, target: null });

/** Anything changed from the photo as it came. */
export function isEdited(a: PhotoAdjust | undefined): boolean {
  if (!a) return false;
  return Object.entries(a).some(([k, v]) => {
    if (v == null || k === 'hidden') return false;
    if (k === 'mono') return v === true;
    if (typeof v === 'number') return v !== 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
}

export interface Look {
  id: string;
  name: string;
  adjust: PhotoAdjust;
  /** Imported presets keep the group they came in (Lightroom's, or one chosen); unset: Preset saya. */
  group?: string;
}

/** pilihfotomu's own looks, the engine's ready-made ones. */
export const BUILT_IN: Look[] = ADJUST_PRESETS.map((p) => ({ id: `pf-${p.id}`, name: p.name, adjust: p.adjust }));

/** "Simpan sebagai preset": the photographer's own looks, on this computer. */
export const useMyLooks = create<{
  looks: Look[];
  /** Into `group`; none is Preset saya. */
  add: (name: string, a: PhotoAdjust, group?: string) => void;
  /** Presets brought in from Lightroom, into `group`. */
  addMany: (list: { name: string; adjust: PhotoAdjust }[], group: string) => void;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
  /** To another group; none is Preset saya. */
  move: (id: string, group: string | undefined) => void;
  renameGroup: (from: string, to: string) => void;
  /** The group and its presets. */
  removeGroup: (group: string) => void;
}>()(
  persist(
    (set) => ({
      looks: [],
      add: (name, a, group) =>
        set(({ looks }) => ({
          // Only what a preset carries: nothing made from that one photo.
          looks: [...looks, { id: `my-${Date.now().toString(36)}`, name: name.trim(), adjust: applyLook(a, NO_ADJUST), group: group?.trim() || undefined }],
        })),
      addMany: (list, group) =>
        set(({ looks }) => ({
          looks: [
            ...looks,
            ...list.map((l, i) => ({ id: `lr-${Date.now().toString(36)}-${i}`, name: l.name, adjust: applyLook(l.adjust, NO_ADJUST), group })),
          ],
        })),
      remove: (id) => set(({ looks }) => ({ looks: looks.filter((l) => l.id !== id) })),
      rename: (id, name) => set(({ looks }) => ({ looks: looks.map((l) => (l.id === id && name.trim() ? { ...l, name: name.trim() } : l)) })),
      move: (id, group) => set(({ looks }) => ({ looks: looks.map((l) => (l.id === id ? { ...l, group: group?.trim() || undefined } : l)) })),
      renameGroup: (from, to) =>
        set(({ looks }) => ({ looks: to.trim() ? looks.map((l) => (l.group === from ? { ...l, group: to.trim() } : l)) : looks })),
      removeGroup: (group) => set(({ looks }) => ({ looks: looks.filter((l) => l.group !== group) })),
    }),
    { name: 'pilihfotomu-edit-looks-v1' },
  ),
);
