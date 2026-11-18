/** Schedule maths for rotating savings groups (ajo, esusu, susu, chama, stokvel). */
import type { SavingsGroup } from '@/db/types';
import { advanceDate } from './dates';

/** Date of a cycle (1-based): weekly or monthly from the start date, keeping the start's day of month. */
export function cycleDate(g: Pick<SavingsGroup, 'start_date' | 'frequency'>, cycle: number) {
  const anchor = Number(g.start_date.slice(8, 10));
  let date = g.start_date;
  for (let i = 1; i < cycle; i++) date = advanceDate(date, g.frequency, anchor);
  return date;
}

/** The cycle in progress on `today`: the latest one that has started (1 before the start, `members` after the end). */
export function currentCycle(g: Pick<SavingsGroup, 'start_date' | 'frequency' | 'members'>, today: string) {
  let cycle = 1;
  while (cycle < g.members && cycleDate(g, cycle + 1) <= today) cycle++;
  return cycle;
}

/** What the member collects on their turn: everyone's contribution for that cycle, their own included. */
export const payoutAmount = (g: Pick<SavingsGroup, 'contribution' | 'members'>) => g.contribution * g.members;
