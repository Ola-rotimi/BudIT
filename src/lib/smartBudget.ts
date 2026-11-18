/**
 * Smart budget: turns a monthly take-home income into a full budget using the needs / wants /
 * savings rules recommended by mainstream personal-finance guidance (the 50/30/20 rule and its
 * common variants), split across the user's own categories.
 *
 * All amounts are in minor units (cents).
 */
import type { Budget, Category, IconName } from '@/db/types';
import { tr, N_ } from '@/i18n';

export type Bucket = 'needs' | 'wants' | 'savings';
export type PlanStyle = 'balanced' | 'essentials' | 'saver';

export const PLAN_STYLES: Record<PlanStyle, { label: string; rule: string; split: Record<Bucket, number>; summary: string }> = {
  balanced: {
    label: N_('Balanced'),
    rule: '50/30/20',
    split: { needs: 50, wants: 30, savings: 20 },
    summary: N_('The classic rule: half for essentials, 30% to enjoy, and a fifth saved.'),
  },
  essentials: {
    label: N_('Essentials first'),
    rule: '60/20/20',
    split: { needs: 60, wants: 20, savings: 20 },
    summary: N_('For high rent or living costs: more room for essentials while still saving a fifth.'),
  },
  saver: {
    label: N_('Saver'),
    rule: '50/20/30',
    split: { needs: 50, wants: 20, savings: 30 },
    summary: N_('Pay yourself first and reach your goals sooner by trimming lifestyle spending.'),
  },
};

export const BUCKETS: Record<Bucket, { label: string; description: string; icon: IconName; color: string }> = {
  needs: { label: N_('Needs'), description: N_('Bills you must pay to live and work'), icon: 'home', color: '#0F766E' },
  wants: { label: N_('Wants'), description: N_('Lifestyle spending you can dial up or down'), icon: 'cafe', color: '#D97706' },
  savings: { label: N_('Savings & debt'), description: N_('Your future self: safety net, debt and investing'), icon: 'shield-checkmark', color: '#6366F1' },
};

/** Relative weights within each bucket, matched to the default category names. */
const NEEDS: [string, number][] = [
  ['Housing', 50],
  ['Groceries', 20],
  ['Transport', 14],
  ['Utilities', 10],
  ['Health', 6],
];
const WANTS: [string, number][] = [
  ['Food & Dining', 25],
  ['Shopping', 20],
  ['Entertainment', 15],
  ['Subscriptions', 10],
  ['Personal Care', 10],
  ['Gifts & Donations', 10],
  ['Travel', 10],
];
/** Spending categories that count as needs when comparing with what was actually spent. */
const NEEDS_EXTRA = ['Education'];

/** Housing guideline: keep rent or mortgage at or below 30% of take-home pay. */
export const HOUSING_MAX_PCT = 30;
/** If last month's essentials took more than this share of income, recommend "Essentials first". */
const ESSENTIALS_TRIGGER_PCT = 55;

export type PlanLine = {
  key: string;
  label: string;
  amount: number;
  icon: IconName;
  color: string;
  /** Set when the line becomes a category budget on apply. */
  categoryId?: number;
  note?: string;
};

export type PlanBucket = { bucket: Bucket; pct: number; amount: number; lines: PlanLine[] };

export type Plan = {
  style: PlanStyle;
  income: number;
  buckets: PlanBucket[];
  /** Category budgets to save (needs, wants and debt payments). */
  budgets: Budget[];
  /** 3 and 6 months of essentials. */
  emergency: { min: number; max: number };
  monthlySavings: number;
};

/** Rounds to a tidy step that suits the size of the income (e.g. 1,000 for a 450,000 income). */
export function niceStep(incomeCents: number) {
  const major = incomeCents / 100;
  if (major < 1000) return 100;
  return 10 ** (Math.floor(Math.log10(major)) - 2) * 100;
}

const roundTo = (value: number, step: number) => Math.round(value / step) * step;

/** Splits `total` across the weighted categories the user still has, redistributing missing ones. */
function splitAcross(total: number, weights: [string, number][], categories: Category[], step: number): PlanLine[] {
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const found = weights.flatMap(([name, w]) => {
    const c = byName.get(name.toLowerCase());
    return c ? [{ c, w }] : [];
  });
  const sum = found.reduce((s, f) => s + f.w, 0);
  if (!sum) return [];
  const lines = found.map(({ c, w }) => ({
    key: `c${c.id}`,
    label: c.name,
    amount: roundTo((total * w) / sum, step),
    icon: c.icon,
    color: c.color,
    categoryId: c.id,
  }));
  // Rounding each line drifts the bucket off its share, so the largest line absorbs the difference.
  const drift = roundTo(total, step) - lines.reduce((s, l) => s + l.amount, 0);
  lines.reduce((max, l) => (l.amount > max.amount ? l : max)).amount += drift;
  return lines;
}

