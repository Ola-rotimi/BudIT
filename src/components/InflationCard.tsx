import { View } from 'react-native';
import { categoryTotals, type CategoryTotal } from '@/db/queries';
import { useQuery } from '@/hooks/useQuery';
import { currentMonthKey, monthLabel, shiftMonth } from '@/lib/dates';
import { getCountry } from '@/lib/countries';
import { formatPercent } from '@/lib/money';
import { usePro } from '@/lib/pro';
import { useMoney, useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { ProLock } from './ProLock';
import { AppText, Card, StatLine } from './ui';
import { tr } from '@/i18n';

/** Ignore categories too small to say anything meaningful about (in cents). */
const MIN_BASE = 1000_00;

const sum = (rows: CategoryTotal[]) => rows.reduce((s, r) => s + r.total, 0);

/**
 * Compares a finished month's spending with the same month last year (or, without a year of
 * history, the average of the three months before), and puts it against inflation.
 */
export function InflationCard({ month }: { month: string }) {
  const t = useTheme();
  const { isPro } = usePro();
  const { money } = useMoney();
  const { country } = useSettings();
  // A month still in progress would look artificially cheap, so use the last complete one.
  const target = month >= currentMonthKey() ? shiftMonth(currentMonthKey(), -1) : month;

  const data = useQuery(`inflation:${target}`, async (db) => {
    const [now, lastYear, ...recent] = await Promise.all([
      categoryTotals(db, target, 'expense'),
      categoryTotals(db, shiftMonth(target, -12), 'expense'),
      ...[1, 2, 3].map((n) => categoryTotals(db, shiftMonth(target, -n), 'expense')),
    ]);
    return { now, lastYear, recent };
  });

  if (!isPro) {
    return <ProLock title={tr('Is inflation eating your budget?')} message={tr('BudIT Pro compares your spending with last year and with inflation, and shows which costs are rising fastest.')} />;
  }
  if (!data || !sum(data.now)) return null;

  const yearOnYear = sum(data.lastYear) > 0;
  const recentWithData = data.recent.filter((r) => sum(r) > 0);
  if (!yearOnYear && !recentWithData.length) return null;

  // Comparison spend per category: last year's month, or the recent monthly average.
  const base = new Map<number, number>();
  if (yearOnYear) data.lastYear.forEach((r) => base.set(r.id, r.total));
  else recentWithData.flat().forEach((r) => base.set(r.id, (base.get(r.id) ?? 0) + r.total / recentWithData.length));
  const baseTotal = [...base.values()].reduce((s, v) => s + v, 0);
  const nowTotal = sum(data.now);
  const change = nowTotal / baseTotal - 1;

  const preset = getCountry(country);
  const yearly = preset?.pension.inflationPct;
  // Inflation over the comparison gap: a year, or roughly two months for the recent average.
  const inflation = yearly === undefined ? null : yearOnYear ? yearly / 100 : (1 + yearly / 100) ** (2 / 12) - 1;
  const real = inflation === null ? null : (1 + change) / (1 + inflation) - 1;

  const risers = data.now
    .filter((r) => (base.get(r.id) ?? 0) >= MIN_BASE)
    .map((r) => ({ ...r, change: r.total / base.get(r.id)! - 1 }))
    .filter((r) => r.change > 0.05)
    .sort((a, b) => b.change - a.change)
    .slice(0, 3);

  const versus = yearOnYear ? monthLabel(shiftMonth(target, -12)) : tr('the 3 months before');

  return (
    <Card>
      <AppText variant="heading">{tr('Inflation check')}</AppText>
      <AppText variant="caption">{tr('{0} compared with {1}.', [monthLabel(target), versus])}</AppText>
      <StatLine label={tr('Your spending')} value={`${change >= 0 ? '+' : ''}${formatPercent(change, 0)}`} color={change > 0 ? t.expense : t.income} bold />
      {inflation !== null && preset && (
        <>
          <StatLine label={tr('Prices in {0} (about)', [preset.name])} value={`+${formatPercent(inflation, yearOnYear ? 0 : 1)}`} />
          <AppText variant="caption" color={real !== null && real > 0.02 ? t.warning : undefined}>
            {real === null ? '' : Math.abs(real) <= 0.02 ? tr('Your spending is moving in line with prices.') : real > 0 ? tr('After inflation you’re spending about {0} more in real terms.', [formatPercent(real, 0)]) : tr('After inflation you’re spending about {0} less in real terms. Nice work.', [formatPercent(-real, 0)])}
          </AppText>
        </>
      )}
      {risers.length > 0 && (
        <View style={{ gap: 4 }}>
          <AppText variant="label">{tr('Rising fastest')}</AppText>
          {risers.map((r) => (
            <StatLine key={r.id} label={tr(r.name)} value={`+${formatPercent(r.change, 0)} · ${money(r.total)}`} color={t.expense} />
          ))}
        </View>
      )}
      {inflation !== null && (
        <AppText variant="caption">{tr('Inflation figure is BudIT’s planning estimate for {0}; check your statistics office for the official rate.', [preset?.name])}</AppText>
      )}
    </Card>
  );
}
