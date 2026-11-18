import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { BarChart } from '@/components/charts';
import { CountryBanner, PresetNotes } from '@/components/CountryBanner';
import { examplePayInputs, PayFields, payTotal, toBreakdown, type PayInputs } from '@/components/PayFields';
import { AppText, Card, Divider, Field, Screen, StatLine } from '@/components/ui';
import { getCountry, type CountryPreset, type PayKey } from '@/lib/countries';
import { PAY_BASE_LABEL, payBases, projectPension, type PensionInput } from '@/lib/finance';
import { ProLock } from '@/components/ProLock';
import { useConversion } from '@/lib/fx';
import { formatMajor, parseNumber } from '@/lib/money';
import { usePro } from '@/lib/pro';
import { useMoney, useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';

type Inputs = Record<keyof PensionInput, string>;

function defaultsFor(preset?: CountryPreset): Inputs {
  const p = preset?.pension;
  return {
    currentAge: '30',
    retireAge: String(p?.retireAge ?? 65),
    currentPot: '0',
    salary: String(preset?.typicalSalary ?? 40_000),
    employeePct: String(p?.employeePct ?? 5),
    employerPct: String(p?.employerPct ?? 5),
    salaryCap: String(p?.salaryCap ?? 0),
    extraMonthly: '0',
    returnPct: String(p?.returnPct ?? 5),
    salaryGrowthPct: String(p?.salaryGrowthPct ?? 3),
    inflationPct: String(p?.inflationPct ?? 2.5),
    withdrawalPct: '4',
    targetMonthlyIncome: '0',
  };
}

/** Salary components that count towards pensionable pay, by pension base. */
const PENSIONABLE: Record<'basic' | 'bht', PayKey[]> = { basic: ['basic'], bht: ['basic', 'housing', 'transport'] };

export default function PensionCalculator() {
  const { calcCountry } = useSettings();
  const preset = getCountry(calcCountry);
  // Keyed on the country so switching resets every input to that country's preset.
  return <PensionForm key={calcCountry} preset={preset} />;
}

function PensionForm({ preset }: { preset?: CountryPreset }) {
  const t = useTheme();
  const { currency, major } = useMoney(preset?.currency);
  const { currency: homeCurrency } = useSettings();
  const { isPro } = usePro();
  // Skip fetching rates while the results are locked.
  const conversion = useConversion(currency, isPro ? homeCurrency : currency);
  const [inputs, setInputs] = useState<Inputs>(() => defaultsFor(preset));
  const [pay, setPay] = useState<PayInputs>(() => examplePayInputs(preset));

  // Where the scheme is charged on part of pay (Nigeria: basic + housing + transport), ask for those parts.
  const base = preset?.pension.base;
  const pensionBase = base === 'basic' || base === 'bht' ? base : null;
  const monthlyPay = toBreakdown(pay);
  const pensionable = pensionBase ? payBases(payTotal(monthlyPay), monthlyPay)[pensionBase] * 12 : null;

  const parsed = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, parseNumber(v)])) as PensionInput;
  const num = pensionable === null ? parsed : { ...parsed, salary: pensionable };
  const r = projectPension({ ...num, retireAge: Math.min(num.retireAge, num.currentAge + 70) });

  const field = (key: keyof PensionInput, label: string, opts: { money?: boolean; hint?: string } = {}) => (
    <Field
      label={label}
      prefix={opts.money ? currency : undefined}
      hint={opts.hint}
      value={inputs[key]}
      onChangeText={(v) => setInputs((s) => ({ ...s, [key]: v }))}
      keyboardType="decimal-pad"
      style={{ flex: 1 }}
    />
  );

  const step = Math.max(1, Math.ceil(r.yearly.length / 10));
  const points = r.yearly.filter((_, i) => (i + 1) % step === 0 || i === r.yearly.length - 1);
  const onTrack = num.targetMonthlyIncome > 0 && r.shortfallReal <= 0;

  return (
    <Screen>
      <CountryBanner preset={preset} subtitle={preset ? `${preset.pension.scheme} · ${preset.currency}` : undefined} />

      <Card>
        <AppText variant="heading">{tr('About you')}</AppText>
        <View style={styles.pair}>
          {field('currentAge', tr('Current age'))}
          {field('retireAge', tr('Retirement age'))}
        </View>
        {pensionBase ? (
          field('currentPot', tr('Saved so far'), { money: true })
        ) : (
          <View style={styles.pair}>
            {field('currentPot', tr('Saved so far'), { money: true })}
            {field('salary', tr('Annual salary'), { money: true, hint: tr('{0} a month', [major(num.salary / 12)]) })}
          </View>
        )}
      </Card>

      {pensionBase && (
        <Card>
          <AppText variant="heading">{tr('Monthly pay')}</AppText>
          <AppText variant="caption">{tr('Contributions are worked out on your {0}, as on your payslip. Other allowances don’t count.', [tr(PAY_BASE_LABEL[pensionBase])])}</AppText>
          <PayFields
            fields={PENSIONABLE[pensionBase]}
            values={pay}
            onChange={(k, v) => setPay((s) => ({ ...s, [k]: v }))}
            currency={currency}
          />
          <StatLine label={tr('Pensionable pay per month')} value={major(num.salary / 12)} bold />
          <AppText variant="caption">{tr('You pay {0} and your employer pays {1} a month.', [major((num.salary / 12) * (num.employeePct / 100)), major((num.salary / 12) * (num.employerPct / 100))])}</AppText>
        </Card>
      )}

      <Card>
        <AppText variant="heading">{tr('Contributions')}</AppText>
        <View style={styles.pair}>
          {field('employeePct', pensionBase ? tr('You (% of pensionable pay)') : tr('You (% of salary)'))}
          {field('employerPct', tr('Employer (%)'))}
        </View>
        {field('salaryCap', tr('Contribution salary cap (per year)'), {
          money: true,
          hint: num.salaryCap > 0 ? tr('Contributions stop above this salary. Set it to 0 for no cap.') : tr('No cap. Contributions apply to your full salary.'),
        })}
        {field('extraMonthly', tr('Extra monthly top-up'), { money: true, hint: tr('Voluntary contributions on top of the mandatory ones.') })}
      </Card>

      <Card>
        <AppText variant="heading">{tr('Assumptions')}</AppText>
        <View style={styles.pair}>
          {field('returnPct', tr('Investment return %'))}
          {field('salaryGrowthPct', tr('Salary growth %'))}
        </View>
        <View style={styles.pair}>
          {field('inflationPct', tr('Inflation %'))}
          {field('withdrawalPct', tr('Withdrawal rate %'))}
        </View>
        {field('targetMonthlyIncome', tr('Target monthly income (today’s money)'), {
          money: true,
          hint: tr('Optional. Set it to see whether you’re on track.'),
        })}
      </Card>

      {isPro ? (
        <>
          <Card>
            <AppText variant="label">{tr('Pot at age {0}', [num.currentAge + r.years])}</AppText>
            <AppText variant="display" color={t.primary} adjustsFontSizeToFit numberOfLines={1}>
              {major(r.pot)}
            </AppText>
            <AppText variant="caption">{tr('Worth {0} in today’s money', [major(r.potReal)])}</AppText>
            {conversion.rate !== null && currency !== homeCurrency && (
              <AppText variant="caption" color={t.primary}>{tr('≈ {0} in {1} today, at official central bank rates', [formatMajor(r.potReal * conversion.rate, homeCurrency), homeCurrency])}</AppText>
            )}
            <Divider />
            <StatLine label={tr('Estimated retirement income')} value={`${major(r.monthlyIncomeReal)}/month`} color={t.income} bold />
            <AppText variant="caption">{tr('In today’s money, withdrawing {0}% of the pot a year.', [inputs.withdrawalPct])}</AppText>
            <Divider />
            <StatLine label={tr('Starting pot')} value={major(num.currentPot)} />
            <StatLine label={tr('Your contributions')} value={major(r.employeeTotal)} />
            <StatLine label={tr('Employer contributions')} value={major(r.employerTotal)} />
            {r.extraTotal > 0 && <StatLine label={tr('Extra top-ups')} value={major(r.extraTotal)} />}
            <StatLine label={tr('Investment growth')} value={major(r.growth)} color={t.income} />
          </Card>

          {num.targetMonthlyIncome > 0 && (
            <Card style={{ borderColor: onTrack ? t.income : t.warning, borderWidth: 1 }}>
              <AppText variant="heading" color={onTrack ? t.income : t.warning}>
                {onTrack ? tr('You’re on track') : tr('You may fall short')}
              </AppText>
              <StatLine label={tr('Pot needed (today’s money)')} value={major(r.requiredPotReal)} />
              {!onTrack && (
                <>
                  <StatLine label={tr('Shortfall (today’s money)')} value={major(r.shortfallReal)} color={t.expense} />
                  <StatLine label={tr('Extra needed each month')} value={major(r.extraMonthlyNeeded)} bold />
                </>
              )}
            </Card>
          )}

          {points.length > 1 && (
            <Card>
              <AppText variant="heading">{tr('Pot by age')}</AppText>
              <BarChart
                labels={points.map((p) => String(p.age))}
                series={[{ color: t.primary, values: points.map((p) => p.pot) }]}
                formatValue={(v) => major(v, true)}
              />
            </Card>
          )}

        </>
      ) : (
        <ProLock
          title={tr('See your retirement projection')}
          message={tr('BudT Pro projects your pension pot and retirement income{0}, and shows whether you’re on track.', [preset ? tr(' under {0}', [preset.pension.scheme]) : ''])}
        />
      )}

      <PresetNotes
        title={preset ? `${preset.name}: ${preset.pension.scheme}` : tr('About this projection')}
        notes={[
          ...(preset?.pension.notes ?? []),
          tr('Projections are estimates based on your assumptions, not financial advice. Investment returns are not guaranteed.'),
        ]}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 12 },
});
