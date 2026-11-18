import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { AccountPicker } from '@/components/pickers';
import { AppText, Button, Field, HeaderDeleteButton, Screen } from '@/components/ui';
import { MissingRateError } from '@/db/currency';
import { deleteTransfer, getTransfer, listAccounts, saveTransfer } from '@/db/queries';
import { useQuery } from '@/hooks/useQuery';
import { todayISO } from '@/lib/dates';
import { useConversion } from '@/lib/fx';
import { centsToInput, formatMoney, parseAmount } from '@/lib/money';
import { useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';
import { goBack } from '@/lib/navigation';

/** Moves money between two of the user's own accounts. Not income or spending, except any fee. */
export default function TransferScreen() {
  const params = useLocalSearchParams<{ id?: string; from?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const db = useSQLiteContext();
  const t = useTheme();
  const { currency } = useSettings();

  const [from, setFrom] = useState<number | null>(params.from ? Number(params.from) : null);
  const [to, setTo] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('');
  const [received, setReceived] = useState('');
  const accounts = useQuery('accounts:list', (d) => listAccounts(d));
  const currencyOf = (accountId: number | null) => accounts?.find((a) => a.id === accountId)?.currency || currency;
  const fromCurrency = currencyOf(from);
  const toCurrency = currencyOf(to);
  const crossCurrency = fromCurrency !== toCurrency;
  const conversion = useConversion(fromCurrency, toCurrency);
  const suggested = conversion.rate !== null && parseAmount(amount) ? Math.round((parseAmount(amount) ?? 0) * conversion.rate) : null;
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');

  useEffect(() => {
    if (id) {
      getTransfer(db, id).then((x) => {
        if (!x) return;
        setFrom(x.from_account);
        setTo(x.to_account);
        setAmount(centsToInput(x.amount));
        setFee(x.fee ? centsToInput(x.fee) : '');
        setReceived(x.to_amount !== null ? centsToInput(x.to_amount) : '');
        setDate(x.date);
        setNote(x.note);
      });
      return;
    }
    // Default to the first two accounts so a common transfer is two taps.
    listAccounts(db).then((accounts) => {
      setFrom((f) => f ?? accounts[0]?.id ?? null);
      setTo((current) => current ?? accounts.find((a) => a.id !== (params.from ? Number(params.from) : accounts[0]?.id))?.id ?? null);
    });
  }, [db, id, params.from]);

  const save = async () => {
    const cents = parseAmount(amount);
    const feeCents = fee.trim() ? parseAmount(fee) : 0;
    if (!from || !to) return Alert.alert(tr('Choose both accounts'), tr('Add a second account first if you only have one.'));
    if (from === to) return Alert.alert(tr('Choose two different accounts'));
    if (!cents) return Alert.alert(tr('Enter an amount'), tr('The amount must be greater than zero.'));
    if (feeCents === null) return Alert.alert(tr('Check the fee'));
    // Between currencies, what arrived is what the bank or bureau gave; the official rate is only a suggestion.
    const toAmount = crossCurrency ? (received.trim() ? parseAmount(received) : suggested) : null;
    if (crossCurrency && !toAmount) return Alert.alert(tr('Enter the amount received'), tr('How much arrived in the {0} account?', [toCurrency]));
    try {
      await saveTransfer(db, { id, from_account: from, to_account: to, amount: cents, to_amount: toAmount, fee: feeCents, date, note: note.trim() });
    } catch (e) {
      if (e instanceof MissingRateError) return Alert.alert(tr('No exchange rate yet'), tr('BudT needs the official {0} rate once to record this. Connect to the internet and try again.', [fromCurrency]));
      throw e;
    }
    goBack();
  };

  const remove = () =>
    Alert.alert(tr('Delete transfer?'), tr('Both account balances go back to how they were, and any fee is removed.'), [
      { text: tr('Cancel'), style: 'cancel' },
      {
        text: tr('Delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteTransfer(db, id!);
          goBack();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen
        options={{ title: id ? tr('Edit transfer') : tr('Transfer'), headerRight: id ? () => <HeaderDeleteButton label={tr('Delete transfer')} onPress={remove} /> : undefined }}
      />
      <View style={{ gap: 8 }}>
        <AppText variant="label">{tr('From')}</AppText>
        <AccountPicker
          value={from}
          onChange={(next) => {
            setFrom(next);
            if (next === to) setTo(null);
          }}
        />
      </View>
      <Ionicons name="arrow-down" size={22} color={t.muted} style={{ alignSelf: 'center' }} />
      <View style={{ gap: 8 }}>
        <AppText variant="label">{tr('To')}</AppText>
        <AccountPicker value={to} onChange={setTo} exclude={from} />
      </View>
      <Field label={crossCurrency ? tr('Amount sent') : tr('Amount')} prefix={fromCurrency} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
      {crossCurrency && (
        <Field
          label={tr('Amount received')}
          prefix={toCurrency}
          value={received}
          onChangeText={setReceived}
          keyboardType="decimal-pad"
          placeholder={suggested !== null ? centsToInput(suggested) : '0'}
          hint={
            suggested !== null
              ? tr('About {0} at the official rate. Enter what actually arrived if your bank used a different rate.', [formatMoney(suggested, toCurrency)])
              : tr('Enter what actually arrived in the {0} account.', [toCurrency])
          }
        />
      )}
      <Field
        label={tr('Fee (optional)')}
        prefix={fromCurrency}
        value={fee}
        onChangeText={setFee}
        keyboardType="decimal-pad"
        placeholder="0"
        hint={tr('Bank or mobile-money charges. Recorded as spending under Fees & Charges.')}
      />
      <DateField label={tr('Date')} value={date} onChange={setDate} />
      <Field label={tr('Note')} value={note} onChangeText={setNote} placeholder={tr('e.g. Top up M-Pesa (optional)')} />
      <Button title={id ? tr('Save changes') : tr('Transfer')} icon="swap-horizontal" onPress={save} />
    </Screen>
  );
}
