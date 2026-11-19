import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { AccountPicker, CategoryPicker } from '@/components/pickers';
import { AppText, Button, Card, Field, HeaderDeleteButton, Screen, Segmented, StatLine } from '@/components/ui';
import { MissingRateError } from '@/db/currency';
import { deleteIou, getIou, recordRepayment, saveIou, splitBill, type IouRow } from '@/db/planning';
import { defaultAccountId } from '@/db/queries';
import type { IouDirection } from '@/db/types';
import { tr } from '@/i18n';
import { addDays, fromISODate, todayISO, toISODate } from '@/lib/dates';
import { centsToInput, parseAmount } from '@/lib/money';
import { goBack } from '@/lib/navigation';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';

type Mode = 'lend' | 'borrow' | 'split';

/** Add an IOU, split a bill, or (with `id`) record a repayment and edit an existing IOU. */
export default function IouScreen() {
  const params = useLocalSearchParams<{ id?: string; mode?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const db = useSQLiteContext();
  const t = useTheme();
  const { money, currency } = useMoney();

  const [mode, setMode] = useState<Mode>(params.mode === 'borrow' ? 'borrow' : params.mode === 'split' ? 'split' : 'lend');
  const [existing, setExisting] = useState<IouRow | null>(null);
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(todayISO());
  const [hasDue, setHasDue] = useState(false);
  const [due, setDue] = useState(toISODate(addDays(new Date(), 14)));
  // Split
  const [people, setPeople] = useState('');
  const [includeMe, setIncludeMe] = useState(true);
  const [paidFromAccount, setPaidFromAccount] = useState(true);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  // Repayment
  const [repay, setRepay] = useState('');
  const [recordInAccount, setRecordInAccount] = useState(true);
  const [accountId, setAccountId] = useState<number | null>(null);

  useEffect(() => {
    defaultAccountId(db).then((a) => setAccountId((current) => current ?? a));
    if (!id) return;
    getIou(db, id).then((o) => {
      if (!o) return;
      setExisting(o);
      setMode(o.direction === 'owed_to_me' ? 'lend' : 'borrow');
      setPerson(o.person);
      setAmount(centsToInput(o.amount));
      setNote(o.note);
      setDate(o.date);
      setHasDue(!!o.due_date);
      if (o.due_date) setDue(o.due_date);
      setRepay(centsToInput(o.outstanding));
    });
  }, [db, id]);

  const names = people
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const total = parseAmount(amount) ?? 0;
  const heads = names.length + (includeMe ? 1 : 0);
  const share = heads ? Math.floor(total / heads) : 0;

  const save = async () => {
    const cents = parseAmount(amount);
    if (!cents) return Alert.alert(tr('Enter an amount'), tr('The amount must be greater than zero.'));
    if (mode === 'split') {
      if (!names.length) return Alert.alert(tr('Who are you splitting with?'), tr('Enter their names, separated by commas.'));
      if (paidFromAccount && !categoryId) return Alert.alert(tr('Pick a category'));
      try {
        await splitBill(db, { total: cents, people: names, includeMe, note: note.trim(), date, accountId: paidFromAccount ? accountId : null, categoryId });
      } catch (e) {
        if (e instanceof MissingRateError) return Alert.alert(tr('No exchange rate yet'), tr('Connect to the internet once so BudIT can get the official rate, then try again.'));
        throw e;
      }
      return goBack();
    }
    if (!person.trim()) return Alert.alert(tr('Who is it with?'), tr('Enter the person’s name.'));
    if (existing && cents < existing.repaid) return Alert.alert(tr('Check the amount'), tr('{0} has already been repaid.', [money(existing.repaid)]));
    const direction: IouDirection = mode === 'lend' ? 'owed_to_me' : 'i_owe';
    await saveIou(db, { id, person: person.trim(), direction, amount: cents, note: note.trim(), date, due_date: hasDue ? due : null });
    goBack();
  };

  const recordPayment = async () => {
    if (!existing) return;
    const cents = parseAmount(repay);
    if (!cents) return Alert.alert(tr('Enter an amount'), tr('The amount must be greater than zero.'));
    try {
      await recordRepayment(db, existing, cents, recordInAccount ? accountId : null);
    } catch (e) {
      if (e instanceof MissingRateError) return Alert.alert(tr('No exchange rate yet'), tr('Connect to the internet once so BudIT can get the official rate, then try again.'));
      throw e;
    }
    goBack();
  };

  const remove = () =>
    Alert.alert(tr('Delete this IOU?'), tr('Repayments already recorded in your accounts stay there.'), [
      { text: tr('Cancel'), style: 'cancel' },
      {
        text: tr('Delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteIou(db, id!);
          goBack();
        },
      },
    ]);

  const owedToMe = mode === 'lend';
  const title = id ? tr('IOU') : mode === 'split' ? tr('Split a bill') : owedToMe ? tr('Money you lent') : tr('Money you borrowed');

  return (
    <Screen>
      <Stack.Screen options={{ title, headerRight: id ? () => <HeaderDeleteButton label={tr('Delete IOU')} onPress={remove} /> : undefined }} />

      {existing && existing.outstanding > 0 && (
        <Card>
          <AppText variant="heading">{owedToMe ? tr('{0} paid you back', [existing.person]) : tr('You paid {0} back', [existing.person])}</AppText>
          <StatLine label={tr('Still outstanding')} value={money(existing.outstanding)} bold />
          <Field label={tr('Amount repaid')} prefix={currency} value={repay} onChangeText={setRepay} keyboardType="decimal-pad" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <AppText>{owedToMe ? tr('Add it to an account') : tr('Take it from an account')}</AppText>
              <AppText variant="caption">{owedToMe ? tr('Recorded as income, so your balance stays right.') : tr('Recorded as spending, so your balance stays right.')}</AppText>
            </View>
            <Switch value={recordInAccount} onValueChange={setRecordInAccount} trackColor={{ true: t.primary }} />
          </View>
          {recordInAccount && <AccountPicker value={accountId} onChange={setAccountId} />}
          <Button title={tr('Record repayment')} icon="checkmark-done" onPress={recordPayment} />
        </Card>
      )}
      {existing && existing.outstanding <= 0 && (
        <Card>
          <AppText weight="700" color={t.income}>
            {tr('Settled in full')}
          </AppText>
        </Card>
      )}

      {!id && (
        <Segmented<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'lend', label: tr('I lent') },
            { value: 'borrow', label: tr('I borrowed') },
            { value: 'split', label: tr('Split') },
          ]}
        />
      )}

      {mode === 'split' ? (
        <>
          <Field label={tr('Total bill')} prefix={currency} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
          <Field
            label={tr('Split with')}
            value={people}
            onChangeText={setPeople}
            placeholder={tr('e.g. Ada, Tunde, Wanjiru')}
            hint={tr('Names separated by commas. Each person gets an IOU for their share.')}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <AppText style={{ flex: 1 }}>{tr('Include my own share')}</AppText>
            <Switch value={includeMe} onValueChange={setIncludeMe} trackColor={{ true: t.primary }} />
          </View>
          {total > 0 && heads > 0 && (
            <Card>
              <StatLine label={tr('Each share')} value={money(share)} bold />
              <AppText variant="caption">
                {tr('{0} people owe you {1} in total.', [names.length, money(share * names.length)])}
              </AppText>
            </Card>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <AppText>{tr('I paid the whole bill')}</AppText>
              <AppText variant="caption">{tr('Records the full bill as spending from your account. Repayments then come back in as income.')}</AppText>
            </View>
            <Switch value={paidFromAccount} onValueChange={setPaidFromAccount} trackColor={{ true: t.primary }} />
          </View>
          {paidFromAccount && (
            <>
              <AccountPicker value={accountId} onChange={setAccountId} />
              <CategoryPicker type="expense" value={categoryId} onChange={setCategoryId} />
            </>
          )}
          <Field label={tr('What was it for?')} value={note} onChangeText={setNote} placeholder={tr('e.g. Dinner at Mama Put')} />
          <DateField label={tr('Date')} value={date} onChange={setDate} />
          <Button title={tr('Split the bill')} icon="people" onPress={save} />
        </>
      ) : (
        <>
          {id && (
            <Segmented<Mode>
              value={mode}
              onChange={setMode}
              options={[
                { value: 'lend', label: tr('They owe me') },
                { value: 'borrow', label: tr('I owe them') },
              ]}
            />
          )}
          <Field label={owedToMe ? tr('Who owes you?') : tr('Who do you owe?')} value={person} onChangeText={setPerson} placeholder={tr('Name')} />
          <Field label={tr('Amount')} prefix={currency} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0" />
          <Field label={tr('Note')} value={note} onChangeText={setNote} placeholder={tr('What was it for? (optional)')} />
          <DateField label={tr('Date')} value={date} onChange={setDate} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <AppText style={{ flex: 1 }}>{tr('Set a date to pay back by')}</AppText>
            <Switch value={hasDue} onValueChange={setHasDue} trackColor={{ true: t.primary }} />
          </View>
          {hasDue && <DateField label={tr('Pay back by')} value={due} onChange={setDue} minimumDate={fromISODate(date)} />}
          <Button title={id ? tr('Save changes') : tr('Save IOU')} icon="checkmark" onPress={save} />
        </>
      )}
    </Screen>
  );
}
