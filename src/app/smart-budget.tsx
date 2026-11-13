import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState, type ReactNode } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';
import { ProLock } from '@/components/ProLock';
import { SplitBar } from '@/components/SplitBar';
import { AppText, Button, Card, Divider, Field, IconBadge, Loading, Screen, Segmented } from '@/components/ui';
import { applyBudgetPlan, budgetsWithSpending, categoryTotals, getSetting, listCategories, monthTotals, setSetting } from '@/db/queries';
import type { Category, IconName } from '@/db/types';
import { useQuery } from '@/hooks/useQuery';
import { currentMonthKey, monthLabel, shiftMonth } from '@/lib/dates';
import { examplePay, getCountry } from '@/lib/countries';
import { calculateTax } from '@/lib/finance';
import { centsToInput, parseAmount } from '@/lib/money';
import { usePro } from '@/lib/pro';
import { useMoney, useSettings } from '@/lib/settings';
import {
  BUCKETS,
  buildPlan,
  bucketOf,
  HOUSING_MAX_PCT,
  monthsToTarget,
  parseSmartInput,
  PLAN_STYLES,
  recommendStyle,
  SMART_BUDGET_KEY,
  type Bucket,
  type PlanStyle,
  type SmartBudgetInput,
} from '@/lib/smartBudget';
import { useTheme } from '@/lib/theme';

type Loaded = {
  categories: Category[];
  saved: SmartBudgetInput;
  lastMonth: string;
  lastIncome: number;
  /** What was actually spent last month in each bucket. */
  lastSpent: Record<Bucket, number>;
  budgetCount: number;
};

export default function SmartBudgetScreen() {
  const month = currentMonthKey();
  const data = useQuery(`smart-budget:${month}`, async (db): Promise<Loaded> => {
    const lastMonth = shiftMonth(month, -1);
    const [categories, saved, totals, spending, budgets] = await Promise.all([
      listCategories(db, 'expense'),
      getSetting(db, SMART_BUDGET_KEY),
      monthTotals(db, lastMonth),
      categoryTotals(db, lastMonth, 'expense'),
      budgetsWithSpending(db, month),
    ]);
    const lastSpent: Record<Bucket, number> = { needs: 0, wants: 0, savings: 0 };
    for (const c of spending) lastSpent[bucketOf(c.name)] += c.total;
    return { categories, saved: parseSmartInput(saved), lastMonth, lastIncome: totals.income, lastSpent, budgetCount: budgets.length };
  });

  if (!data) return <Loading />;
  // Rendered once data is ready so the form can start from the saved inputs.
  return <SmartBudgetForm data={data} />;
}

