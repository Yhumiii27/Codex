import type { Localized } from '@/db/schema';
import type { Lang } from './i18n';

export const TIME_ZONE = 'Europe/Paris';

export function loc(v: Localized | null | undefined, lang: Lang): string {
  if (v == null) return '';
  return typeof v === 'string' ? v : v[lang];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-10-05 → "05/10/2026" (fr) or "5 Oct 2026" (en), as in the mockup. */
export function fmtDate(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return lang === 'fr' ? `${d}/${m}/${y}` : `${+d} ${MONTHS[+m - 1]} ${y}`;
}

/** "2026-10-05 09:45:00" → "05/10 09:45" (audit log and activity feeds). */
export function fmtWhen(ts: string): string {
  const [date, time = ''] = ts.split(/[ T]/);
  const [, m, d] = date.split('-');
  return `${d}/${m} ${time.slice(0, 5)}`;
}

/** "2026-10-05 09:45:00" → "05/10/2026 09:45" (fr) or "5 Oct 2026 09:45" (en): a timestamp in a list spanning years. */
export function fmtDateTime(ts: string, lang: Lang): string {
  const [date, time = ''] = ts.split(/[ T]/);
  return `${fmtDate(date, lang)} ${time.slice(0, 5)}`.trim();
}

/** Time only when the timestamp is today, otherwise day and time. */
export function fmtClock(ts: string): string {
  return ts.slice(0, 10) === todayIso() ? ts.slice(11, 16) : fmtWhen(ts);
}

const stampFmt = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Current local timestamp, "YYYY-MM-DD HH:mm:ss" (Paris time). */
export function nowStamp(): string {
  return stampFmt.format(new Date()).replace('T', ' ');
}

/** An instant as Postgres writes a timestamptz ("2026-10-05 07:45:00.123+00") or in ISO form → milliseconds since the epoch. */
function instant(ts: string): number {
  return Date.parse(ts.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
}

/** UTC instant (audit log) → Paris time "YYYY-MM-DD HH:mm:ss", as nowStamp writes it. */
export function parisStamp(ts: string): string {
  return stampFmt.format(instant(ts)).replace('T', ' ');
}

/** Paris time "YYYY-MM-DD HH:mm:ss" → UTC instant in ISO form (demo data written in local time). */
export function parisToUtc(local: string): string {
  const asUtc = instant(`${local}Z`);
  const offset = (t: number) => instant(`${parisStamp(new Date(t).toISOString())}Z`) - t;
  // Second pass for the hours around a change of daylight saving time.
  return new Date(asUtc - offset(asUtc - offset(asUtc))).toISOString();
}

export function todayIso(): string {
  return nowStamp().slice(0, 10);
}

export function todayLong(lang: Lang): string {
  const s = new Date().toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TIME_ZONE });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * A real calendar day "YYYY-MM-DD" (an ISO timestamp keeps its day), or null: "2026-02-30" is refused, and so is the
 * year 0000, which has no day in Postgres.
 */
export function parseIsoDay(v: string | null | undefined): string | null {
  const day = v && /^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(v) && !v.startsWith('0000') ? v.slice(0, 10) : '';
  return day && !Number.isNaN(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day ? day : null;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Same day `years` later; 29 February falls back to the 28th in non-leap years. */
export function addYears(iso: string, years: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const last = new Date(Date.UTC(y + years, m, 0)).getUTCDate();
  return `${y + years}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86400000);
}

/** Text on one line, cut to `max` characters with an ellipsis (a reason quoted in a short list). */
export function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export function fmtSize(bytes: number | null | undefined, lang: Lang): string {
  if (bytes == null) return '—';
  const units = lang === 'fr' ? ['o', 'Ko', 'Mo', 'Go'] : ['B', 'KB', 'MB', 'GB'];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const n = i === 0 ? String(v) : v.toFixed(1);
  return `${lang === 'fr' ? n.replace('.', ',') : n} ${units[i]}`;
}
