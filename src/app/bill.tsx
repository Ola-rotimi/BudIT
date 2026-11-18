import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { CategoryPicker } from '@/components/pickers';
import { AppText, Button, Field, HeaderDeleteButton, Screen, Segmented } from '@/components/ui';
import { deleteBill, getBill, saveBill } from '@/db/queries';
import { todayISO, type Frequency } from '@/lib/dates';
import { centsToInput, parseAmount } from '@/lib/money';
import { useSettings } from '@/lib/settings';
import { ProScreen } from '@/components/ProLock';
import { LIMIT_COPY, useFreeLimit } from '@/lib/limits';
import { tr } from '@/i18n';
import { goBack } from '@/lib/navigation';

export default function BillScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const db = useSQLiteContext();
  const { canAdd } = useFreeLimit('bills');
  const { currency } = useSettings();

  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [dueDate, setDueDate] = useState(todayISO());
  const [frequency, setFrequency] = useState<Frequency>('monthly');

  useEffect(() => {
    if (!id) return;
    getBill(db, id).then((b) => {
      if (!b) return;
      setName(b.name);
      setAmount(centsToInput(b.amount));
      setCategoryId(b.category_id);
      setDueDate(b.due_date);
      setFrequency(b.frequency);
    });
  }, [db, id]);

  const save = async () => {
    const cents = parseAmount(amount);
    if (!name.trim()) return Alert.alert(tr('Give the bill a name'));
    if (!cents) return Alert.alert(tr('Enter an amount'), tr('The amount must be greater than zero.'));
    if (!categoryId) return Alert.alert(tr('Pick a category'));
    await saveBill(db, { id, name: name.trim(), amount: cents, category_id: categoryId, due_date: dueDate, frequency });
    goBack();
  };

  const remove = () =>
    Alert.alert(tr('Delete bill?'), tr('Past payments stay in your transactions.'), [
      { text: tr('Cancel'), style: 'cancel' },
      {
        text: tr('Delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteBill(db, id!);
          goBack();
        },
      },
    ]);

  if (!id && canAdd === false) {
    return <ProScreen screenTitle={tr('Bills & subscriptions')} title={tr(LIMIT_COPY.bills.title)} message={tr(LIMIT_COPY.bills.message)} />;
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: id ? tr('Edit bill') : tr('New bill'), headerRight: id ? () => <HeaderDeleteButton label={tr('Delete bill')} onPress={remove} /> : undefined }} />
      <Field label={tr('Name')} value={name} onChangeText={setName} placeholder={tr('e.g. Rent, Netflix, Electricity')} autoFocus={!id} />
      <Field label={tr('Amount')} prefix={currency} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" />
      <View style={{ gap: 8 }}>
        <AppText variant="label">{tr('Repeats')}</AppText>
        <Segmented<Frequency>
          value={frequency}
          onChange={setFrequency}
          options={[
            { value: 'weekly', label: tr('Weekly') },
            { value: 'monthly', label: tr('Monthly') },
            { value: 'yearly', label: tr('Yearly') },
            { value: 'once', label: tr('Once') },
          ]}
        />
      </View>
      <DateField label={tr('Next due date')} value={dueDate} onChange={setDueDate} />
      <View style={{ gap: 8 }}>
        <AppText variant="label">{tr('Category')}</AppText>
        <CategoryPicker type="expense" value={categoryId} onChange={setCategoryId} />
      </View>
      <Button title={id ? tr('Save changes') : tr('Add bill')} icon="checkmark" onPress={save} />
    </Screen>
  );
}
