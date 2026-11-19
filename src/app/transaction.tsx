import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, TextInput, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { AccountPicker, CategoryPicker } from '@/components/pickers';
import { AppText, Button, Field, HeaderDeleteButton, Screen, Segmented } from '@/components/ui';
import { MissingRateError } from '@/db/currency';
import { budgetWarning, defaultAccountId, deleteTransaction, getTransaction, listAccounts, saveRecurring, saveTransaction } from '@/db/queries';
import type { TxType } from '@/db/types';
import { useQuery } from '@/hooks/useQuery';
import { advanceDate, shortDate, todayISO } from '@/lib/dates';
import { useConversion } from '@/lib/fx';
import { centsToInput, formatMoney, formatPercent, groupDigits, parseAmount } from '@/lib/money';
import { useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';
import { goBack } from '@/lib/navigation';

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
  const accounts = useQuery('accounts:list', (d) => listAccounts(d));
  const accountCount = accounts?.length;
  // An account in another currency (e.g. a USD domiciliary account) takes amounts in that currency.
  const accountCurrency = accounts?.find((a) => a.id === accountId)?.currency ?? null;
  const entryCurrency = accountCurrency && accountCurrency !== currency ? accountCurrency : currency;
  const conversion = useConversion(entryCurrency, currency);

  useEffect(() => {
    if (!id) {
      if (!params.account) defaultAccountId(db).then((a) => setAccountId((current) => current ?? a));
      return;
    }
    getTransaction(db, id).then((tx) => {
      if (!tx) return;
      setType(tx.type);
      setAmount(centsToInput(tx.orig_amount ?? tx.amount));
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
    if (!cents) return Alert.alert(tr('Enter an amount'), tr('The amount must be greater than zero.'));
    if (!categoryId) return Alert.alert(tr('Pick a category'));
    let saved: Awaited<ReturnType<typeof saveTransaction>>;
    try {
      saved = await saveTransaction(db, { id, type, amount: cents, category_id: categoryId, account_id: accountId, date, note: note.trim() });
    } catch (e) {
      if (e instanceof MissingRateError) {
        return Alert.alert(tr('No exchange rate yet'), tr('BudIT needs the official {0} rate once to record this. Connect to the internet and try again.', [entryCurrency]));
      }
      throw e;
    }
    // New spending only: warn when it pushes a budget past 80% or over the limit.
    const warning = !id && type === 'expense' ? await budgetWarning(db, categoryId, date, saved.amount) : null;
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
    goBack();
    if (warning) {
      Alert.alert(
        warning.level === 'over' ? tr('{0} budget exceeded', [tr(warning.name)]) : tr('{0} budget nearly used', [tr(warning.name)]),
        warning.level === 'over' ? tr('You’ve now spent {0} of this month’s {1} budget.', [formatPercent(warning.ratio, 0), warning.name]) : tr('You’ve used {0} of this month’s {1} budget.', [formatPercent(warning.ratio, 0), warning.name]),
      );
    }
  };

  const remove = () =>
    Alert.alert(tr('Delete transaction?'), tr('This cannot be undone.'), [
      { text: tr('Cancel'), style: 'cancel' },
      {
        text: tr('Delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteTransaction(db, id!);
          goBack();
        },
      },
    ]);

  const accent = type === 'income' ? t.income : t.expense;

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? tr('Edit transaction') : tr('New transaction'), headerRight: id ? () => <HeaderDeleteButton label={tr('Delete transaction')} onPress={remove} /> : undefined }} />
      <Segmented<TxType>
        value={type}
        onChange={changeType}
        options={[
          { value: 'expense', label: tr('Expense') },
          { value: 'income', label: tr('Income') },
        ]}
      />

      <View style={[styles.amountBox, { backgroundColor: t.card, borderColor: t.border }]}>
        <AppText variant="label">{tr('Amount ({0})', [entryCurrency])}</AppText>
        <TextInput
          value={groupDigits(amount)}
          onChangeText={(text) => setAmount(groupDigits(text, groupDigits(amount)))}
          placeholder="0.00"
          placeholderTextColor={t.muted}
          keyboardType="decimal-pad"
          autoFocus={!id}
          style={[styles.amountInput, { color: accent }]}
          accessibilityLabel={tr('Amount')}
        />
        {entryCurrency !== currency && (
          <AppText variant="caption">
            {conversion.rate !== null && parseAmount(amount)
              ? tr('≈ {0} at the official rate', [formatMoney(Math.round((parseAmount(amount) ?? 0) * conversion.rate), currency)])
              : tr('Counted in your budgets in {0} at the official rate', [currency])}
          </AppText>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <AppText variant="label">{tr('Category')}</AppText>
        <CategoryPicker type={type} value={categoryId} onChange={setCategoryId} />
      </View>

      {(accountCount ?? 0) > 1 && (
        <View style={{ gap: 8 }}>
          <AppText variant="label">{type === 'income' ? tr('Paid into') : tr('Paid from')}</AppText>
          <AccountPicker value={accountId} onChange={setAccountId} />
        </View>
      )}

      <DateField label={tr('Date')} value={date} onChange={setDate} />
      <Field label={tr('Note')} value={note} onChangeText={setNote} placeholder={tr('What was it for? (optional)')} returnKeyType="done" />

      {!id && (
        <View style={{ gap: 8 }}>
          <AppText variant="label">{tr('Repeat')}</AppText>
          <Segmented<Repeat>
            value={repeat}
            onChange={setRepeat}
            options={[
              { value: 'none', label: tr('Never') },
              { value: 'weekly', label: tr('Weekly') },
              { value: 'monthly', label: tr('Monthly') },
              { value: 'yearly', label: tr('Yearly') },
            ]}
          />
          {repeat !== 'none' && (
            <AppText variant="caption">{tr('BudIT will add this {0} automatically every {1}, starting {2}. Manage it under More → Recurring.', [type === 'income' ? tr('income') : tr('expense'), repeat === 'weekly' ? tr('week') : repeat === 'monthly' ? tr('month') : tr('year'), shortDate(advanceDate(date, repeat))])}</AppText>
          )}
        </View>
      )}
      {recurringId !== null && (
        <AppText variant="caption">{tr('Added automatically by a recurring rule. Editing this one doesn’t change the rule.')}</AppText>
      )}

      <Button title={id ? tr('Save changes') : type === 'income' ? tr('Add income') : tr('Add expense')} icon="checkmark" onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  amountBox: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16, alignItems: 'center', gap: 4 },
  amountInput: { fontSize: 40, fontWeight: '800', textAlign: 'center', minWidth: 160, fontVariant: ['tabular-nums'] },
});
