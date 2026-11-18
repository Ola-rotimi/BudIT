import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
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
import { tr } from '@/i18n';
import { goBack } from '@/lib/navigation';

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

  if (canAdd === false) return <ProScreen screenTitle={tr('New savings group')} title={tr(LIMIT_COPY.groups.title)} message={tr(LIMIT_COPY.groups.message)} />;

  const cents = parseAmount(contribution) ?? 0;
  const myTurn = Math.min(turn, members);

  const save = async () => {
    if (!name.trim()) return Alert.alert(tr('Give the group a name'), tr('e.g. “Market women ajo” or “Office chama”.'));
    if (!cents) return Alert.alert(tr('Enter the contribution'), tr('How much each member pays every cycle.'));
    if (!accountId) return Alert.alert(tr('Choose an account'));
    await createGroup(db, { name: name.trim(), contribution: cents, frequency, start_date: start, members, my_turn: myTurn, account_id: accountId });
    goBack();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('New savings group') }} />
      <AppText variant="caption">{tr('Each cycle every member pays in, and one member collects the whole pot. BudT tracks your contributions, your turn and your payout.')}</AppText>
      <Field label={tr('Group name')} value={name} onChangeText={setName} placeholder={tr('e.g. Market women ajo')} />
      <Field label={tr('Contribution per cycle')} prefix={currency} value={contribution} onChangeText={setContribution} keyboardType="decimal-pad" placeholder="0" />
      <View style={{ gap: 8 }}>
        <AppText variant="label">{tr('How often')}</AppText>
        <Segmented<Frequency>
          value={frequency}
          onChange={setFrequency}
          options={[
            { value: 'weekly', label: tr('Weekly') },
            { value: 'monthly', label: tr('Monthly') },
          ]}
        />
      </View>
      <DateField label={tr('First contribution date')} value={start} onChange={setStart} />
      <Stepper label={tr('Number of members')} value={members} min={2} max={60} onChange={setMembers} />
      <Stepper label={tr('Your turn to collect')} value={myTurn} min={1} max={members} onChange={setTurn} suffix={`of ${members}`} />
      <View style={{ gap: 8 }}>
        <AppText variant="label">{tr('Pay in from / receive into')}</AppText>
        <AccountPicker value={accountId} onChange={setAccountId} />
      </View>
      {cents > 0 && (
        <Card>
          <AppText weight="700">{tr('You’ll collect {0} on {1}', [money(cents * members), shortDate(cycleDate({ start_date: start, frequency }, myTurn))])}</AppText>
          <AppText variant="caption">{tr('{0} × {1}. You pay {2} {3} for {4} cycles.', [members, money(cents), money(cents), frequency === 'weekly' ? tr('every week') : tr('every month'), members])}</AppText>
        </Card>
      )}
      <Button title={tr('Create group')} icon="people" onPress={save} />
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
        accessibilityLabel={delta < 0 ? tr('Decrease {0}', [label]) : tr('Increase {0}', [label])}
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
