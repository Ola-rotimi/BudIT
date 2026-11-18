import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { ColorPicker } from '@/components/pickers';
import { AppText, Button, Field, HeaderDeleteButton, Screen, Segmented } from '@/components/ui';
import { getAccount, removeAccount, saveAccount } from '@/db/queries';
import type { AccountKind } from '@/db/types';
import { ACCOUNT_KINDS } from '@/lib/accounts';
import { centsToInput, parseAmount } from '@/lib/money';
import { useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';

/** Create or edit a wallet. Editing the balance adjusts the opening balance so it matches reality. */
export default function AccountScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const db = useSQLiteContext();
  const t = useTheme();
  const { currency } = useSettings();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<AccountKind>('bank');
  const [color, setColor] = useState('#0F766E');
  const [balance, setBalance] = useState('');
  const [owed, setOwed] = useState(false);
  const [original, setOriginal] = useState<{ opening: number; balance: number } | null>(null);

  useEffect(() => {
    if (!id) return;
    getAccount(db, id).then((a) => {
      if (!a) return;
      setName(a.name);
      setKind(a.kind);
      setColor(a.color);
      setBalance(centsToInput(Math.abs(a.balance)));
      setOwed(a.balance < 0);
      setOriginal({ opening: a.opening_balance, balance: a.balance });
    });
  }, [db, id]);

  const save = async () => {
    if (!name.trim()) return Alert.alert('Give the account a name');
    const cents = balance.trim() ? parseAmount(balance) : 0;
    if (cents === null) return Alert.alert('Check the balance');
    const signed = owed ? -cents : cents;
    // For an existing account the balance entered is "what it is now": shift the opening balance by the difference.
    const opening = original ? original.opening + (signed - original.balance) : signed;
    await saveAccount(db, { id, name: name.trim(), kind, icon: ACCOUNT_KINDS[kind].icon, color, opening_balance: opening });
    router.back();
  };

  const remove = () =>
    Alert.alert('Remove account?', 'If it has transactions it will be archived, so your history and totals stay correct.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!(await removeAccount(db, id!))) return Alert.alert('Keep at least one account', 'BudT needs one active account for your transactions.');
          router.back();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: id ? 'Edit account' : 'New account',
          headerRight: id ? () => <HeaderDeleteButton label="Remove account" icon="archive-outline" onPress={remove} /> : undefined,
        }}
      />
      <View style={{ gap: 8 }}>
        <AppText variant="label">Type</AppText>
        <Segmented<AccountKind>
          value={kind}
          onChange={setKind}
          options={(Object.keys(ACCOUNT_KINDS) as AccountKind[]).map((k) => ({ value: k, label: ACCOUNT_KINDS[k].label }))}
        />
        <AppText variant="caption">{ACCOUNT_KINDS[kind].example}</AppText>
      </View>
      <Field label="Name" value={name} onChangeText={setName} placeholder={kind === 'mobile' ? 'e.g. M-Pesa' : kind === 'cash' ? 'e.g. Wallet' : 'e.g. GTBank salary'} />
      <Field
        label={id ? 'Balance now' : 'Current balance'}
        prefix={currency}
        value={balance}
        onChangeText={setBalance}
        keyboardType="decimal-pad"
        placeholder="0"
        hint={id ? 'Change this to match your bank or wallet; BudT adjusts the starting balance.' : 'What’s in it today. Optional.'}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <AppText>This balance is owed</AppText>
          <AppText variant="caption">For a credit card, overdraft or loan account.</AppText>
        </View>
        <Switch value={owed} onValueChange={setOwed} trackColor={{ true: t.primary }} />
      </View>
      <View style={{ gap: 8 }}>
        <AppText variant="label">Colour</AppText>
        <ColorPicker value={color} onChange={setColor} />
      </View>
      <Button title={id ? 'Save changes' : 'Add account'} icon="checkmark" onPress={save} />
    </Screen>
  );
}
