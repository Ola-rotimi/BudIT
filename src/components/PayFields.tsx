import { StyleSheet, View } from 'react-native';
import type { CountryPreset, PayKey } from '@/lib/countries';
import type { PayBreakdown } from '@/lib/finance';
import { parseNumber } from '@/lib/money';
import { Field } from './ui';

export const PAY_LABEL: Record<PayKey, string> = {
  basic: 'Basic salary',
  housing: 'Housing allowance',
  transport: 'Transport allowance',
  other: 'Other allowances',
};

export type PayInputs = Record<PayKey, string>;

export const EMPTY_PAY: PayInputs = { basic: '0', housing: '0', transport: '0', other: '0' };

export function toBreakdown(inputs: PayInputs, factor = 1): PayBreakdown {
  return {
    basic: parseNumber(inputs.basic) * factor,
    housing: parseNumber(inputs.housing) * factor,
    transport: parseNumber(inputs.transport) * factor,
    other: parseNumber(inputs.other) * factor,
  };
}

/** Monthly components prefilled from the country's example split of its typical salary. */
export function examplePayInputs(preset?: CountryPreset): PayInputs {
  const ex = preset?.payStructure?.example;
  if (!ex) return EMPTY_PAY;
  const part = (pct: number) => String(Math.round(((preset.typicalSalary / 12) * pct) / 100));
  return { basic: part(ex.basic), housing: part(ex.housing), transport: part(ex.transport), other: part(ex.other) };
}

export const payTotal = (p: PayBreakdown) => p.basic + p.housing + p.transport + p.other;

/** One input per salary component, laid out two to a row like a payslip. */
export function PayFields({
  fields,
  values,
  onChange,
  currency,
}: {
  fields: PayKey[];
  values: PayInputs;
  onChange: (key: PayKey, value: string) => void;
  currency: string;
}) {
  const rows: PayKey[][] = [];
  for (let i = 0; i < fields.length; i += 2) rows.push(fields.slice(i, i + 2));
  return (
    <View style={{ gap: 12 }}>
      {rows.map((row) => (
        <View key={row.join()} style={styles.pair}>
          {row.map((key) => (
            <Field
              key={key}
              label={PAY_LABEL[key]}
              prefix={currency}
              value={values[key]}
              onChangeText={(v) => onChange(key, v)}
              keyboardType="decimal-pad"
              style={{ flex: 1 }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 12 },
});
