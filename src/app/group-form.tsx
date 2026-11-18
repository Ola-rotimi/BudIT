import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { ProScreen } from '@/components/ProLock';
import { AccountPicker } from '@/components/pickers';
import { AppText, Button, Card, Field, Screen, Segmented } from '@/components/ui';
import { createGroup, defaultAccountId } from '@/db/queries';
import { shortDate, todayISO } from '@/lib/dates';
import { LIMIT_COPY, useFreeLimit } from '@/lib/limits';
import { parseAmount } from '@/lib/money';
import { cycleDate } from '@/lib/savingsGroups';
import { useMoney, useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';

type Frequency = 'weekly' | 'monthly';

/** Set up an ajo / esusu / susu / chama / stokvel the user belongs to. */
export default function GroupFormScreen() {
  const db = useSQLiteContext();
  const { currency } = useSettings();
  const { money } = useMoney();
  const [name, setName] = useState('');
  const [contribution, setContribution] = useState('');
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [start, setStart] = useState(todayISO());
  const [members, setMembers] = useState(10);
  const [turn, setTurn] = useState(1);
  const [accountId, setAccountId] = useState<number | null>(null);
  const { canAdd } = useFreeLimit('groups');

  useEffect(() => {
    defaultAccountId(db).then((id) => setAccountId((current) => current ?? id));
  }, [db]);

  if (canAdd === false) return <ProScreen screenTitle="New savings group" title={LIMIT_COPY.groups.title} message={LIMIT_COPY.groups.message} />;

  const cents = parseAmount(contribution) ?? 0;
  const myTurn = Math.min(turn, members);

  const save = async () => {
    if (!name.trim()) return Alert.alert('Give the group a name', 'e.g. “Market women ajo” or “Office chama”.');
    if (!cents) return Alert.alert('Enter the contribution', 'How much each member pays every cycle.');
    if (!accountId) return Alert.alert('Choose an account');
    await createGroup(db, { name: name.trim(), contribution: cents, frequency, start_date: start, members, my_turn: myTurn, account_id: accountId });
    router.back();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: 'New savings group' }} />
      <AppText variant="caption">
        Each cycle every member pays in, and one member collects the whole pot. BudT tracks your contributions, your turn and your payout.
      </AppText>
      <Field label="Group name" value={name} onChangeText={setName} placeholder="e.g. Market women ajo" />
      <Field label="Contribution per cycle" prefix={currency} value={contribution} onChangeText={setContribution} keyboardType="decimal-pad" placeholder="0" />
      <View style={{ gap: 8 }}>
        <AppText variant="label">How often</AppText>
        <Segmented<Frequency>
          value={frequency}
          onChange={setFrequency}
          options={[
            { value: 'weekly', label: 'Weekly' },
            { value: 'monthly', label: 'Monthly' },
          ]}
        />
      </View>
      <DateField label="First contribution date" value={start} onChange={setStart} />
      <Stepper label="Number of members" value={members} min={2} max={60} onChange={setMembers} />
      <Stepper label="Your turn to collect" value={myTurn} min={1} max={members} onChange={setTurn} suffix={`of ${members}`} />
      <View style={{ gap: 8 }}>
        <AppText variant="label">Pay in from / receive into</AppText>
        <AccountPicker value={accountId} onChange={setAccountId} />
      </View>
      {cents > 0 && (
        <Card>
          <AppText weight="700">
            You’ll collect {money(cents * members)} on {shortDate(cycleDate({ start_date: start, frequency }, myTurn))}
          </AppText>
          <AppText variant="caption">
            {members} × {money(cents)}. You pay {money(cents)} {frequency === 'weekly' ? 'every week' : 'every month'} for {members} cycles.
          </AppText>
        </Card>
      )}
      <Button title="Create group" icon="people" onPress={save} />
    </Screen>
  );
}

function Stepper({ label, value, min, max, onChange, suffix }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void; suffix?: string }) {
  const t = useTheme();
  const btn = (delta: number, icon: 'remove' | 'add') => {
    const disabled = delta < 0 ? value <= min : value >= max;
    return (
      <Pressable
        onPress={() => onChange(Math.min(max, Math.max(min, value + delta)))}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${delta < 0 ? 'Decrease' : 'Increase'} ${label}`}
        hitSlop={8}
        style={[styles.step, { borderColor: t.border, opacity: disabled ? 0.4 : 1 }]}>
        <Ionicons name={icon} size={20} color={t.primary} />
      </Pressable>
    );
  };
  return (
    <View style={styles.row}>
      <AppText style={{ flex: 1 }}>{label}</AppText>
      {btn(-1, 'remove')}
      <AppText weight="700" style={{ minWidth: 64, textAlign: 'center' }}>
        {value} {suffix ?? ''}
      </AppText>
      {btn(1, 'add')}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