function SmartBudgetForm({ data }: { data: Loaded }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const { money } = useMoney();
  const { currency, country } = useSettings();
  const { isPro } = usePro();

  const prefilled = !data.saved.income && data.lastIncome > 0;
  const [income, setIncome] = useState(data.saved.income || (prefilled ? centsToInput(data.lastIncome) : ''));
  const [beforeTax, setBeforeTax] = useState(!!data.saved.beforeTax);
  const [hasDebt, setHasDebt] = useState(!!data.saved.hasDebt);
  const [makeGoal, setMakeGoal] = useState(true);
  const [busy, setBusy] = useState(false);

  // Gross-to-net only works when the home country's tax rules are in the user's own currency.
  const preset = getCountry(country);
  const canNet = !!preset && preset.currency === currency;
  const entered = parseAmount(income) ?? 0;
  const takeHome = canNet && beforeTax ? netMonthly(entered, preset) : entered;

  const recommended = recommendStyle(takeHome || data.lastIncome, data.lastSpent.needs);
  const [style, setStyle] = useState<PlanStyle>(data.saved.style ?? recommended);

  const plan = takeHome > 0 ? buildPlan({ income: takeHome, style, hasDebt, categories: data.categories }) : null;
  const housing = plan?.buckets[0].lines.find((l) => l.label.toLowerCase() === 'housing');
  const emergencyLine = plan?.buckets[2].lines.find((l) => l.key === 'emergency');
  const months = plan && emergencyLine ? monthsToTarget(plan.emergency.min, emergencyLine.amount) : null;
  const hasHistory = data.lastIncome > 0 || Object.values(data.lastSpent).some((v) => v > 0);

  const apply = () => {
    if (!plan) return;
    const replaceNote = data.budgetCount ? `This replaces your ${data.budgetCount} current budget${data.budgetCount === 1 ? '' : 's'}. ` : '';
    const goalNote = makeGoal ? `and an emergency fund goal of ${money(plan.emergency.min)}` : '';
    Alert.alert('Use this budget?', `${replaceNote}BudT will set ${plan.budgets.length} category budgets ${goalNote}. You can fine-tune any of them later.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Use budget',
        onPress: async () => {
          setBusy(true);
          try {
            await applyBudgetPlan(db, plan.budgets, makeGoal ? plan.emergency.min : undefined);
            await setSetting(db, SMART_BUDGET_KEY, JSON.stringify({ income, style, hasDebt, beforeTax } satisfies SmartBudgetInput));
            router.dismissTo('/budgets');
          } catch {
            Alert.alert('Couldn’t save the budget', 'Nothing was changed. Please try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <Screen>
      <Card>
        <View style={styles.row}>
          <IconBadge icon="sparkles" color={t.primary} />
          <View style={{ flex: 1 }}>
            <AppText weight="700">Just tell BudT what you earn</AppText>
            <AppText variant="caption">We’ll split it into needs, wants and savings using proven budgeting rules, then across your categories.</AppText>
          </View>
        </View>
        <Field
          label={beforeTax ? 'Monthly salary before tax' : 'Monthly take-home pay'}
          value={income}
          onChangeText={setIncome}
          keyboardType="decimal-pad"
          prefix={currency}
          placeholder="0"
          hint={prefilled ? `Filled in from your income in ${monthLabel(data.lastMonth)}.` : 'Use what actually lands in your account each month.'}
        />
        {canNet && (
          <View style={styles.row}>
            <AppText style={{ flex: 1 }}>This is before tax</AppText>
            <Switch value={beforeTax} onValueChange={setBeforeTax} trackColor={{ true: t.primary }} />
          </View>
        )}
        {canNet && beforeTax && entered > 0 && (
          <AppText variant="caption">
            Estimated take-home after {preset.name} PAYE and payroll contributions ({preset.tax.year}): {money(takeHome)} a month.
          </AppText>
        )}
        <View style={styles.row}>
          <AppText style={{ flex: 1 }}>I’m paying off debt</AppText>
          <Switch value={hasDebt} onValueChange={setHasDebt} trackColor={{ true: t.primary }} />
        </View>
      </Card>

      <Card>
        <AppText variant="heading">Budget style</AppText>
        <Segmented<PlanStyle>
          value={style}
          onChange={setStyle}
          options={(Object.keys(PLAN_STYLES) as PlanStyle[]).map((s) => ({ value: s, label: PLAN_STYLES[s].label }))}
        />
        <AppText variant="caption">
          {PLAN_STYLES[style].rule} · {PLAN_STYLES[style].summary}
        </AppText>
        {hasHistory && (
          <View style={[styles.tip, { backgroundColor: t.primarySoft }]}>
            <Ionicons name="bulb-outline" size={16} color={t.primary} />
            <AppText variant="caption" style={{ flex: 1 }}>
              {recommended === 'essentials'
                ? `Recommended: Essentials first. Your essentials took ${money(data.lastSpent.needs)} in ${monthLabel(data.lastMonth)}, more than half your income.`
                : `Recommended: Balanced. Your spending in ${monthLabel(data.lastMonth)} fits the 50/30/20 rule.`}
            </AppText>
          </View>
        )}
      </Card>

      {!plan ? (
        <Card>
          <AppText variant="caption">Enter your monthly income to see your plan.</AppText>
        </Card>
      ) : !isPro ? (
        <ProLock
          title="See your full budget"
          message="BudT Pro splits your income across every category, sets the budgets for you and builds your emergency fund goal."
        />
      ) : (
        <>
          <Card>
            <AppText variant="heading">Your plan for {money(plan.income)} a month</AppText>
            <SplitBar
              split={PLAN_STYLES[style].split}
              amounts={{ needs: money(plan.buckets[0].amount), wants: money(plan.buckets[1].amount), savings: money(plan.buckets[2].amount) }}
            />
          </Card>

          {plan.buckets.map((b) => (
            <Card key={b.bucket} style={{ gap: 10 }}>
              <View style={styles.row}>
                <IconBadge icon={BUCKETS[b.bucket].icon} color={BUCKETS[b.bucket].color} size={36} />
                <View style={{ flex: 1 }}>
                  <AppText weight="700">
                    {BUCKETS[b.bucket].label} · {b.pct}%
                  </AppText>
                  <AppText variant="caption">{BUCKETS[b.bucket].description}</AppText>
                </View>
                <AppText weight="800">{money(b.amount)}</AppText>
              </View>
              {data.lastSpent[b.bucket] > 0 && b.bucket !== 'savings' && (
                <AppText variant="caption" color={data.lastSpent[b.bucket] > b.amount ? t.warning : undefined}>
                  You spent {money(data.lastSpent[b.bucket])} on {BUCKETS[b.bucket].label.toLowerCase()} in {monthLabel(data.lastMonth)}
                  {data.lastSpent[b.bucket] > b.amount ? `, ${money(data.lastSpent[b.bucket] - b.amount)} above this plan.` : '.'}
                </AppText>
              )}
              <Divider />
              {b.lines.map((l) => (
                <View key={l.key} style={styles.line}>
                  <IconBadge icon={l.icon} color={l.color} size={30} />
                  <View style={{ flex: 1 }}>
                    <AppText>{l.label}</AppText>
                    {l.note ? <AppText variant="caption">{l.note}</AppText> : null}
                  </View>
                  <AppText weight="600">{money(l.amount)}</AppText>
                </View>
              ))}
            </Card>
          ))}

          <Card style={{ gap: 10 }}>
            <AppText variant="heading">Advice for your plan</AppText>
            {housing && (
              <Tip icon="home-outline">
                Keep rent or mortgage at or below {HOUSING_MAX_PCT}% of take-home pay: no more than {money(Math.round((plan.income * HOUSING_MAX_PCT) / 100))} a month. This plan allows {money(housing.amount)}.
              </Tip>
            )}
            <Tip icon="shield-checkmark-outline">
              Build an emergency fund of 3 to 6 months of needs: {money(plan.emergency.min)} to {money(plan.emergency.max)}.
              {months ? ` At ${money(emergencyLine!.amount)} a month you’ll have 3 months saved in about ${months} months.` : ''}
            </Tip>
            <Tip icon="calendar-outline">
              Pay yourself first: move {money(plan.monthlySavings)} into savings on payday, before you spend, ideally by standing order.
            </Tip>
            {hasDebt && (
              <Tip icon="card-outline">
                Always pay the minimum on every debt, then put the extra on the one with the highest interest rate. When it’s cleared, roll that payment onto the next.
              </Tip>
            )}
            <Tip icon="swap-vertical-outline">
              Once your emergency fund is full, move its share to retirement and investing, or to your next savings goal.
            </Tip>
          </Card>

          <Card>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <AppText>Create an emergency fund goal</AppText>
                <AppText variant="caption">Target {money(plan.emergency.min)} (3 months of needs)</AppText>
              </View>
              <Switch value={makeGoal} onValueChange={setMakeGoal} trackColor={{ true: t.primary }} />
            </View>
            <Button title={busy ? 'Saving…' : 'Use this budget'} icon="checkmark-circle" onPress={apply} disabled={busy} />
            <AppText variant="caption" style={{ textAlign: 'center' }}>
              Based on widely used budgeting guidance, not personal financial advice.
            </AppText>
          </Card>
        </>
      )}
    </Screen>
  );
}

/** Monthly take-home (cents) from a monthly gross (cents) under the country's preset rules. */
function netMonthly(grossMonthlyCents: number, preset: NonNullable<ReturnType<typeof getCountry>>) {
  const { tax } = preset;
  const grossAnnual = (grossMonthlyCents / 100) * 12;
  const result = calculateTax({
    grossAnnual,
    pay: examplePay(preset, grossAnnual),
    preTaxDeductions: 0,
    allowance: tax.allowance,
    brackets: tax.brackets,
    contributions: tax.contributions,
    expenseDeduction: tax.expenseDeduction,
    credits: tax.credits,
    surchargePct: tax.surchargePct,
    alternativeBrackets: tax.alternativeBrackets,
  });
  return Math.max(0, Math.round(result.netMonthly * 100));
}

function Tip({ icon, children }: { icon: IconName; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.line}>
      <Ionicons name={icon} size={18} color={t.primary} style={{ marginTop: 1 }} />
      <AppText variant="caption" style={{ flex: 1 }}>
        {children}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tip: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 10, alignItems: 'flex-start' },
});
