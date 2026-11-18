import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { AppText, Button, Card, Field, IconBadge, Loading, ProgressBar, Screen, Segmented } from '@/components/ui';
import { contributeToGoal, getGoal } from '@/db/queries';
import { useQuery } from '@/hooks/useQuery';
import { parseAmount } from '@/lib/money';
import { useMoney } from '@/lib/settings';
import { tr } from '@/i18n';
import { goBack } from '@/lib/navigation';

type Mode = 'add' | 'withdraw';

export default function ContributeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { currency, money } = useMoney();
  const goal = useQuery(`goal:${id}`, (d) => getGoal(d, Number(id)));
  const [mode, setMode] = useState<Mode>('add');
  const [amount, setAmount] = useState('');

  if (!goal) return <Loading />;

  const save = async () => {
    const cents = parseAmount(amount);
    if (!cents) return Alert.alert(tr('Enter an amount'), tr('The amount must be greater than zero.'));
    if (mode === 'withdraw' && cents > goal.saved) return Alert.alert(tr('Not enough saved'), tr('You have {0} in this goal.', [money(goal.saved)]));
    await contributeToGoal(db, goal.id, mode === 'add' ? cents : -cents);
    goBack();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: goal.name }} />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <IconBadge icon={goal.icon} color={goal.color} />
          <View style={{ flex: 1 }}>
            <AppText weight="700">{tr('{0} saved', [money(goal.saved)])}</AppText>
            <AppText variant="caption">{tr('of {0} target', [money(goal.target)])}</AppText>
          </View>
        </View>
        <ProgressBar progress={goal.saved / goal.target} color={goal.color} />
      </Card>
      <Segmented<Mode>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'add', label: tr('Add money') },
          { value: 'withdraw', label: tr('Withdraw') },
        ]}
      />
      <Field label={tr('Amount')} prefix={currency} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" autoFocus />
      <Button title={mode === 'add' ? tr('Add to goal') : tr('Withdraw from goal')} icon="checkmark" onPress={save} />
    </Screen>
  );
}
