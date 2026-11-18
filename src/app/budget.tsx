import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { CategoryPicker } from '@/components/pickers';
import { AppText, Button, Field, HeaderDeleteButton, Screen } from '@/components/ui';
import { categoryTotals, deleteBudget, getBudget, setBudget } from '@/db/queries';
import { currentMonthKey, shiftMonth } from '@/lib/dates';
import { centsToInput, parseAmount } from '@/lib/money';
import { useMoney } from '@/lib/settings';
import { tr } from '@/i18n';
import { goBack } from '@/lib/navigation';

export default function BudgetScreen() {
  const params = useLocalSearchParams<{ categoryId?: string }>();
  const db = useSQLiteContext();
  const { currency, money } = useMoney();
  const [categoryId, setCategoryId] = useState<number | null>(params.categoryId ? Number(params.categoryId) : null);
  const [amount, setAmount] = useState('');
  const [exists, setExists] = useState(false);
  const [lastMonth, setLastMonth] = useState<number | null>(null);

  useEffect(() => {
    if (!categoryId) return;
    getBudget(db, categoryId).then((b) => {
      setExists(!!b);
      setAmount(b ? centsToInput(b.amount) : '');
    });
    categoryTotals(db, shiftMonth(currentMonthKey(), -1), 'expense').then((rows) =>
      setLastMonth(rows.find((r) => r.id === categoryId)?.total ?? 0),
    );
  }, [db, categoryId]);

  const save = async () => {
    const cents = parseAmount(amount);
    if (!categoryId) return Alert.alert(tr('Pick a category'));
    if (!cents) return Alert.alert(tr('Enter a monthly limit'), tr('The amount must be greater than zero.'));
    await setBudget(db, categoryId, cents);
    goBack();
  };

  const remove = () =>
    Alert.alert(tr('Remove this budget?'), tr('Your spending in this category is kept; only the monthly limit is removed.'), [
      { text: tr('Cancel'), style: 'cancel' },
      {
        text: tr('Remove'),
        style: 'destructive',
        onPress: async () => {
          await deleteBudget(db, categoryId!);
          goBack();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: exists ? tr('Edit budget') : tr('New budget'), headerRight: exists ? () => <HeaderDeleteButton label={tr('Remove budget')} onPress={remove} /> : undefined }} />
      <View style={{ gap: 8 }}>
        <AppText variant="label">{tr('Category')}</AppText>
        <CategoryPicker type="expense" value={categoryId} onChange={setCategoryId} />
      </View>
      <Field
        label={tr('Monthly limit')}
        prefix={currency}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        placeholder="0.00"
        hint={lastMonth ? tr('You spent {0} on this last month.', [money(lastMonth)]) : tr('Budgets repeat every month.')}
      />
      <Button title={tr('Save budget')} icon="checkmark" onPress={save} />
    </Screen>
  );
}
