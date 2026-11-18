import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Switch, Text, View } from 'react-native';
import { ColorPicker } from '@/components/pickers';
import { AppText, Button, Field, HeaderDeleteButton, Screen, Segmented } from '@/components/ui';
import { accountHasActivity, getAccount, removeAccount, saveAccount } from '@/db/queries';
import type { AccountKind } from '@/db/types';
import { ACCOUNT_KINDS } from '@/lib/accounts';
import { FX_CURRENCIES } from '@/lib/fx';
import { centsToInput, CURRENCIES, parseAmount } from '@/lib/money';
import { useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';
import { goBack } from '@/lib/navigation';

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
  const [accountCurrency, setAccountCurrency] = useState(currency);
  const [pickCurrency, setPickCurrency] = useState(false);
  // Once money has moved through an account its currency is fixed, so past amounts keep their meaning.
  const [currencyLocked, setCurrencyLocked] = useState(false);

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
      setAccountCurrency(a.currency ?? currency);
    });
    accountHasActivity(db, id).then(setCurrencyLocked);
  }, [db, id, currency]);

  const save = async () => {
    if (!name.trim()) return Alert.alert(tr('Give the account a name'));
    const cents = balance.trim() ? parseAmount(balance) : 0;
    if (cents === null) return Alert.alert(tr('Check the balance'));
    const signed = owed ? -cents : cents;
    // For an existing account the balance entered is "what it is now": shift the opening balance by the difference.
    const opening = original ? original.opening + (signed - original.balance) : signed;
    await saveAccount(db, { id, name: name.trim(), kind, icon: ACCOUNT_KINDS[kind].icon, color, opening_balance: opening, currency: accountCurrency });
    goBack();
  };

  const remove = () =>
    Alert.alert(tr('Remove account?'), tr('If it has transactions it will be archived, so your history and totals stay correct.'), [
      { text: tr('Cancel'), style: 'cancel' },
      {
        text: tr('Remove'),
        style: 'destructive',
        onPress: async () => {
          if (!(await removeAccount(db, id!))) return Alert.alert(tr('Keep at least one account'), tr('BudT needs one active account for your transactions.'));
          goBack();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: id ? tr('Edit account') : tr('New account'),
          headerRight: id ? () => <HeaderDeleteButton label={tr('Remove account')} icon="archive-outline" onPress={remove} /> : undefined,
        }}
      />
      <View style={{ gap: 8 }}>
        <AppText variant="label">{tr('Type')}</AppText>
        <Segmented<AccountKind>
          value={kind}
          onChange={setKind}
          options={(Object.keys(ACCOUNT_KINDS) as AccountKind[]).map((k) => ({ value: k, label: tr(ACCOUNT_KINDS[k].label) }))}
        />
        <AppText variant="caption">{tr(ACCOUNT_KINDS[kind].example)}</AppText>
      </View>
      <Field label={tr('Name')} value={name} onChangeText={setName} placeholder={kind === 'mobile' ? tr('e.g. M-Pesa') : kind === 'cash' ? tr('e.g. Wallet') : tr('e.g. GTBank salary')} />
      <View style={{ gap: 8 }}>
        <AppText variant="label">{tr('Currency')}</AppText>
        <Pressable
          onPress={() => !currencyLocked && setPickCurrency((p) => !p)}
          disabled={currencyLocked}
          accessibilityRole="button"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}>
          <Text style={{ fontSize: 22 }}>{FX_CURRENCIES[accountCurrency]?.flag ?? '💱'}</Text>
          <View style={{ flex: 1 }}>
            <AppText weight="700">
              {accountCurrency} · {FX_CURRENCIES[accountCurrency]?.name ?? accountCurrency}
            </AppText>
            <AppText variant="caption">
              {currencyLocked
                ? tr('Can’t be changed once the account has transactions.')
                : accountCurrency === currency
                  ? tr('Your home currency. Tap to choose another, e.g. for a USD domiciliary account.')
                  : tr('Totals and budgets convert it to {0} at the official rate.', [currency])}
            </AppText>
          </View>
        </Pressable>
        {pickCurrency && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {CURRENCIES.map((code) => {
              const active = code === accountCurrency;
              return (
                <Pressable
                  key={code}
                  onPress={() => {
                    setAccountCurrency(code);
                    setPickCurrency(false);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={{
                    width: 64,
                    minHeight: 40,
                    borderRadius: 10,
                    borderWidth: 1.5,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderColor: active ? t.primary : t.border,
                    backgroundColor: active ? t.primarySoft : t.inputBg,
                  }}>
                  <Text style={{ color: active ? t.primary : t.text, fontWeight: '700' }}>{code}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>
      <Field
        label={id ? tr('Balance now') : tr('Current balance')}
        prefix={accountCurrency}
        value={balance}
        onChangeText={setBalance}
        keyboardType="decimal-pad"
        placeholder="0"
        hint={id ? tr('Change this to match your bank or wallet; BudT adjusts the starting balance.') : tr('What’s in it today. Optional.')}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <AppText>{tr('This balance is owed')}</AppText>
          <AppText variant="caption">{tr('For a credit card, overdraft or loan account.')}</AppText>
        </View>
        <Switch value={owed} onValueChange={setOwed} trackColor={{ true: t.primary }} />
      </View>
      <View style={{ gap: 8 }}>
        <AppText variant="label">{tr('Colour')}</AppText>
        <ColorPicker value={color} onChange={setColor} />
      </View>
      <Button title={id ? tr('Save changes') : tr('Add account')} icon="checkmark" onPress={save} />
    </Screen>
  );
}
