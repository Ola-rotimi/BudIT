import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MonthSwitcher, useBudgetColor } from '@/components/finance';
import { AppText, Button, Card, EmptyState, IconBadge, Loading, ProgressBar, Screen, SectionHeader } from '@/components/ui';
import { budgetsWithSpending, categoryTotals } from '@/db/queries';
import { useQuery } from '@/hooks/useQuery';
import { currentMonthKey, periodProgress } from '@/lib/dates';
import { formatPercent } from '@/lib/money';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';

export default function BudgetsScreen() {
  const t = useTheme();
  const { money } = useMoney();
  const budgetColor = useBudgetColor();
  const [month, setMonth] = useState(currentMonthKey());

  const data = useQuery(`budgets:${month}`, async (db) => {
    const [budgets, spending] = await Promise.all([budgetsWithSpending(db, month), categoryTotals(db, month, 'expense')]);
    const budgeted = new Set(budgets.map((b) => b.category_id));
    return { budgets, unbudgeted: spending.filter((s) => !budgeted.has(s.id)) };
  });

  if (!data) return <Loading />;
  const { budgets, unbudgeted } = data;

  const total = budgets.reduce((s, b) => s + b.budget, 0);
  const spent = budgets.reduce((s, b) => s + b.spent, 0);
  const ratio = total ? spent / total : 0;
  const isCurrent = month === currentMonthKey();
  // Fraction of the month elapsed, used to show whether spending is ahead of pace.
  const elapsed = isCurrent ? periodProgress(month).elapsed : 1;
  const openBudget = (categoryId?: number) =>
    router.push(categoryId ? { pathname: '/budget', params: { categoryId: String(categoryId) } } : '/budget');

  return (
    <Screen>
      <MonthSwitcher month={month} onChange={setMonth} />

      {budgets.length === 0 ? (
        <Card>
          <EmptyState
            icon="pie-chart-outline"
            title={tr('No budgets yet')}
            message={tr('Let Smart budget build one from your income, or set a monthly limit for each category yourself.')}
            action={{ label: tr('Build with Smart budget'), onPress: () => router.push('/smart-budget') }}
          />
          <Button title={tr('Create a budget manually')} variant="ghost" onPress={() => openBudget()} />
        </Card>
      ) : (
        <>
          <Card>
            <AppText variant="label">{tr('Total budget')}</AppText>
            <View style={styles.between}>
              <AppText variant="title">{money(total - spent)}</AppText>
              <AppText variant="caption">{total >= spent ? 'left' : 'over budget'}</AppText>
            </View>
            <ProgressBar progress={ratio} color={budgetColor(ratio, t.primary)} height={10} />
            <View style={styles.between}>
              <AppText variant="caption">{tr('Spent {0} of {1}', [money(spent), money(total)])}</AppText>
              <AppText variant="caption">{formatPercent(ratio, 0)}</AppText>
            </View>
            {isCurrent && ratio > elapsed + 0.05 && ratio <= 1 && (
              <AppText variant="caption" color={t.warning}>{tr('You’ve used {0} of your budget with {1} of the month to go.', [formatPercent(ratio, 0), formatPercent(1 - elapsed, 0)])}</AppText>
            )}
          </Card>

          <View style={{ gap: 10 }}>
            {budgets.map((b) => {
              const r = b.spent / b.budget;
              const left = b.budget - b.spent;
              return (
                <Card key={b.category_id} onPress={() => openBudget(b.category_id)}>
                  <View style={styles.rowTop}>
                    <IconBadge icon={b.icon} color={b.color} size={38} />
                    <View style={{ flex: 1 }}>
                      <AppText weight="600">{tr(b.name)}</AppText>
                      <AppText variant="caption">{tr('{0} of {1}', [money(b.spent), money(b.budget)])}</AppText>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <AppText weight="700" color={left < 0 ? t.expense : undefined}>
                        {money(Math.abs(left))}
                      </AppText>
                      <AppText variant="caption">{left < 0 ? 'over' : 'left'}</AppText>
                    </View>
                  </View>
                  <ProgressBar progress={r} color={budgetColor(r, b.color)} />
                </Card>
              );
            })}
          </View>
        </>
      )}

      {unbudgeted.length > 0 && (
        <View style={{ gap: 10 }}>
          <SectionHeader title={tr('Spending without a budget')} />
          <Card>
            {unbudgeted.map((c) => (
              <Pressable key={c.id} onPress={() => openBudget(c.id)} style={({ pressed }) => [styles.rowTop, pressed && { opacity: 0.6 }]}>
                <IconBadge icon={c.icon} color={c.color} size={34} />
                <AppText style={{ flex: 1 }} weight="600">
                  {tr(c.name)}
                </AppText>
                <AppText weight="600">{money(c.total)}</AppText>
                <Ionicons name="add-circle-outline" size={22} color={t.primary} accessibilityLabel={tr('Set budget for {0}', [c.name])} />
              </Pressable>
            ))}
          </Card>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
