import Ionicons from '@expo/vector-icons/Ionicons';
import * as Print from 'expo-print';
import { Stack } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { ProScreen } from '@/components/ProLock';
import { AppText, Button, Card, Divider, Loading, Screen, StatLine } from '@/components/ui';
import { categoryTotalsBetween } from '@/db/queries';
import { useQuery } from '@/hooks/useQuery';
import { getCountry } from '@/lib/countries';
import { usePro } from '@/lib/pro';
import { useMoney, useSettings } from '@/lib/settings';
import { buildTaxSummary, taxSummaryHtml } from '@/lib/taxSummary';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';

/** Year-end summary of income, spending and estimated tax, shareable as a PDF. */
export default function TaxSummaryScreen() {
  const t = useTheme();
  const { isPro } = usePro();
  const { money, currency } = useMoney();
  const { country } = useSettings();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [busy, setBusy] = useState(false);

  const data = useQuery(`tax-summary:${year}`, async (db) => {
    const range = [`${year}-01-01`, `${year + 1}-01-01`] as const;
    const [income, expense] = await Promise.all([categoryTotalsBetween(db, ...range, 'income'), categoryTotalsBetween(db, ...range, 'expense')]);
    return { income, expense };
  });

  if (!isPro) {
    return (
      <ProScreen
        screenTitle={tr('Annual summary')}
        title={tr('Your year, ready for tax time')}
        message={tr('BudT Pro turns a year of records into a PDF: income and spending by category, plus an estimate of the tax due on your salary.')}
      />
    );
  }
  if (!data) return <Loading />;

  // The estimate only makes sense when the user's records are in their country's currency.
  const preset = getCountry(country);
  const summary = buildTaxSummary(year, data.income, data.expense, preset?.currency === currency ? preset : undefined);
  const e = summary.estimate;
  const thisYear = new Date().getFullYear();

  const share = async () => {
    setBusy(true);
    try {
      const { uri } = await Print.printToFileAsync({ html: taxSummaryHtml(summary, currency), width: 595, height: 842 });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: tr('BudT summary {0}', [year]) });
    } catch {
      Alert.alert(tr('Couldn’t create the PDF'), tr('Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Annual summary') }} />
      <View style={styles.years}>
        <Pressable onPress={() => setYear(year - 1)} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('Previous year')}>
          <Ionicons name="chevron-back" size={22} color={t.primary} />
        </Pressable>
        <AppText variant="heading">{year}</AppText>
        <Pressable onPress={() => setYear(year + 1)} disabled={year >= thisYear} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('Next year')}>
          <Ionicons name="chevron-forward" size={22} color={year >= thisYear ? t.border : t.primary} />
        </Pressable>
      </View>

      {!summary.totalIncome && !summary.totalExpense ? (
        <Card>
          <AppText variant="caption">{tr('Nothing recorded in {0}.', [year])}</AppText>
        </Card>
      ) : (
        <>
          <Card>
            <StatLine label={tr('Total income')} value={money(summary.totalIncome)} color={t.income} bold />
            {summary.income.slice(0, 5).map((r) => (
              <StatLine key={r.id} label={`  ${tr(r.name)}`} value={money(r.total)} />
            ))}
            <Divider />
            <StatLine label={tr('Total spending')} value={money(summary.totalExpense)} color={t.expense} bold />
            {summary.expense.slice(0, 5).map((r) => (
              <StatLine key={r.id} label={`  ${tr(r.name)}`} value={money(r.total)} />
            ))}
          </Card>

          <Card>
            <AppText variant="heading">{tr('Estimated tax on salary')}</AppText>
            {e ? (
              <>
                <AppText variant="caption">{tr('{0}, {1} rules, based on {2} of salary recorded this year.', [e.country, e.taxYear, money(summary.salary)])}</AppText>
                {e.contributions.map((c) => (
                  <StatLine key={c.name} label={tr(c.name)} value={money(c.amount)} />
                ))}
                {e.rentRelief > 0 && <StatLine label={tr('Rent relief')} value={money(e.rentRelief)} />}
                <StatLine label={tr('Taxable income')} value={money(e.taxable)} />
                <StatLine label={tr('Estimated income tax')} value={money(e.incomeTax)} color={t.expense} bold />
                <AppText variant="caption">{tr('Compare this with the PAYE on your payslips or your employer’s year-end tax certificate.')}</AppText>
              </>
            ) : (
              <AppText variant="caption">
                {!preset ? tr('Choose your country in Settings to estimate the tax on your salary.') : preset.currency !== currency ? tr('Your records are in {0}, but {1}’s tax rules use {2}, so there’s no estimate.', [currency, preset.name, preset.currency]) : tr('Record your pay under the Salary category to see an estimate.')}
              </AppText>
            )}
          </Card>

          <Button title={busy ? tr('Preparing PDF…') : tr('Share as PDF')} icon="document-text-outline" onPress={share} disabled={busy} />
          <AppText variant="caption" style={{ textAlign: 'center' }}>{tr('Covers 1 January – 31 December. Not tax advice; confirm with your tax authority before filing.')}</AppText>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  years: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
});
