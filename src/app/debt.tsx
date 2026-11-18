import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Button, Field, HeaderDeleteButton, Screen } from '@/components/ui';
import { deleteDebt, getDebt, saveDebt } from '@/db/queries';
import { centsToInput, parseAmount, parseNumber } from '@/lib/money';
import { useSettings } from '@/lib/settings';

export default function DebtScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const db = useSQLiteContext();
  const { currency } = useSettings();
  const [name, setName] = useState('');
  const [balance, setBalance] = useState('');
  const [apr, setApr] = useState('');
  const [minimum, setMinimum] = useState('');

  useEffect(() => {
    if (!id) return;
    getDebt(db, id).then((d) => {
      if (!d) return;
      setName(d.name);
      setBalance(centsToInput(d.balance));
      setApr(String(d.apr));
      setMinimum(centsToInput(d.min_payment));
    });
  }, [db, id]);

  const save = async () => {
    const balanceCents = parseAmount(balance);
    const minCents = minimum.trim() ? parseAmount(minimum) : 0;
    const rate = parseNumber(apr, -1);
    if (!name.trim()) return Alert.alert('Give the debt a name');
    if (!balanceCents) return Alert.alert('Enter what you still owe');
    if (rate < 0 || rate > 1000) return Alert.alert('Check the interest rate', 'Enter the yearly rate as a percentage, e.g. 24.');
    if (minCents === null) return Alert.alert('Check the minimum payment');
    await saveDebt(db, { id, name: name.trim(), balance: balanceCents, apr: rate, min_payment: minCents });
    router.back();
  };

  const remove = () =>
    Alert.alert('Delete this debt?', `“${name}” will be removed from your plan.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteDebt(db, id!);
          router.back();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? 'Edit debt' : 'Add debt', headerRight: id ? () => <HeaderDeleteButton label="Delete debt" onPress={remove} /> : undefined }} />
      <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Credit card, FairMoney loan" />
      <Field label="Amount owed now" prefix={currency} value={balance} onChangeText={setBalance} keyboardType="decimal-pad" placeholder="0" />
      <Field
        label="Interest rate (% a year)"
        value={apr}
        onChangeText={setApr}
        keyboardType="decimal-pad"
        placeholder="e.g. 24"
        hint="Use the yearly rate. For a monthly rate (common with app loans), multiply by 12."
      />
      <Field
        label="Minimum monthly payment"
        prefix={currency}
        value={minimum}
        onChangeText={setMinimum}
        keyboardType="decimal-pad"
        placeholder="0"
        hint="What you must pay each month to stay on track."
      />
      <Button title={id ? 'Save changes' : 'Add debt'} icon="checkmark" onPress={save} />
      {id ? (
        <Button
          title="Paid off"
          icon="trophy-outline"
          variant="secondary"
          onPress={async () => {
            await saveDebt(db, { id, name: name.trim(), balance: 0, apr: parseNumber(apr), min_payment: parseAmount(minimum) ?? 0 });
            Alert.alert('Well done! 🎉', `${name} is paid off.`);
            router.back();
          }}
        />
      ) : null}
    </Screen>
  );
}
