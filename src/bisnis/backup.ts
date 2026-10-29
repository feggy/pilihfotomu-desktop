/**
 * Backups of Kelola Bisnis, which lives on this computer only: a file saved
 * by hand, a file restored, and — once a folder is chosen (one iCloud Drive
 * or Google Drive keeps in the cloud) — a copy written there on every change,
 * plus one a day to go back to (the last 30 days, then one a month).
 */

import { documentDir, join } from '@tauri-apps/api/path';

import { api } from '../lib/api';
import { dayKey, fromJson } from './model';
import { onBisnisSaved, useBisnis } from './store';
import type { BisnisData } from './types';

const AUTO_KEY = 'pilihfotomu-bisnis-auto-backup';
/** Daily copies kept whole; older ones thin out to one a month. */
const KEEP_DAYS = 30;
const joinPath = (dir: string, name: string) => `${dir}${dir.includes('\\') && !dir.includes('/') ? '\\' : '/'}${name}`;

export const backupName = (day = dayKey(new Date())) => `pilihfotomu-bisnis-${day}.json`;

/** When the folder copy last succeeded (kept outside the data: writing it there would save again, and again). */
export function lastAutoBackup(): number | null {
  try {
    return Number(localStorage.getItem(AUTO_KEY)) || null;
  } catch {
    return null;
  }
}

let failed: string | null = null;
/** Why the folder copy last failed (the folder gone, a drive unplugged), or null. */
export const autoBackupError = () => failed;

/** After every save: the folder's copy, and today's copy the first time today. */
onBisnisSaved(async (json, data) => {
  const dir = data.settings.backupDir;
  if (!dir) return;
  const bytes = new TextEncoder().encode(json);
  try {
    await api.writeUserFile(joinPath(dir, 'pilihfotomu-bisnis.json'), bytes);
    const today = dayKey(new Date());
    const last = lastAutoBackup();
    if (!last || dayKey(new Date(last)) !== today) {
      await api.writeUserFile(joinPath(dir, backupName(today)), bytes);
      // Once a day: the last 30 days kept, and one a month before that, so the folder doesn't grow for ever.
      const keepFrom = new Date();
      keepFrom.setDate(keepFrom.getDate() - KEEP_DAYS);
      api.pruneBackups(dir, dayKey(keepFrom)).catch(() => {});
    }
    failed = null;
    try {
      localStorage.setItem(AUTO_KEY, String(Date.now()));
    } catch {
      /* the time is only shown */
    }
  } catch (e) {
    failed = String(e);
  }
});

/**
 * A backup folder from the start, in Documents (iCloud keeps it too when
 * Desktop & Documents sync is on): given once, so one turned off stays off.
 */
export async function ensureDefaultBackupDir() {
  const { data, update } = useBisnis.getState();
  if (!data || data.settings.backupDir || data.settings.backupDefaulted) return;
  let dir: string;
  try {
    dir = await join(await documentDir(), 'pilihfotomu', 'Backup Kelola Bisnis');
  } catch {
    return;
  }
  update((d) => (d.settings.backupDir || d.settings.backupDefaulted ? d : { ...d, settings: { ...d.settings, backupDir: dir, backupDefaulted: true } }));
}

/** Everything as one file at `path`; remembered as the last backup. */
export async function exportBackup(path: string) {
  const { data, update } = useBisnis.getState();
  if (!data) return;
  await api.writeUserFile(path, new TextEncoder().encode(JSON.stringify(data, null, 1)));
  update((d) => ({ ...d, settings: { ...d.settings, lastBackup: Date.now() } }));
}

/** A backup file read and checked, not yet put in place. */
export async function readBackup(path: string): Promise<BisnisData> {
  return fromJson(await api.readUserFile(path));
}

/**
 * `restored` in place of everything now. The data it replaces stays one step
 * back as `data.prev.json` (`save_bisnis`), so a wrong restore can be undone by hand.
 */
export function applyBackup(restored: BisnisData) {
  useBisnis.getState().update((now) => ({
    ...restored,
    // This computer's backup choices stay; the restored file's may point nowhere here.
    settings: { ...restored.settings, backupDir: now.settings.backupDir, lastBackup: now.settings.lastBackup },
  }));
}

/** Most recent backup of any kind, for the reminder to make one. */
export function lastBackupAt(data: BisnisData): number | null {
  const auto = data.settings.backupDir ? lastAutoBackup() : null;
  return Math.max(data.settings.lastBackup ?? 0, auto ?? 0) || null;
}
