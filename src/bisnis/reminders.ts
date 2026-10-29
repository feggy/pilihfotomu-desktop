/**
 * Reminders: a shoot today or tomorrow, a balance due soon (or overdue),
 * photos due to be delivered. Worked out from the bookings whenever they or
 * the day change; each has a key, so one put away stays away and one already
 * notified isn't notified again.
 */

import { t } from '../lib/i18n';
import { balanceOf, clientOf, dayKey, longDate, rupiah, timeOf, titleOf } from './model';
import type { BisnisData, Booking } from './types';

export interface Reminder {
  /** Stable per thing and date: `shoot:<session>:<day>`, `due:<booking>:<date>`, `kirim:<booking>:<date>`. */
  key: string;
  kind: 'shoot' | 'due' | 'kirim';
  booking: Booking;
  title: string;
  detail: string;
  /** Today or past: shown first, in the reminder's warning colour. */
  urgent: boolean;
  /** For ordering: when it is about. */
  at: string;
}

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return dayKey(new Date(y!, m! - 1, d! + n));
};

export function remindersOf(data: BisnisData, now = new Date()): Reminder[] {
  const today = dayKey(now);
  const tomorrow = addDays(today, 1);
  const inactive = new Set(data.columns.filter((c) => c.inactive).map((c) => c.id));
  const done = new Set(data.columns.filter((c) => c.done).map((c) => c.id));
  const s = data.settings;
  const out: Reminder[] = [];
  for (const b of data.bookings) {
    if (inactive.has(b.columnId)) continue;
    const who = titleOf(data, b);
    if (s.remindShoot)
      for (const x of b.sessions) {
        const day = x.start.split('T')[0]!;
        if (day !== today && day !== tomorrow) continue;
        out.push({
          key: `shoot:${x.id}:${day}`,
          kind: 'shoot',
          booking: b,
          title: t(day === today ? 'Hari ini: {who}' : 'Besok: {who}', { who: `${who}${x.label ? ` (${x.label})` : ''}` }),
          detail: `${timeOf(x.start)}–${timeOf(x.end)}${x.location ? ` · ${x.location}` : ''}`,
          urgent: day === today,
          at: x.start,
        });
      }
    const owed = balanceOf(b);
    if (b.dueDate && owed > 0 && b.dueDate <= addDays(today, s.remindDueDays)) {
      const late = b.dueDate < today;
      out.push({
        key: `due:${b.id}:${b.dueDate}`,
        kind: 'due',
        booking: b,
        title: t(late ? 'Lewat jatuh tempo: {who}' : 'Pelunasan: {who}', { who }),
        detail: t('Sisa {n} · {when}', { n: rupiah(owed), when: b.dueDate === today ? t('hari ini') : longDate(b.dueDate) }),
        urgent: b.dueDate <= today,
        at: `${b.dueDate}T00:00`,
      });
    }
    if (s.remindDelivery && b.deliveryDate && !done.has(b.columnId) && b.deliveryDate <= addDays(today, 2)) {
      const late = b.deliveryDate < today;
      out.push({
        key: `kirim:${b.id}:${b.deliveryDate}`,
        kind: 'kirim',
        booking: b,
        title: t(late ? 'Terlambat kirim hasil: {who}' : 'Kirim hasil: {who}', { who }),
        detail: b.deliveryDate === today ? t('Hari ini') : longDate(b.deliveryDate),
        urgent: b.deliveryDate <= today,
        at: `${b.deliveryDate}T00:00`,
      });
    }
  }
  const dismissed = new Set(data.dismissed);
  return out.filter((r) => !dismissed.has(r.key)).sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.at.localeCompare(b.at));
}

/** A reminder as a notification's body: who to contact, if it is a payment. */
export function notificationBody(data: BisnisData, r: Reminder): string {
  const phone = clientOf(data, r.booking)?.phone;
  return r.kind === 'due' && phone ? `${r.detail} · ${phone}` : r.detail;
}

/**
 * The Google Calendar page that adds `session` as an event (the browser
 * opens it; one click to save). Its reminders are the calendar's own
 * defaults — Google takes no reminder from a link.
 */
export function googleCalendarLink(title: string, start: string, end: string, location: string, details: string): string {
  const stamp = (s: string) => `${s.replace(/[-:]/g, '')}00`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    dates: `${stamp(start)}/${stamp(end)}`,
    ctz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    details,
    location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
