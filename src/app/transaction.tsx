import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { AccountPicker, CategoryPicker } from '@/components/pickers';
import { AppText, Button, Field, HeaderDeleteButton, Screen, Segmented } from '@/components/ui';
import { budgetWarning, defaultAccountId, deleteTransaction, getTransaction, listAccounts, saveRecurring, saveTransaction } from '@/db/queries';
import type { TxType } from '@/db/types';
import { useQuery } from '@/hooks/useQuery';
import { advanceDate, shortDate, todayISO } from '@/lib/dates';
import { centsToInput, formatPercent, groupDigits, parseAmount } from '@/lib/money';
import { useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';

type Repeat = 'none' | 'weekly' | 'monthly' | 'yearly';

export default function TransactionScreen() {
  const params = useLocalSearchParams<{ id?: string; type?: string; account?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const db = useSQLiteContext();
  const t = useTheme();
  const { currency } = useSettings();

  const [type, setType] = useState<TxType>(params.type === 'income' ? 'income' : 'expense');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState<number | null>(params.account ? Number(params.account) : null);
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [recurringId, setRecurringId] = useState<number | null>(null);
  const accountCount = useQuery('accounts:count', async (d) => (await listAccounts(d)).length);

  useEffect(() => {
    if (!id) {
      if (!params.account) defaultAccountId(db).then((a) => setAccountId((current) => current ?? a));
      return;
    }
    getTransaction(db, id).then((tx) => {
      if (!tx) return;
      setType(tx.type);
      setAmount(centsToInput(tx.amount));
      setCategoryId(tx.category_id);
      setDate(tx.date);
      setNote(tx.note);
      setAccountId(tx.account_id);
      setRecurringId(tx.recurring_id);
    });
  }, [db, id, params.account]);

  const changeType = (next: TxType) => {
    if (next !== type) setCategoryId(null);
    setType(next);
  };

  const save = async () => {
    const cents = parseAmount(amount);
    if (!cents) return Alert.alert('Enter an amount', 'The amount must be greater than zero.');
    if (!categoryId) return Alert.alert('Pick a category');
    await saveTransaction(db, { id, type, amount: cents, category_id: categoryId, account_id: accountId, date, note: note.trim() });
    // New spending only: warn when it pushes a budget past 80% or over the limit.
    const warning = !id && type === 'expense' ? await budgetWarning(db, categoryId, date, cents) : null;
    if (repeat !== 'none') {
      // This one is recorded now; the rule adds the following ones on their dates.
      await saveRecurring(db, {
        type,
        amount: cents,
        category_id: categoryId,
        account_id: accountId,
        note: note.trim(),
        frequency: repeat,
        next_date: advanceDate(date, repeat),
      });
    }
    router.back();
    if (warning) {
      Alert.alert(
        warning.level === 'over' ? `${warning.name} budget exceeded` : `${warning.name} budget nearly used`,
        warning.level === 'over'
          ? `You’ve now spent ${formatPercent(warning.ratio, 0)} of this month’s ${warning.name} budget.`
          : `You’ve used ${formatPercent(warning.ratio, 0)} of this month’s ${warning.name} budget.`,
      );
    }
  };

  const remove = () =>
    Alert.alert('Delete transaction?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteTransaction(db, id!);
          router.back();
        },
      },
    ]);

  const accent = type === 'income' ? t.income : t.expense;

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? 'Edit transaction' : 'New transaction', headerRight: id ? () => <HeaderDeleteButton label="Delete transaction" onPress={remove} /> : undefined }} />
      <Segmented<TxType>
        value={type}
        onChange={changeType}
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
        ]}
      />

      <View style={[styles.amountBox, { backgroundColor: t.card, borderColor: t.border }]}>
        <AppText variant="label">Amount ({currency})</AppText>
        <TextInput
          value={groupDigits(amount)}
          onChangeText={(text) => setAmount(groupDigits(text, groupDigits(amount)))}
          placeholder="0.00"
          placeholderTextColor={t.muted}
          keyboardType="decimal-pad"
          autoFocus={!id}
          style={[styles.amountInput, { color: accent }]}
          accessibilityLabel="Amount"
        />
      </View>

      <View style={{ gap: 8 }}>
        <AppText variant="label">Category</AppText>
        <CategoryPicker type={type} value={categoryId} onChange={setCategoryId} />
      </View>

      {(accountCount ?? 0) > 1 && (
        <View style={{ gap: 8 }}>
          <AppText variant="label">{type === 'income' ? 'Paid into' : 'Paid from'}</AppText>
          <AccountPicker value={accountId} onChange={setAccountId} />
        </View>
      )}

      <DateField label="Date" value={date} onChange={setDate} />
      <Field label="Note" value={note} onChangeText={setNote} placeholder="What was it for? (optional)" returnKeyType="done" />

      {!id && (
        <View style={{ gap: 8 }}>
          <AppText variant="label">Repeat</AppText>
          <Segmented<Repeat>
            value={repeat}
            onChange={setRepeat}
            options={[
              { value: 'none', label: 'Never' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
              { value: 'yearly', label: 'Yearly' },
            ]}
          />
          {repeat !== 'none' && (
            <AppText variant="caption">
              BudT will add this {type} automatically every {repeat === 'weekly' ? 'week' : repeat === 'monthly' ? 'month' : 'year'}, starting{' '}
              {shortDate(advanceDate(date, repeat))}. Manage it under More → Recurring.
            </AppText>
          )}
        </View>
      )}
      {recurringId !== null && (
        <AppText variant="caption">Added automatically by a recurring rule. Editing this one doesn’t change the rule.</AppText>
      )}

      <Button title={id ? 'Save changes' : `Add ${type}`} icon="checkmark" onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  amountBox: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, alignItems: 'center', gap: 4 },
  amountInput: { fontSize: 40, fontWeight: '800', textAlign: 'center', minWidth: 160, fontVariant: ['tabular-nums'] },
});