export function buildPlan({
  income,
  style,
  hasDebt,
  categories,
}: {
  income: number;
  style: PlanStyle;
  hasDebt: boolean;
  /** The user's active expense categories. */
  categories: Category[];
}): Plan {
  const { split } = PLAN_STYLES[style];
  const step = niceStep(income);
  const needs = splitAcross((income * split.needs) / 100, NEEDS, categories, step);
  const wants = splitAcross((income * split.wants) / 100, WANTS, categories, step);
  const spent = [...needs, ...wants].reduce((s, l) => s + l.amount, 0);
  // Savings takes whatever is left after rounding so the plan adds up to the income exactly.
  const saveTotal = income - spent;

  const debtCategory = categories.find((c) => c.name.toLowerCase() === 'debt payments');
  const savings: PlanLine[] = [];
  const addSaving = (key: string, label: string, share: number, icon: IconName, color: string, note: string, categoryId?: number) =>
    savings.push({ key, label, amount: roundTo(saveTotal * share, step), icon, color, note, categoryId });

  if (hasDebt) {
    addSaving('debt', tr('Extra debt repayment'), 0.5, debtCategory?.icon ?? 'card', debtCategory?.color ?? '#78716C',
      tr('Above the minimums, on your highest-interest debt first'), debtCategory?.id);
    addSaving('emergency', tr('Emergency fund'), 0.3, 'shield-checkmark', '#10B981', tr('Until it covers 3 to 6 months of needs'));
  } else {
    addSaving('emergency', tr('Emergency fund'), 0.5, 'shield-checkmark', '#10B981', tr('Until it covers 3 to 6 months of needs'));
  }
  const rest = saveTotal - savings.reduce((s, l) => s + l.amount, 0);
  savings.push({ key: 'invest', label: tr('Retirement & investing'), amount: rest, icon: 'trending-up', color: '#6366F1', note: tr('Long-term growth, on top of any workplace pension') });

  const needsTotal = needs.reduce((s, l) => s + l.amount, 0);
  const total = (lines: PlanLine[]) => lines.reduce((s, l) => s + l.amount, 0);
  const buckets: PlanBucket[] = [
    { bucket: 'needs', pct: split.needs, amount: needsTotal, lines: needs },
    { bucket: 'wants', pct: split.wants, amount: total(wants), lines: wants },
    { bucket: 'savings', pct: split.savings, amount: saveTotal, lines: savings },
  ];

  const budgets = [...needs, ...wants, ...savings]
    .filter((l): l is PlanLine & { categoryId: number } => l.categoryId !== undefined && l.amount > 0)
    .map((l) => ({ category_id: l.categoryId, amount: l.amount }));

  return { style, income, buckets, budgets, emergency: { min: needsTotal * 3, max: needsTotal * 6 }, monthlySavings: saveTotal };
}

/** Which bucket a spending category counts towards when comparing with real spending. */
export function bucketOf(categoryName: string): Bucket {
  const name = categoryName.toLowerCase();
  if (name === 'debt payments') return 'savings';
  if (NEEDS.some(([n]) => n.toLowerCase() === name) || NEEDS_EXTRA.some((n) => n.toLowerCase() === name)) return 'needs';
  return 'wants';
}

/** Recommends a style from last month's spending: "Essentials first" when essentials already take most of the income. */
export function recommendStyle(income: number, needsSpent: number): PlanStyle {
  if (income > 0 && (needsSpent / income) * 100 > ESSENTIALS_TRIGGER_PCT) return 'essentials';
  return 'balanced';
}

/** Months to fill the emergency fund at the planned rate, or null if nothing goes to it. */
export function monthsToTarget(target: number, perMonth: number) {
  return perMonth > 0 ? Math.ceil(target / perMonth) : null;
}

/** Settings key holding the last smart-budget inputs (also prefilled by the walkthrough). */
export const SMART_BUDGET_KEY = 'smartBudget';

export type SmartBudgetInput = { income: string; style?: PlanStyle; hasDebt?: boolean; beforeTax?: boolean };

export function parseSmartInput(raw: string | null): SmartBudgetInput {
  try {
    const value = raw ? JSON.parse(raw) : null;
    if (value && typeof value.income === 'string') return value;
  } catch {
    // Fall through to an empty input.
  }
  return { income: '' };
}
