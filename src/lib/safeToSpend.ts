/**
 * "Safe to spend until payday": money in your everyday accounts, minus the bills, recurring
 * payments and savings-group contributions due before your next income, spread over the days left.
 *
 * All amounts are in the home currency's minor units.
 */
import type { AccountKind } from '@/db/types';
import { advanceDate, daysBetween, periodRange, periodKeyOf, type Frequency } from './dates';
import { cycleDate } from './savingsGroups';

/** Accounts whose money is available for day-to-day spending. Savings and cards don't count. */
export const SPENDABLE_KINDS: AccountKind[] = ['cash', 'bank', 'mobile'];

export type SafeInput = {
  today: string;
  accounts: { kind: AccountKind; currency: string | null; home_balance: number | null; archived?: number }[];
  bills: { name: string; amount: number; due_date: string; frequency: Frequency }[];
  recurring: { type: 'income' | 'expense'; amount: number; frequency: Exclude<Frequency, 'once'>; next_date: string; anchor_day: number | null; note: string; category_name: string }[];
  groups: { name: string; contribution: number; frequency: 'weekly' | 'monthly'; start_date: string; members: number; paid_cycles: number }[];
};

export type Commitment = { kind: 'bill' | 'recurring' | 'group'; name: string; date: string; amount: number };

export type SafeToSpend = {
  /** First day the money has to last until: the next recurring income, or the next budget month. */
  payday: string;
  /** Days from today up to (not including) payday. At least 1. */
  days: number;
  available: number;
  committed: number;
  safe: number;
  perDay: number;
  items: Commitment[];
};

/** Dates of a schedule from `first`, before `until`. Past-due dates are included (they still need paying). */
function occurrences(first: string, freq: Frequency, until: string, anchorDay?: number) {
  const dates: string[] = [];
  let date = first;
  for (let i = 0; date < until && i < 60; i++) {
    dates.push(date);
    if (freq === 'once') break;
    date = advanceDate(date, freq, anchorDay);
  }
  return dates;
}

export function nextPayday(input: Pick<SafeInput, 'today' | 'recurring'>) {
  const [, periodEnd] = periodRange(periodKeyOf(input.today));
  // A regular income (salary, allowance) due after today is the real payday when it comes sooner.
  const income = input.recurring
    .filter((r) => r.type === 'income' && r.next_date > input.today)
    .map((r) => r.next_date)
    .sort()[0];
  return income && income < periodEnd ? income : periodEnd;
}

export function safeToSpend(input: SafeInput): SafeToSpend {
  const { today } = input;
  const payday = nextPayday(input);
  const days = Math.max(1, daysBetween(today, payday));

  const available = input.accounts
    .filter((a) => !a.archived && SPENDABLE_KINDS.includes(a.kind) && !a.currency && a.home_balance !== null)
    .reduce((s, a) => s + a.home_balance!, 0);

  const items: Commitment[] = [];
  for (const b of input.bills) {
    for (const date of occurrences(b.due_date, b.frequency, payday)) items.push({ kind: 'bill', name: b.name, date, amount: b.amount });
  }
  for (const r of input.recurring) {
    if (r.type !== 'expense') continue;
    // Recurring rules add their transaction on the date itself, so today's has already been recorded.
    const from = r.next_date > today ? r.next_date : advanceDate(today, r.frequency, r.anchor_day ?? undefined);
    for (const date of occurrences(from, r.frequency, payday, r.anchor_day ?? undefined)) {
      items.push({ kind: 'recurring', name: r.note || r.category_name, date, amount: r.amount });
    }
  }
  for (const g of input.groups) {
    // Contributions still to pay for cycles that start before payday.
    for (let cycle = g.paid_cycles + 1; cycle <= g.members; cycle++) {
      const date = cycleDate(g, cycle);
      if (date >= payday) break;
      items.push({ kind: 'group', name: g.name, date, amount: g.contribution });
    }
  }
  items.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);

  const committed = items.reduce((s, i) => s + i.amount, 0);
  const safe = available - committed;
  return { payday, days, available, committed, safe, perDay: safe > 0 ? Math.floor(safe / days) : 0, items };
}
