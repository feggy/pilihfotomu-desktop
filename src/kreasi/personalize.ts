/**
 * Puts the client's name, the date and the studio into a template: the
 * bundled templates carry example names ("Rara & Dimas", "Raka Pratama"),
 * example dates and "Namastudio", which are swapped where they appear.
 * Anything else written in a template stays as it is.
 */

import type { CollageDoc } from './engine/document';

export interface ClientInfo {
  /** "Rina & Dimas", or one person's name ("Raka Pratama"). */
  name: string;
  /** The shoot day as the camera's clock read it, stored as UTC seconds (like `PhotoEntry.takenAt`), or none. */
  date: number | null;
  /** The name put in last time, swapped too when the name is changed again. */
  applied?: string;
}

/** Example couples in the bundled templates (public/kreasi/templates.json). */
const COUPLES = [
  'Ketut Susilo & Cahaya Dewi',
  'Rara & Dimas',
  'Laras & Bagas',
  'Citra & Hanif',
  'Intan & Fajar',
  'Maya & Yoga',
  'Nadia & Arga',
  'Salma & Fikri',
  'Tiara & Reza',
];
/** Example people (graduates, a newborn); a degree after them stays. */
const PEOPLE = [
  'Aulia Rahma',
  'Bima Aditya',
  'Dimas Saputra',
  'Dinda Maharani',
  'Farah Begum',
  'Farah Nabila',
  'Haifa Rahmani',
  'Raka Pratama',
  'Rizky Hidayat',
  'Salsa Amelia',
  'Salsa Putri',
  'Winda Saputri',
  'Arka Pradipta',
];
const STUDIOS = ['Namastudio', 'Nama Studio'];

const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const LONG_DATE = new RegExp(`\\b\\d{1,2} (${MONTHS.join('|')}) \\d{4}\\b`, 'g');
const SHORT_DATE = /\b\d{2}\.\d{2}\.\d{4}\b/g;
const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
/** A day name just before a date ("Sabtu, 07.11.2026"): follows the date. */
const DAY_BEFORE_DATE = new RegExp(`\\b(${DAYS.join('|')})(?=, (\\d{2}\\.\\d{2}\\.\\d{4}|\\d{1,2} (${MONTHS.join('|')})))`, 'g');

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const any = (list: string[]) => new RegExp(list.map(escape).join('|'), 'g');

/** `text` with the examples replaced. */
export function personalizeText(text: string, client: ClientInfo, studio: string): string {
  let out = text;
  const name = client.name.trim();
  if (name) {
    // A couple's slot takes the whole name; a single person's slot too.
    const before = client.applied?.trim();
    out = out.replace(any(before && before !== name ? [...COUPLES, before] : COUPLES), name).replace(any(PEOPLE), name);
  }
  if (studio.trim()) out = out.replace(any(STUDIOS), studio.trim());
  if (client.date != null) {
    const d = new Date(client.date * 1000);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    out = out
      .replace(DAY_BEFORE_DATE, DAYS[d.getUTCDay()]!)
      .replace(SHORT_DATE, `${dd}.${mm}.${d.getUTCFullYear()}`)
      .replace(LONG_DATE, `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`);
  }
  return out;
}

/** The design with every text personalised; the same object when nothing changed. */
export function personalize(doc: CollageDoc, client: ClientInfo, studio: string): CollageDoc {
  let changed = false;
  const texts = doc.texts.map((x) => {
    const text = personalizeText(x.text, client, studio);
    if (text === x.text) return x;
    changed = true;
    return { ...x, text };
  });
  return changed ? { ...doc, texts } : doc;
}
