import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ProScreen } from '@/components/ProLock';
import { AppText, Card, Divider, EmptyState, Field, HeaderButton, ListRow, Loading, Screen, Segmented, StatLine } from '@/components/ui';
import { YearTable } from '@/components/YearTable';
import { HideAmountsButton } from '@/components/HideAmountsButton';
import { listDebts } from '@/db/queries';
import { useQuery } from '@/hooks/useQuery';
import { shortDate, toISODate } from '@/lib/dates';
import { minimumsOnly, planPayoff, type Strategy } from '@/lib/debt';
import { parseAmount } from '@/lib/money';
import { usePro } from '@/lib/pro';
import { useMoney, useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';

const addDebt = () => router.push('/debt');

/** Date roughly `months` from now, for "debt-free by" figures. */
function monthsFromNow(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return shortDate(toISODate(d));
}

export default function DebtsScreen() {
  const t = useTheme();
  const { isPro } = usePro();
  const { money } = useMoney();
  const { currency } = useSettings();
  const loaded = useQuery('debts:list', listDebts);
  const debts = loaded;
  const [extra, setExtra] = useState('');
  const [strategy, setStrategy] = useState<Strategy>('avalanche');

  if (!isPro) {
    return (
      <ProScreen
        screenTitle={tr('Debt payoff')}
        title={tr('Become debt-free faster')}
        message={tr('BudIT Pro builds a payoff plan for all your loans and cards, compares the avalanche and snowball methods and shows your debt-free date.')}
      />
    );
  }
  if (!debts) return <Loading />;

  const input = debts.map((d) => ({ id: d.id, name: d.name, balance: d.balance, apr: d.apr, minPayment: d.min_payment }));
  const extraCents = parseAmount(extra) ?? 0;
  const plan = planPayoff(input, extraCents, strategy);
  const other = planPayoff(input, extraCents, strategy === 'avalanche' ? 'snowball' : 'avalanche');
  const mins = minimumsOnly(input);
  const total = debts.reduce((s, d) => s + d.balance, 0);
  const minTotal = debts.reduce((s, d) => s + d.min_payment, 0);
  // Same monthly charge the payoff plan applies.
  const interestOf = (d: { balance: number; apr: number }) => Math.round((d.balance * d.apr) / 100 / 12);
  const monthlyInterest = debts.reduce((s, d) => s + interestOf(d), 0);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: tr('Debt payoff'),
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <HideAmountsButton />
              <HeaderButton icon="add" label={tr('Add debt')} onPress={addDebt} />
            </View>
          ),
        }}
      />
      {debts.length === 0 ? (
        <Card>
          <EmptyState
            icon="card-outline"
            title={tr('No debts added')}
            message={tr('Add your loans, cards and app loans to see the fastest, cheapest way to clear them.')}
            action={{ label: tr('Add a debt'), onPress: addDebt }}
          />
        </Card>
      ) : (
        <>
          <Card>
            <AppText variant="label">{tr('Total owed')}</AppText>
            <AppText variant="title" color={t.expense}>
              {money(total)}
            </AppText>
            <AppText variant="caption">{tr('Minimum payments: {0} a month', [money(minTotal)])}</AppText>
            <AppText variant="caption" color={t.expense}>{tr('Interest building up: about {0} a month', [money(monthlyInterest)])}</AppText>
          </Card>

          <Card style={{ gap: 6 }}>
            {debts.map((d, i) => (
              <View key={d.id}>
                {i > 0 && <Divider />}
                <ListRow
                  icon="card"
                  iconColor={t.expense}
                  title={d.name}
                  subtitle={`${tr('{0}% a year · min {1}/month', [d.apr, money(d.min_payment)])}\n${tr('{0} interest a month', [money(interestOf(d))])}`}
                  right={<AppText weight="700">{money(d.balance)}</AppText>}
                  onPress={() => router.push({ pathname: '/debt', params: { id: String(d.id) } })}
                />
              </View>
            ))}
          </Card>

          <Card>
            <AppText variant="heading">{tr('Your plan')}</AppText>
            <Field
              label={tr('Extra you can pay each month')}
              prefix={currency}
              value={extra}
              onChangeText={setExtra}
              keyboardType="decimal-pad"
              placeholder="0"
              hint={tr('On top of the minimums. Even a little extra saves months.')}
            />
            <Segmented<Strategy>
              value={strategy}
              onChange={setStrategy}
              options={[
                { value: 'avalanche', label: tr('Avalanche') },
                { value: 'snowball', label: tr('Snowball') },
              ]}
            />
            <AppText variant="caption">
              {strategy === 'avalanche' ? tr('Avalanche: extra money goes to the highest interest rate first. Saves the most interest.') : tr('Snowball: extra money goes to the smallest balance first. Quick wins keep you motivated.')}
            </AppText>
            {!plan.feasible ? (
              <AppText color={t.expense}>{tr('These payments don’t cover the interest, so the debt keeps growing. Increase the minimums or add an extra payment.')}</AppText>
            ) : (
              <>
                <View style={[styles.highlight, { backgroundColor: t.primarySoft }]}>
                  <AppText variant="caption">{tr('Debt-free in')}</AppText>
                  <AppText variant="title" color={t.primary}>{tr('{0} month{1}', [plan.months, plan.months === 1 ? '' : 's'])}</AppText>
                  <AppText variant="caption">{tr('around {0}', [monthsFromNow(plan.months)])}</AppText>
                </View>
                <StatLine label={tr('Interest you’ll pay')} value={money(plan.totalInterest)} />
                {mins.feasible && mins.totalInterest > plan.totalInterest && (
                  <StatLine
                    label={tr('Saved vs minimums only')}
                    value={tr('{0} · {1} months sooner', [money(mins.totalInterest - plan.totalInterest), mins.months - plan.months])}
                    color={t.income}
                  />
                )}
                {other.feasible && other.totalInterest !== plan.totalInterest && (
                  <AppText variant="caption">{tr('{0} would take {1} months and cost {2} in interest.', [strategy === 'avalanche' ? tr('Snowball') : tr('Avalanche'), other.months, money(other.totalInterest)])}</AppText>
                )}
                <Divider />
                <AppText variant="label">{tr('Order to pay them off')}</AppText>
                {plan.order.map((o, i) => (
                  <View key={o.id} style={{ gap: 2 }}>
                    <StatLine label={`${i + 1}. ${o.name}`} value={tr('cleared {0}', [monthsFromNow(o.month)])} />
                    <AppText variant="caption">{tr('{0} interest paid on this debt', [money(o.interest)])}</AppText>
                  </View>
                ))}
              </>
            )}
          </Card>

          {plan.feasible && plan.yearly.length > 0 && (
            <Card>
              <AppText variant="heading">{tr('Interest year by year')}</AppText>
              <YearTable
                columns={[{ label: tr('Year') }, { label: tr('Interest'), color: t.expense }, { label: tr('You pay') }, { label: tr('Still owed') }]}
                rows={plan.yearly.map((y) => ({
                  key: y.year,
                  cells: [String(y.year), money(y.interest, { compact: true }), money(y.paid, { compact: true }), money(y.balance, { compact: true })],
                }))}
              />
            </Card>
          )}
          <AppText variant="caption" style={{ textAlign: 'center' }}>{tr('Estimates assume interest is charged monthly and rates stay the same.')}</AppText>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  highlight: { borderRadius: 14, padding: 14, alignItems: 'center', gap: 2 },
});
