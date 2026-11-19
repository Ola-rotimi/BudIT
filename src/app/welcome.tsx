import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LanguagePicker } from '@/components/LanguagePicker';
import { ProBadge } from '@/components/ProLock';
import { SplitBar } from '@/components/SplitBar';
import { AppText, Button, Card, Field, Screen } from '@/components/ui';
import { setSetting } from '@/db/queries';
import type { IconName } from '@/db/types';
import { COUNTRIES, getCountry } from '@/lib/countries';
import { parseAmount } from '@/lib/money';
import { openAfterOnboarding } from '@/lib/onboarding';
import { usePro } from '@/lib/pro';
import { useMoney, useSettings } from '@/lib/settings';
import { PLAN_STYLES, SMART_BUDGET_KEY, type SmartBudgetInput } from '@/lib/smartBudget';
import { useTheme } from '@/lib/theme';
import { tr, N_ } from '@/i18n';

const AFRICAN = COUNTRIES.filter((c) => c.region === 'africa').length;
const STEPS = ['welcome', 'tour', 'country', 'income', 'plan'] as const;
type Step = (typeof STEPS)[number];

const TOUR: { icon: IconName; title: string; text: string; pro?: boolean }[] = [
  { icon: 'home', title: N_('Home'), text: N_('Tap Expense or Income to record money in seconds. Activity and Insights sit on your balance card.') },
  { icon: 'pie-chart', title: N_('Budgets'), text: N_('Set monthly limits per category and see what’s left as you spend.') },
  { icon: 'sparkles', title: N_('Smart budget'), text: N_('Enter your income and BudIT builds a complete budget for you.'), pro: true },
  { icon: 'calculator', title: N_('Tax & Pension'), text: N_('Your real take-home pay and retirement outlook, with your country’s rules.'), pro: true },
  { icon: 'grid', title: N_('More'), text: N_('Savings goals, bills, the currency converter and other tools.') },
];

