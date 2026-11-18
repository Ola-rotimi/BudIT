/**
 * Spending challenges: no-spend days, a cap on one category, or a cap on all chosen spending, over
 * a set number of days. Progress comes from the transactions themselves, leaving out what
 * recurring rules add automatically.
 */
import type { ChallengeKind } from '@/db/types';
import { addDays, daysBetween, fromISODate, toISODate } from './dates';
import { N_ } from '@/i18n';

export const CHALLENGE_PRESETS: { kind: ChallengeKind; days: number; title: string; description: string }[] = [
  { kind: 'no_spend', days: 7, title: N_('No-spend week'), description: N_('Spend nothing for 7 days, apart from bills and recurring payments.') },
  { kind: 'no_spend', days: 3, title: N_('No-spend weekend'), description: N_('Three days without buying anything you don’t have to.') },
  { kind: 'category_cap', days: 7, title: N_('Category cap'), description: N_('Keep one category, like eating out, under a limit for a week.') },
  { kind: 'spend_cap', days: 30, title: N_('Monthly spending cap'), description: N_('Keep all your chosen spending under one amount for 30 days.') },
];

export type DayState = 'clear' | 'spent' | 'future';

export type ChallengeProgress = {
  status: 'active' | 'won' | 'lost';
  totalDays: number;
  /** Days elapsed so far, including today (capped at the challenge length). */
  elapsed: number;
  daysLeft: number;
  /** Per day of the challenge, for the no-spend calendar. */
  days: { date: string; state: DayState }[];
  /** No-spend: days without spending so far. Caps: amount spent so far. */
  clearDays: number;
  spent: number;
  /** Caps: the limit. */
  limit: number;
  /** Caps: spending at or below the pace the limit allows for the days so far. */
  onPace: boolean;
};

/** `daily` maps date → spending that counts (see `dailySpending`). */
export function challengeProgress(
  c: { kind: ChallengeKind; amount: number | null; start_date: string; end_date: string },
  daily: Record<string, number>,
  today: string,
): ChallengeProgress {
  const totalDays = daysBetween(c.start_date, c.end_date) + 1;
  const days: ChallengeProgress['days'] = [];
  for (let i = 0; i < totalDays; i++) {
    const date = toISODate(addDays(fromISODate(c.start_date), i));
    days.push({ date, state: date > today ? 'future' : (daily[date] ?? 0) > 0 ? 'spent' : 'clear' });
  }
  const elapsed = days.filter((d) => d.state !== 'future').length;
  const spent = days.reduce((s, d) => s + (d.state === 'spent' ? daily[d.date] : 0), 0);
  const clearDays = days.filter((d) => d.state === 'clear').length;
  const over = today > c.end_date;
  const limit = c.amount ?? 0;

  let status: ChallengeProgress['status'];
  if (c.kind === 'no_spend') status = days.some((d) => d.state === 'spent') ? 'lost' : over ? 'won' : 'active';
  else status = spent > limit ? 'lost' : over ? 'won' : 'active';

  return {
    status,
    totalDays,
    elapsed,
    daysLeft: Math.max(0, totalDays - elapsed),
    days,
    clearDays,
    spent,
    limit,
    onPace: c.kind === 'no_spend' ? true : spent <= (limit * elapsed) / totalDays,
  };
}

/** Consecutive days without chosen spending, ending today (or yesterday, if today has spending so far). */
export function noSpendStreak(spendDates: Set<string>, today: string) {
  let streak = 0;
  let day = fromISODate(today);
  if (spendDates.has(today)) day = addDays(day, -1);
  while (streak < 366 && !spendDates.has(toISODate(day))) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}
