/** Dates are stored as local `YYYY-MM-DD` strings; months as `YYYY-MM`. */

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISODate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO() {
  return toISODate(new Date());
}

export function monthKey(iso: string) {
  return iso.slice(0, 7);
}

/**
 * Budget months can start on payday instead of the 1st. A period is keyed by the calendar month it
 * starts in: with a start day of 25, "2026-10" runs from 25 October to 24 November.
 * Set once from settings (see SettingsProvider); every date range in the app goes through here.
 */
let periodStartDay = 1;

export function setPeriodStartDay(day: number) {
  periodStartDay = Math.min(28, Math.max(1, Math.round(day) || 1));
}

export function getPeriodStartDay() {
  return periodStartDay;
}

/** `[start, end)` dates of the budget period with this key. */
export function periodRange(key: string): [string, string] {
  return [`${key}-${pad(periodStartDay)}`, `${shiftMonth(key, 1)}-${pad(periodStartDay)}`];
}

/** Key of the budget period containing `iso`. */
export function periodKeyOf(iso: string) {
  return Number(iso.slice(8, 10)) >= periodStartDay ? monthKey(iso) : shiftMonth(monthKey(iso), -1);
}

/** Key of the budget period containing today. */
export function currentMonthKey() {
  return periodKeyOf(todayISO());
}

/** Days left in the period including today, and the fraction of it that has passed. */
export function periodProgress(key: string, today = todayISO()) {
  const [start, end] = periodRange(key);
  const total = daysBetween(start, end);
  if (today < start) return { daysLeft: total, elapsed: 0 };
  if (today >= end) return { daysLeft: 0, elapsed: 1 };
  const daysLeft = daysBetween(today, end);
  return { daysLeft, elapsed: (total - daysLeft + 1) / total };
}

export function shiftMonth(key: string, delta: number) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function daysInMonth(key: string) {
  const [start, end] = periodRange(key);
  return daysBetween(start, end);
}

/** "October 2026", or "25 Oct – 24 Nov 2026" when months start on payday. `short` gives the starting month only. */
export function monthLabel(key: string, short = false) {
  const [y, m] = key.split('-').map(Number);
  if (short || periodStartDay === 1) {
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, short ? { month: 'short' } : { month: 'long', year: 'numeric' });
  }
  const [start, end] = periodRange(key);
  const last = addDays(fromISODate(end), -1);
  const from = fromISODate(start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const to = last.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${from} – ${to}`;
}

export function dayLabel(iso: string) {
  const today = todayISO();
  if (iso === today) return 'Today';
  if (iso === toISODate(addDays(new Date(), -1))) return 'Yesterday';
  return fromISODate(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: iso.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric' });
}

export function shortDate(iso: string) {
  return fromISODate(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function addDays(d: Date, days: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

export function daysBetween(fromIso: string, toIso: string) {
  return Math.round((fromISODate(toIso).getTime() - fromISODate(fromIso).getTime()) / 86_400_000);
}

export type Frequency = 'weekly' | 'monthly' | 'yearly' | 'once';

/**
 * The next date in a schedule. Monthly dates clamp to short months (Jan 31 -> Feb 28); pass the
 * schedule's original day as `anchorDay` so it returns to the 31st afterwards instead of drifting.
 */
export function advanceDate(iso: string, freq: Frequency, anchorDay?: number) {
  const d = fromISODate(iso);
  if (freq === 'weekly') return toISODate(addDays(d, 7));
  const day = anchorDay ?? d.getDate();
  const months = freq === 'yearly' ? 12 : 1;
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, last));
  return toISODate(target);
}
