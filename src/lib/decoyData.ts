/**
 * The made-up budget shown after unlocking with the panic PIN (see db/decoy.ts).
 *
 * It has to pass a quick look from someone standing over you: a salary, rent, bills, groceries,
 * transport and the odd treat, in your currency and at an everyday scale, with spending on most
 * days right up to today. Entries are derived from the date, so filling in the days since the decoy
 * was last opened gives the same kind of entries as before, never a suspicious burst or gap.
 *
 * No imports, so it can be tested on its own.
 */

export type FakeTransaction = { date: string; type: 'income' | 'expense'; category: string; amount: number };

/** Fake monthly income, in US dollars, converted to the user's currency. Modest on purpose. */
const MONTHLY_INCOME_USD = 700;

/** A stable number in [0, 1) for a string, so a given day always gets the same entries. */
function chance(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Rounds to a price people actually pay: two significant figures (1,234 → 1,200; 47.3 → 47). */
export function niceAmount(units: number) {
  if (!(units > 0)) return 0;
  const step = 10 ** Math.max(0, Math.floor(Math.log10(units)) - 1);
  return Math.round(units / step) * step;
}

/** Fake monthly income in the user's currency (major units), from units-per-dollar. */
export function fakeMonthlyIncome(perUsd: number) {
  return niceAmount(MONTHLY_INCOME_USD * (perUsd > 0 ? perUsd : 1));
}

/** Monthly budgets for a few everyday categories (cents), sized to the fake income. */
export function fakeBudgets(income: number): { category: string; amount: number }[] {
  return [
    { category: 'Groceries', amount: niceAmount(income * 0.18) * 100 },
    { category: 'Food & Dining', amount: niceAmount(income * 0.1) * 100 },
    { category: 'Transport', amount: niceAmount(income * 0.1) * 100 },
    { category: 'Entertainment', amount: niceAmount(income * 0.05) * 100 },
  ];
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Shifts a `YYYY-MM-DD` date by whole days. */
export function shiftDate(date: string, days: number) {
  const d = parse(date);
  d.setDate(d.getDate() + days);
  return iso(d);
}

/** Every fake entry from `from` to `to` (inclusive). Amounts are in cents; `income` is major units. */
export function fakeTransactions(from: string, to: string, income: number): FakeTransaction[] {
  const out: FakeTransaction[] = [];
  const add = (date: string, category: string, share: number, spread = 0, seed = category) => {
    const factor = spread ? 1 - spread + 2 * spread * chance(`${date}:${seed}:amount`) : 1;
    const amount = niceAmount(income * share * factor) * 100;
    if (amount > 0) out.push({ date, type: category === 'Salary' ? 'income' : 'expense', category, amount });
  };
  for (let d = parse(from), end = parse(to); d <= end; d.setDate(d.getDate() + 1)) {
    const date = iso(d);
    const day = d.getDate();
    const weekday = d.getDay(); // 0 = Sunday
    const roll = (what: string) => chance(`${date}:${what}`);

    if (day === 25) add(date, 'Salary', 1);
    if (day === 1) add(date, 'Housing', 0.25);
    if (day === 5) add(date, 'Utilities', 0.03, 0.15, 'power');
    if (day === 10 || day === 22) add(date, 'Utilities', 0.012, 0, 'data');
    if (day === 12) add(date, 'Subscriptions', 0.01);
    if (day === 8) add(date, 'Personal Care', 0.01, 0.3);
    if (day === 18 && roll('health') < 0.6) add(date, 'Health', 0.012, 0.3);
    if (weekday === 6) add(date, 'Groceries', 0.04, 0.2);
    if (weekday >= 1 && weekday <= 5 && roll('transport') < 0.75) add(date, 'Transport', 0.004, 0.3);
    if (roll('food') < 0.35) add(date, 'Food & Dining', 0.008, 0.4);
    if (weekday === 0 && roll('fun') < 0.5) add(date, 'Entertainment', 0.015, 0.3);
    if (roll('shop') < 0.06) add(date, 'Shopping', 0.03, 0.4);
  }
  return out;
}
