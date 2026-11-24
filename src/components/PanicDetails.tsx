import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { readPanicDetails, savePanicDetails, suggestedPanicDetails } from '@/db/decoy';
import { tr } from '@/i18n';
import { centsToInput, groupDigits, parseAmount } from '@/lib/money';
import { useSettings } from '@/lib/settings';
import { KeyboardScrollView } from './Keyboard';
import { AppText, Button, Field } from './ui';

type Form = { income: string; payday: string; balance: string; savings: string; account: string };

const EMPTY: Form = { income: '', payday: '', balance: '', savings: '', account: '' };

const toInput = (cents: number | null) => (cents === null ? '' : centsToInput(cents));

/**
 * Lets the user choose what the panic PIN's made-up budget shows (db/decoy.ts). Every field is
 * optional: an empty one gets an ordinary figure for their currency. Shown only in the real app.
 * `skipLabel` adds a button to leave without saving (when it follows setting the panic PIN).
 */
export function PanicDetailsForm({ onDone, skipLabel }: { onDone: () => void; skipLabel?: string }) {
  const db = useSQLiteContext();
  const { currency, monthStartDay } = useSettings();
  const [form, setForm] = useState<Form | null>(null);
  const [suggested, setSuggested] = useState<{ income: number; payday: number } | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([readPanicDetails(db), suggestedPanicDetails(db, currency, monthStartDay)]).then(
      ([d, s]) => {
        if (!live) return;
        setSuggested(s);
        setForm({ income: toInput(d.income), payday: d.payday ? String(d.payday) : '', balance: toInput(d.balance), savings: toInput(d.savings), account: d.account ?? '' });
      },
      (e) => {
        console.warn('Couldn’t load the made-up budget', e);
        if (live) setForm(EMPTY);
      },
    );
    return () => {
      live = false;
    };
  }, [db, currency, monthStartDay]);

  if (!form) return null;
  const set = (key: keyof Form) => (value: string) => setForm((f) => (f ? { ...f, [key]: value } : f));

  /** Empty means "choose for me"; anything else must be a valid amount. */
  const amount = (text: string) => (text.trim() ? parseAmount(text) : null);

  const save = async () => {
    const income = amount(form.income);
    const balance = amount(form.balance);
    const savings = amount(form.savings);
    const payday = form.payday.trim() ? Number(form.payday) : null;
    if (form.income.trim() && !income) return Alert.alert(tr('Check the monthly income'), tr('Enter an amount greater than zero, or leave it empty.'));
    if (form.balance.trim() && balance === null) return Alert.alert(tr('Check the account balance'));
    if (form.savings.trim() && savings === null) return Alert.alert(tr('Check the amount already saved'));
    if (payday !== null && !(Number.isInteger(payday) && payday >= 1 && payday <= 31)) {
      return Alert.alert(tr('Check the payday'), tr('Enter a day of the month from 1 to 31, or leave it empty.'));
    }
    try {
      await savePanicDetails(db, { income, payday, balance, savings, account: form.account.trim() || null });
      onDone();
    } catch (e) {
      console.warn('Couldn’t save the made-up budget', e);
      Alert.alert(tr('Something went wrong. Please try again.'));
    }
  };

  return (
    <KeyboardScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={{ gap: 6 }}>
        <AppText variant="heading">{tr('Your made-up budget')}</AppText>
        <AppText variant="caption">
          {tr('This is what anyone sees after you enter your panic PIN, with everyday spending filled in around it. Leave a field empty and BudIT picks an ordinary figure.')}
        </AppText>
      </View>
      <Field
        label={tr('Monthly income')}
        prefix={currency}
        value={form.income}
        onChangeText={set('income')}
        keyboardType="decimal-pad"
        placeholder={suggested ? groupDigits(centsToInput(suggested.income)) : ''}
      />
      <Field
        label={tr('Payday')}
        hint={tr('Day of the month the salary comes in')}
        value={form.payday}
        onChangeText={set('payday')}
        keyboardType="number-pad"
        maxLength={2}
        placeholder={suggested ? String(suggested.payday) : ''}
      />
      <Field label={tr('Account name')} value={form.account} onChangeText={set('account')} placeholder={tr('Main account')} maxLength={40} />
      <Field
        label={tr('Account balance today')}
        prefix={currency}
        value={form.balance}
        onChangeText={set('balance')}
        keyboardType="decimal-pad"
        placeholder={tr('Automatic')}
      />
      <Field
        label={tr('Emergency fund saved')}
        prefix={currency}
        value={form.savings}
        onChangeText={set('savings')}
        keyboardType="decimal-pad"
        placeholder={tr('Automatic')}
      />
      <Button title={tr('Save made-up budget')} icon="checkmark" onPress={save} />
      {skipLabel ? <Button title={skipLabel} variant="ghost" onPress={onDone} /> : null}
    </KeyboardScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 40 },
});
