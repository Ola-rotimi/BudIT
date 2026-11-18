/**
 * Debt payoff planning: avalanche (highest interest first) vs snowball (smallest balance first).
 * Simulates month by month: interest accrues, every debt gets its minimum, and the extra budget
 * (plus minimums freed up by cleared debts) goes to the target debt.
 *
 * Amounts are in cents; `apr` is the yearly interest rate in percent.
 */

export type DebtInput = { id: number; name: string; balance: number; apr: number; minPayment: number };
export type Strategy = 'avalanche' | 'snowball';

export type PayoffPlan = {
  strategy: Strategy;
  months: number;
  totalInterest: number;
  totalPaid: number;
  /** Debts in the order they're cleared, with the month each is paid off (1 = next month). */
  order: { id: number; name: string; month: number; interest: number }[];
  /** Per year of the plan: interest charged, total paid and what's still owed at the end. */
  yearly: { year: number; interest: number; paid: number; balance: number }[];
  /** False when payments never outrun interest (the plan is capped at MAX_MONTHS). */
  feasible: boolean;
};

const MAX_MONTHS = 600;

function target(debts: { balance: number; apr: number; id: number }[], strategy: Strategy) {
  const open = debts.filter((d) => d.balance > 0);
  if (!open.length) return null;
  return open.reduce((best, d) => {
    if (strategy === 'avalanche') return d.apr > best.apr || (d.apr === best.apr && d.balance < best.balance) ? d : best;
    return d.balance < best.balance || (d.balance === best.balance && d.apr > best.apr) ? d : best;
  });
}

export function planPayoff(input: DebtInput[], extraMonthly: number, strategy: Strategy): PayoffPlan {
  const debts = input.filter((d) => d.balance > 0).map((d) => ({ ...d, interest: 0, paidOffMonth: 0 }));
  const budget = debts.reduce((s, d) => s + d.minPayment, 0) + Math.max(0, extraMonthly);
  let month = 0;
  let totalInterest = 0;
  let totalPaid = 0;
  const yearly: PayoffPlan['yearly'] = [];
  let yearInterest = 0;
  let yearPaid = 0;

  while (debts.some((d) => d.balance > 0) && month < MAX_MONTHS) {
    month++;
    for (const d of debts) {
      if (d.balance <= 0) continue;
      const interest = Math.round((d.balance * d.apr) / 100 / 12);
      d.balance += interest;
      d.interest += interest;
      totalInterest += interest;
      yearInterest += interest;
    }
    let left = budget;
    // Minimums first (never more than what's owed)…
    for (const d of debts) {
      if (d.balance <= 0) continue;
      const pay = Math.min(d.minPayment, d.balance, left);
      d.balance -= pay;
      left -= pay;
      totalPaid += pay;
      yearPaid += pay;
    }
    // …then everything left goes to the target debt, rolling on to the next once it's cleared.
    while (left > 0) {
      const t = target(debts, strategy);
      if (!t) break;
      const pay = Math.min(t.balance, left);
      t.balance -= pay;
      left -= pay;
      totalPaid += pay;
      yearPaid += pay;
    }
    for (const d of debts) if (d.balance <= 0 && !d.paidOffMonth) d.paidOffMonth = month;

    const owed = debts.reduce((s, d) => s + Math.max(0, d.balance), 0);
    if (month % 12 === 0 || owed <= 0 || month === MAX_MONTHS) {
      yearly.push({ year: Math.ceil(month / 12), interest: yearInterest, paid: yearPaid, balance: owed });
      yearInterest = 0;
      yearPaid = 0;
    }
  }

  const feasible = debts.every((d) => d.balance <= 0);
  return {
    strategy,
    months: month,
    totalInterest,
    totalPaid,
    order: debts
      .filter((d) => d.paidOffMonth)
      .sort((a, b) => a.paidOffMonth - b.paidOffMonth)
      .map((d) => ({ id: d.id, name: d.name, month: d.paidOffMonth, interest: d.interest })),
    yearly,
    feasible,
  };
}

/** Months to clear debts paying only the minimums, for comparison. */
export const minimumsOnly = (debts: DebtInput[]) => planPayoff(debts, 0, 'avalanche');
