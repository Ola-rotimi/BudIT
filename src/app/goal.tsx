import { Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Switch, View } from 'react-native';
import { DateField } from '@/components/DateField';
import { ColorPicker, IconPicker } from '@/components/pickers';
import { AppText, Button, Field, HeaderDeleteButton, Screen } from '@/components/ui';
import { deleteGoal, getGoal, saveGoal } from '@/db/queries';
import type { IconName } from '@/db/types';
import { addDays, toISODate } from '@/lib/dates';
import { centsToInput, parseAmount } from '@/lib/money';
import { useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { ProScreen } from '@/components/ProLock';
import { LIMIT_COPY, useFreeLimit } from '@/lib/limits';
import { tr } from '@/i18n';
import { goBack } from '@/lib/navigation';

export default function GoalScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : undefined;
  const db = useSQLiteContext();
  const { canAdd } = useFreeLimit('goals');
  const t = useTheme();
  const { currency } = useSettings();

  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [saved, setSaved] = useState('');
  const [deadline, setDeadline] = useState<string | null>(null);
  const [icon, setIcon] = useState<IconName>('flag');
  const [color, setColor] = useState('#10B981');

  useEffect(() => {
    if (!id) return;
    getGoal(db, id).then((g) => {
      if (!g) return;
      setName(g.name);
      setTarget(centsToInput(g.target));
      setSaved(centsToInput(g.saved));
      setDeadline(g.deadline);
      setIcon(g.icon);
      setColor(g.color);
    });
  }, [db, id]);

  const save = async () => {
    const targetCents = parseAmount(target);
    const savedCents = saved.trim() ? parseAmount(saved) : 0;
    if (!name.trim()) return Alert.alert(tr('Give your goal a name'));
    if (!targetCents) return Alert.alert(tr('Enter a target amount'), tr('The target must be greater than zero.'));
    if (savedCents === null) return Alert.alert(tr('Check the amount already saved'));
    await saveGoal(db, { id, name: name.trim(), target: targetCents, saved: savedCents, deadline, icon, color });
    goBack();
  };

  const remove = () =>
    Alert.alert(tr('Delete goal?'), tr('“{0}” and its progress will be removed.', [name]), [
      { text: tr('Cancel'), style: 'cancel' },
      {
        text: tr('Delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteGoal(db, id!);
          goBack();
        },
      },
    ]);

  if (!id && canAdd === false) return <ProScreen screenTitle={tr('Savings goals')} title={tr(LIMIT_COPY.goals.title)} message={tr(LIMIT_COPY.goals.message)} />;
  return (
    <Screen>
      <Stack.Screen options={{ title: id ? tr('Edit goal') : tr('New goal'), headerRight: id ? () => <HeaderDeleteButton label={tr('Delete goal')} onPress={remove} /> : undefined }} />
      <Field label={tr('Name')} value={name} onChangeText={setName} placeholder={tr('e.g. Emergency fund')} autoFocus={!id} />
      <Field label={tr('Target')} prefix={currency} value={target} onChangeText={setTarget} keyboardType="decimal-pad" placeholder="0.00" />
      <Field label={tr('Already saved')} prefix={currency} value={saved} onChangeText={setSaved} keyboardType="decimal-pad" placeholder="0.00" />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText weight="600">{tr('Target date')}</AppText>
        <Switch
          value={deadline !== null}
          onValueChange={(on) => setDeadline(on ? toISODate(addDays(new Date(), 365)) : null)}
          trackColor={{ true: t.primary }}
        />
      </View>
      {deadline !== null && <DateField label={tr('Reach by')} value={deadline} onChange={setDeadline} minimumDate={new Date()} />}

      <IconPicker value={icon} color={color} onChange={setIcon} />
      <ColorPicker value={color} onChange={setColor} />

      <Button title={id ? tr('Save changes') : tr('Create goal')} icon="checkmark" onPress={save} />
    </Screen>
  );
}