/** First-launch walkthrough. Finishing or skipping it marks the user as onboarded. */
export default function WelcomeScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { country, setOnboarded } = useSettings();
  const { currency, money } = useMoney();
  const { isPro } = usePro();
  const [index, setIndex] = useState(0);
  const [income, setIncome] = useState('');
  const step: Step = STEPS[index];
  const home = getCountry(country);
  const incomeCents = parseAmount(income) ?? 0;

  const finish = async (openSmartBudget = false) => {
    if (incomeCents > 0) await setSetting(db, SMART_BUDGET_KEY, JSON.stringify({ income } satisfies SmartBudgetInput));
    if (openSmartBudget) openAfterOnboarding('/smart-budget');
    await setOnboarded(true);
    router.replace('/');
  };
  const next = () => setIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const back = () => setIndex((i) => Math.max(i - 1, 0));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <View style={styles.dots} accessibilityLabel={tr('Step {0} of {1}', [index + 1, STEPS.length])}>
          {STEPS.map((s, i) => (
            <View key={s} style={[styles.dot, { backgroundColor: i === index ? t.primary : t.border, width: i === index ? 20 : 8 }]} />
          ))}
        </View>
        {step !== 'plan' && (
          <Pressable onPress={() => finish()} hitSlop={10} accessibilityRole="button">
            <AppText weight="600" color={t.muted}>{tr('Skip')}</AppText>
          </Pressable>
        )}
      </View>

      <View style={{ flex: 1 }}>
        <Screen>
          {step === 'welcome' && (
            <View style={styles.hero}>
              <Image source={require('../../assets/icon.png')} style={styles.icon} accessibilityIgnoresInvertColors />
              <LanguagePicker compact />
              <AppText variant="title" style={{ textAlign: 'center' }}>{tr('Welcome to BudIT')}</AppText>
              <AppText style={{ textAlign: 'center', color: t.muted }}>{tr('Your money, planned. Track what comes in and goes out, stay on budget and plan ahead.')}</AppText>
              <Card style={{ alignSelf: 'stretch', gap: 14 }}>
                <Point icon="flash">{tr('Record income and expenses in a couple of taps')}</Point>
                <Point icon="pie-chart">{tr('Budgets that warn you before you overspend')}</Point>
                <Point icon="lock-closed">{tr('Private: your data stays on your phone, no account needed')}</Point>
              </Card>
            </View>
          )}

          {step === 'tour' && (
            <>
              <Heading title={tr('How BudIT works')} text={tr('Five places to know. You can replay this tour from Settings any time.')} />
              <Card style={{ gap: 14 }}>
                {TOUR.map((item) => (
                  <Point key={item.title} icon={item.icon} title={tr(item.title)} badge={item.pro && !isPro}>
                    {tr(item.text)}
                  </Point>
                ))}
              </Card>
            </>
          )}

          {step === 'country' && (
            <>
              <Heading title={tr('Where are you based?')} text={tr('This sets your currency and fills in local tax and pension rules.')} />
              <Card onPress={() => router.push({ pathname: '/country', params: { purpose: 'home' } })} style={styles.countryRow}>
                <Text style={styles.flag}>{home?.flag ?? '🌍'}</Text>
                <View style={{ flex: 1 }}>
                  <AppText weight="700">{home?.name ?? tr('Choose your country')}</AppText>
                  <AppText variant="caption">{home ? tr('Currency: {0}', [home.currency]) : tr('{0} African countries and {1} more supported', [AFRICAN, COUNTRIES.length - AFRICAN])}</AppText>
                </View>
                <Ionicons name="chevron-forward" size={18} color={t.muted} />
              </Card>
            </>
          )}

          {step === 'income' && (
            <>
              <Heading
                title={tr('What do you earn a month?')}
                text={tr('Your take-home pay, after tax. BudIT uses it to suggest a budget. It never leaves your phone.')}
              />
              <Card>
                <Field
                  label={tr('Monthly take-home pay')}
                  value={income}
                  onChangeText={setIncome}
                  keyboardType="decimal-pad"
                  prefix={currency}
                  placeholder="0"
                  autoFocus
                  hint={tr('Optional. You can change it later in Smart budget.')}
                />
              </Card>
            </>
          )}

          {step === 'plan' && (
            <>
              <Heading
                title={incomeCents > 0 ? tr('Your starting plan') : tr('Budget with the 50/30/20 rule')}
                text={tr('The most widely recommended way to budget: half for needs, 30% for wants and 20% for savings and paying down debt.')}
              />
              <Card>
                <SplitBar
                  split={PLAN_STYLES.balanced.split}
                  amounts={
                    incomeCents > 0
                      ? {
                          needs: money(Math.round(incomeCents * 0.5)),
                          wants: money(Math.round(incomeCents * 0.3)),
                          savings: money(Math.round(incomeCents * 0.2)),
                        }
                      : undefined
                  }
                />
              </Card>
              <Card style={{ gap: 10 }}>
                <View style={styles.pointRow}>
                  <Ionicons name="sparkles" size={20} color={t.primary} />
                  <AppText weight="700" style={{ flex: 1 }}>{tr('Let Smart budget do the rest')}</AppText>
                  {!isPro && <ProBadge />}
                </View>
                <AppText variant="caption">{tr('BudIT splits your income across rent, groceries, transport and every other category, sets the budgets for you and starts an emergency fund goal.')}</AppText>
              </Card>
            </>
          )}
        </Screen>
      </View>

      <View style={[styles.footer, { borderTopColor: t.border }]}>
        {step === 'plan' ? (
          <>
            <Button title={tr('Build my budget')} icon="sparkles" onPress={() => finish(true)} />
            <Button title={tr('Start using BudIT')} variant="ghost" onPress={() => finish()} />
          </>
        ) : (
          <View style={styles.nav}>
            {index > 0 && <Button title={tr('Back')} variant="secondary" onPress={back} style={{ flex: 1 }} />}
            <Button
              title={step === 'welcome' ? tr('Get started') : step === 'country' && !home ? tr('Not now') : tr('Next')}
              icon={step === 'welcome' ? 'arrow-forward' : undefined}
              onPress={next}
              style={{ flex: 2 }}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

function Heading({ title, text }: { title: string; text: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6, paddingTop: 8 }}>
      <AppText variant="title">{title}</AppText>
      <AppText style={{ color: t.muted }}>{text}</AppText>
    </View>
  );
}

function Point({ icon, title, badge, children }: { icon: IconName; title?: string; badge?: boolean; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.pointRow}>
      <View style={[styles.pointIcon, { backgroundColor: t.primarySoft }]}>
        <Ionicons name={icon} size={18} color={t.primary} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        {title ? (
          <View style={styles.pointTitle}>
            <AppText weight="700">{title}</AppText>
            {badge && <ProBadge />}
          </View>
        ) : null}
        <AppText variant={title ? 'caption' : 'body'}>{children}</AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { height: 8, borderRadius: 4 },
  hero: { alignItems: 'center', gap: 12, paddingTop: 16 },
  icon: { width: 96, height: 96, borderRadius: 22 },
  countryRow: { flexDirection: 'row', alignItems: 'center' },
  flag: { fontSize: 30 },
  pointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pointIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  pointTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footer: { gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth },
  nav: { flexDirection: 'row', gap: 10 },
});
