import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { AppText, Button, Card, Screen } from '@/components/ui';
import type { IconName } from '@/db/types';
import { COUNTRIES } from '@/lib/countries';
import { shortDate, toISODate } from '@/lib/dates';
import { PRIVACY_POLICY_URL, TERMS_URL } from '@/lib/links';
import { loadPlans, usePro, type PlanOption } from '@/lib/pro';
import { useTheme } from '@/lib/theme';
import { tr, N_ } from '@/i18n';
import { goBack } from '@/lib/navigation';

const AFRICAN_COUNT = COUNTRIES.filter((c) => c.region === 'africa').length;

const FEATURES: { icon: IconName; title: string; text: string; vars?: unknown[] }[] = [
  { icon: 'sparkles', title: N_('Smart budget'), text: N_('Enter your income and get a complete budget built on proven rules like 50/30/20.') },
  {
    icon: 'calculator',
    title: N_('Tax calculator'),
    text: N_('Take-home pay with real PAYE bands, reliefs and payroll deductions for {0} countries, {1} of them in Africa.'),
    vars: [COUNTRIES.length, AFRICAN_COUNT],
  },
  { icon: 'umbrella', title: N_('Pension planner'), text: N_('Your country’s pension scheme, contribution rates and retirement age, projected to retirement.') },
  { icon: 'flag', title: N_('Unlimited savings goals'), text: N_('Save for several things at once, each with its own target date.') },
  { icon: 'calendar', title: N_('Unlimited bills, with reminders'), text: N_('A notification the day before every bill is due.') },
  { icon: 'people', title: N_('Unlimited savings groups'), text: N_('Track every ajo, esusu, susu, chama or stokvel you’re in.') },
  { icon: 'download', title: N_('Statement import'), text: N_('Bring in transactions from your bank or mobile-money CSV.') },
  { icon: 'trending-down', title: N_('Debt payoff planner'), text: N_('Avalanche or snowball, and your debt-free date.') },
  { icon: 'swap-horizontal', title: N_('Currency converter'), text: N_('Official central bank exchange rates, with no parallel-market rates.') },
  { icon: 'trending-up', title: N_('Loan & savings calculators'), text: N_('Repayments, overpayment savings and compound growth.') },
];

type Status = 'loading' | 'ready' | 'error';

