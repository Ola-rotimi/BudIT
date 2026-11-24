import { Stack } from 'expo-router';
import { View } from 'react-native';
import { BarChart, Legend } from '@/components/charts';
import { HideAmountsButton } from '@/components/HideAmountsButton';
import { ProLock } from '@/components/ProLock';
import { AppText, Card, Divider, Loading, Screen, StatLine } from '@/components/ui';
import { YearTable } from '@/components/YearTable';
import { backfillNetWorth, netWorthHistory, netWorthNow, recordNetWorth } from '@/db/planning';
import { useQuery } from '@/hooks/useQuery';
import { tr } from '@/i18n';
import { monthLabel } from '@/lib/dates';
import { usePro } from '@/lib/pro';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';

/** Everything you own minus everything you owe, now (free) and month by month (Pro). */
export default function NetWorthScreen() {
  const t = useTheme();
  const { money } = useMoney();
  const { isPro } = usePro();
  const data = useQuery('net-worth', async (db) => {
    // Keep this month's figure current and fill in earlier months the first time.
    await recordNetWorth(db);
    await backfillNetWorth(db);
    const [now, history] = await Promise.all([netWorthNow(db), netWorthHistory(db, 12)]);
    return { now, history };
  });

  if (!data) return <Loading />;
  const { now, history } = data;
  const net = now.assets - now.liabilities;
  const previous = history.length > 1 ? history[history.length - 2] : null;
  const change = previous ? net - (previous.assets - previous.liabilities) : null;
  const accountAssets = now.assets - now.parts.owedToMe;

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Net worth'), headerRight: () => <HideAmountsButton /> }} />
      <Card>
        <AppText variant="label">{tr('Your net worth')}</AppText>
        <AppText variant="display" color={net < 0 ? t.expense : t.primary} adjustsFontSizeToFit numberOfLines={1}>
          {money(net)}
        </AppText>
        {change !== null && previous && (
          <AppText variant="caption" color={change >= 0 ? t.income : t.expense}>
            {tr('{0} since {1}', [money(change, { sign: true }), monthLabel(previous.month, true)])}
          </AppText>
        )}
        <Divider />
        <StatLine label={tr('What you own')} value={money(now.assets)} color={t.income} bold />
        <StatLine label={tr('Account balances')} value={money(accountAssets)} />
        {now.parts.owedToMe > 0 && <StatLine label={tr('Owed to you')} value={money(now.parts.owedToMe)} />}
        <Divider />
        <StatLine label={tr('What you owe')} value={money(now.liabilities)} color={t.expense} bold />
        {now.parts.accountDebt > 0 && <StatLine label={tr('Cards and overdrafts')} value={money(now.parts.accountDebt)} />}
        {now.parts.loans > 0 && <StatLine label={tr('Loans and debts')} value={money(now.parts.loans)} />}
        {now.parts.iOwe > 0 && <StatLine label={tr('You owe people')} value={money(now.parts.iOwe)} />}
        {now.unconverted.length > 0 && (
          <AppText variant="caption" color={t.warning}>
            {tr('{0} isn’t included yet: BudIT needs the official exchange rate once. Connect to the internet to update.', [now.unconverted.map((a) => a.name).join(', ')])}
          </AppText>
        )}
      </Card>

      {!isPro ? (
        <ProLock title={tr('Watch your net worth grow')} message={tr('BudIT Pro shows your net worth month by month, with what you own and owe over the last year.')} />
      ) : history.length > 1 && (
        <Card>
          <AppText variant="heading">{tr('Month by month')}</AppText>
          <BarChart
            labels={history.map((h) => monthLabel(h.month, true))}
            series={[
              { color: t.income, values: history.map((h) => h.assets) },
              { color: t.expense, values: history.map((h) => h.liabilities) },
            ]}
            formatValue={(v) => money(v, { compact: true })}
          />
          <Legend
            items={[
              { color: t.income, label: tr('Own') },
              { color: t.expense, label: tr('Owe') },
            ]}
          />
          <YearTable
            initial={6}
            columns={[{ label: tr('Month') }, { label: tr('Own') }, { label: tr('Owe') }, { label: tr('Net worth'), color: t.primary }]}
            rows={[...history].reverse().map((h) => ({
              key: h.month,
              cells: [monthLabel(h.month, true), money(h.assets, { compact: true }), money(h.liabilities, { compact: true }), money(h.assets - h.liabilities, { compact: true })],
            }))}
          />
        </Card>
      )}

      <View style={{ paddingHorizontal: 8 }}>
        <AppText variant="caption" style={{ textAlign: 'center' }}>
          {tr('Counts your accounts, money people owe you, debts in the payoff planner and money you owe. Earlier months are rebuilt from your transactions, with debts at today’s amounts. Foreign-currency accounts use today’s official rate.')}
        </AppText>
      </View>
    </Screen>
  );
}
