import { Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ProLock } from '@/components/ProLock';
import { AppText, Card, Divider, Field, Screen, StatLine } from '@/components/ui';
import { simulateLoan } from '@/lib/finance';
import { parseNumber } from '@/lib/money';
import { usePro } from '@/lib/pro';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';

export default function LoanCalculator() {
  const t = useTheme();
  const { currency, major } = useMoney();
  const { isPro } = usePro();
  const [principal, setPrincipal] = useState('200000');
  const [rate, setRate] = useState('5.5');
  const [years, setYears] = useState('25');
  const [extra, setExtra] = useState('0');

  const p = parseNumber(principal);
  const r = parseNumber(rate);
  const months = Math.round(parseNumber(years) * 12);
  const base = simulateLoan(p, r, months);
  const withExtra = simulateLoan(p, r, months, parseNumber(extra));
  const hasExtra = parseNumber(extra) > 0 && base.payment > 0;
  const fmtMonths = (m: number) => `${Math.floor(m / 12)}y ${m % 12}m`;

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Loan & mortgage') }} />
      <Card>
        <Field label={tr('Loan amount')} prefix={currency} value={principal} onChangeText={setPrincipal} keyboardType="decimal-pad" />
        <View style={styles.pair}>
          <Field label={tr('Interest rate (% a year)')} value={rate} onChangeText={setRate} keyboardType="decimal-pad" style={{ flex: 1 }} />
          <Field label={tr('Term (years)')} value={years} onChangeText={setYears} keyboardType="decimal-pad" style={{ flex: 1 }} />
        </View>
        <Field
          label={tr('Extra monthly payment')}
          prefix={currency}
          value={extra}
          onChangeText={setExtra}
          keyboardType="decimal-pad"
          hint={tr('Overpaying shortens the loan and reduces interest.')}
        />
      </Card>

      {isPro ? (
        <>
          <Card>
            <AppText variant="label">{tr('Monthly payment')}</AppText>
            <AppText variant="display" color={t.primary} adjustsFontSizeToFit numberOfLines={1}>
              {major(base.payment)}
            </AppText>
            <Divider />
            <StatLine label={tr('Total interest')} value={major(base.totalInterest)} color={t.expense} />
            <StatLine label={tr('Total repaid')} value={major(base.totalPaid)} />
            <StatLine label={tr('Interest share')} value={base.totalPaid ? `${((base.totalInterest / base.totalPaid) * 100).toFixed(1)}%` : '—'} />
          </Card>

          {hasExtra && (
            <Card>
              <AppText variant="heading">{tr('With {0} extra a month', [major(parseNumber(extra))])}</AppText>
              <StatLine label={tr('Paying')} value={`${major(base.payment + parseNumber(extra))}/month`} />
              <StatLine label={tr('Paid off in')} value={fmtMonths(withExtra.months)} />
              <StatLine label={tr('Time saved')} value={fmtMonths(base.months - withExtra.months)} color={t.income} />
              <StatLine label={tr('Interest saved')} value={major(base.totalInterest - withExtra.totalInterest)} color={t.income} bold />
            </Card>
          )}
        </>
      ) : (
        <ProLock title={tr('See your repayments')} message={tr('BudT Pro works out your monthly payment, total interest, and how much time and interest overpaying saves.')} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 12 },
});
