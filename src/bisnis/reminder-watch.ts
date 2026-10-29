/**
 * Reminders while the app is open, on any screen: read once at start, then
 * every few minutes (and as bookings change), each new one shown once as a
 * system notification. Closed, the app reminds no one — said in Pengaturan.
 */

import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { useEffect } from 'react';

import { t } from '../lib/i18n';
import { notificationBody, remindersOf } from './reminders';
import { useBisnis } from './store';

let allowed: boolean | null = null;
async function canNotify() {
  if (allowed == null) allowed = (await isPermissionGranted()) || (await requestPermission()) === 'granted';
  return allowed;
}

async function check() {
  const { data, update } = useBisnis.getState();
  if (!data) return;
  const due = remindersOf(data);
  const seen = new Set(data.notified);
  const fresh = due.filter((r) => !seen.has(r.key));
  if (!fresh.length) return;
  if (await canNotify().catch(() => false)) {
    // A few one by one; more as one summary, not a flood.
    if (fresh.length <= 3) for (const r of fresh) sendNotification({ title: r.title, body: notificationBody(data, r) });
    else sendNotification({ title: t('{n} pengingat Kelola Bisnis', { n: fresh.length }), body: fresh.slice(0, 3).map((r) => r.title).join('\n') });
  }
  // Remembered, the list kept to what is still due.
  const keys = new Set(due.map((r) => r.key));
  update((d) => ({ ...d, notified: [...d.notified.filter((k) => keys.has(k)), ...fresh.map((r) => r.key)] }));
}

export function useReminderWatch() {
  useEffect(() => {
    useBisnis.getState().load().then(check);
    const timer = window.setInterval(check, 5 * 60_000);
    // Bookings changed: a new reminder may be due now.
    let last = useBisnis.getState().data?.bookings;
    const off = useBisnis.subscribe((s) => {
      if (s.data && s.data.bookings !== last) {
        last = s.data.bookings;
        check();
      }
    });
    return () => {
      window.clearInterval(timer);
      off();
    };
  }, []);
}