export default function PaywallScreen() {
  const t = useTheme();
  const { isPro, available, purchase, restore, managementUrl, trial } = usePro();
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [status, setStatus] = useState<Status>(available ? 'loading' : 'ready');
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!available) return;
    loadPlans().then(
      (p) => {
        setPlans(p);
        setStatus('ready');
      },
      () => setStatus('error'),
    );
  }, [available]);

  const plan = plans[selected];
  const store = Platform.OS === 'ios' ? tr('App Store') : tr('Google Play');

  const buy = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      if ((await purchase(plan.pkg)) === 'purchased') {
        if (plan.trial) {
          Alert.alert(
            tr('Your free trial has started'),
            tr('Everything is unlocked for {0}. You won’t be charged if you cancel at least 24 hours before the trial ends, in your {1} account settings.', [plan.trial, store]),
          );
        } else {
          Alert.alert(tr('Welcome to BudT Pro'), tr('Thanks for supporting BudT! Everything is unlocked.'));
        }
        goBack();
      }
    } catch {
      Alert.alert(tr('Purchase failed'), tr('The store couldn’t complete the purchase. You haven’t been charged. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const restorePurchases = async () => {
    setBusy(true);
    try {
      const restored = await restore();
      Alert.alert(restored ? tr('Purchases restored') : tr('Nothing to restore'), restored ? tr('BudT Pro is active again.') : tr('No BudT Pro purchase was found for this store account.'));
      if (restored) goBack();
    } catch {
      Alert.alert(tr('Restore failed'), tr('Couldn’t reach the store. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const anyTrial = plans.some((p) => p.trial);
  const title = isPro
    ? trial
      ? tr('Your free trial is on')
      : tr('You have BudT Pro')
    : plan?.trial
      ? tr('Try BudT Pro free for {0}', [plan.trial])
      : tr('Unlock BudT Pro');

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('BudT Pro') }} />
      <View style={styles.hero}>
        <Image source={require('../../assets/icon.png')} style={styles.icon} accessibilityIgnoresInvertColors />
        <AppText variant="title" style={{ textAlign: 'center' }}>{title}</AppText>
        <AppText style={{ textAlign: 'center', color: t.muted }}>{tr('Plan with goals and bills, know your real take-home pay and use every financial tool.')}</AppText>
      </View>

      <Card style={{ gap: 14 }}>
        {FEATURES.map((f) => (
          <View key={f.title} style={styles.feature}>
            <View style={[styles.featureIcon, { backgroundColor: t.primarySoft }]}>
              <Ionicons name={f.icon} size={20} color={t.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText weight="700">{tr(f.title)}</AppText>
              <AppText variant="caption">{tr(f.text, f.vars)}</AppText>
            </View>
          </View>
        ))}
      </Card>

      {isPro ? (
        <Card style={{ alignItems: 'center' }}>
          <Ionicons name="checkmark-circle" size={36} color={t.income} />
          <AppText weight="700">{tr('Pro is active on this device.')}</AppText>
          {trial ? (
            <AppText variant="caption" style={{ textAlign: 'center' }}>
              {tr('Free trial until {0}.', [shortDate(toISODate(new Date(trial.endsAt)))])}{' '}
              {trial.willRenew
                ? tr('Your plan then starts at its normal price unless you cancel at least 24 hours before.')
                : tr('It won’t renew, so you won’t be charged.')}
            </AppText>
          ) : null}
          {managementUrl ? <Button title={tr('Manage subscription')} variant="secondary" onPress={() => Linking.openURL(managementUrl)} /> : null}
        </Card>
      ) : !available ? (
        <Card>
          <AppText weight="700">{tr('Purchases aren’t set up yet')}</AppText>
          <AppText variant="caption">{tr('Add your RevenueCat API keys to .env (see .env.example) and use a development or store build to buy Pro.')}</AppText>
        </Card>
      ) : status === 'loading' ? (
        <ActivityIndicator color={t.primary} style={{ marginVertical: 24 }} />
      ) : !plans.length ? (
        <Card>
          <AppText weight="700">{tr('Plans aren’t available right now')}</AppText>
          <AppText variant="caption">{tr('Couldn’t load prices from the {0}. Check your connection and try again later.', [store])}</AppText>
        </Card>
      ) : (
        <>
          <View style={{ gap: 10 }} accessibilityRole="radiogroup">
            {plans.map((p, i) => {
              const active = i === selected;
              return (
                <Pressable
                  key={p.pkg.identifier}
                  onPress={() => setSelected(i)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active }}
                  style={[styles.plan, { borderColor: active ? t.primary : t.border, backgroundColor: active ? t.primarySoft : t.card }]}>
                  <Ionicons name={active ? 'radio-button-on' : 'radio-button-off'} size={22} color={active ? t.primary : t.muted} />
                  <View style={{ flex: 1 }}>
                    <AppText weight="700">{p.title}</AppText>
                    <AppText variant="caption">{p.price}</AppText>
                  </View>
                  {p.note ? (
                    <View style={[styles.note, { backgroundColor: t.accent }]}>
                      <AppText variant="caption" weight="800" color="#FFFFFF">
                        {p.note}
                      </AppText>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <Button
            title={busy ? tr('Please wait…') : plan?.kind === 'lifetime' ? tr('Buy lifetime access') : plan?.trial ? tr('Start free trial') : tr('Continue')}
            icon="sparkles"
            onPress={buy}
            disabled={busy}
          />
          {plan?.trial ? (
            <AppText variant="caption" style={{ textAlign: 'center' }}>
              {tr('Nothing to pay today. Cancel at least 24 hours before your {0} trial ends and you won’t be charged.', [plan.trial])}
            </AppText>
          ) : null}
        </>
      )}

      {!isPro && available && (
        <Pressable onPress={restorePurchases} disabled={busy} style={{ alignSelf: 'center' }} hitSlop={8}>
          <AppText weight="600" color={t.primary}>{tr('Restore purchases')}</AppText>
        </Pressable>
      )}

      <AppText variant="caption" style={{ textAlign: 'center' }}>{tr('Monthly and yearly plans renew automatically until cancelled. Cancel at least 24 hours before the end of the current period to avoid being charged for the next one. Manage or cancel any time in your {0} account settings. Lifetime is a one-time purchase.', [store])}
        {anyTrial ? ` ${tr('A free trial is for new subscribers only. When it ends, the plan you chose starts and is charged to your {0} account unless you cancelled.', [store])}` : ''}
      </AppText>
      <View style={styles.legal}>
        <Pressable onPress={() => Linking.openURL(TERMS_URL)} hitSlop={6}>
          <AppText variant="caption" color={t.primary}>{tr('Terms of Use')}</AppText>
        </Pressable>
        <AppText variant="caption">·</AppText>
        <Pressable onPress={() => Linking.openURL(PRIVACY_POLICY_URL)} hitSlop={6}>
          <AppText variant="caption" color={t.primary}>{tr('Privacy Policy')}</AppText>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 8, paddingTop: 8 },
  icon: { width: 84, height: 84, borderRadius: 20 },
  feature: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  featureIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  plan: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderRadius: 14, padding: 14 },
  note: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  legal: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
});
