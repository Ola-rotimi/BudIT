import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { CategoryPicker } from '@/components/pickers';
import { AppText, Button, Field, Screen, Segmented } from '@/components/ui';
import { saveChallenge } from '@/db/planning';
import type { ChallengeKind } from '@/db/types';
import { tr } from '@/i18n';
import { CHALLENGE_PRESETS } from '@/lib/challenges';
import { addDays, shortDate, todayISO, toISODate } from '@/lib/dates';
import { parseAmount } from '@/lib/money';
import { goBack } from '@/lib/navigation';
import { useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';

const LENGTHS = ['3', '7', '14', '30'] as const;

/** Starts a spending challenge from today. */
export default function ChallengeScreen() {
  const db = useSQLiteContext();
  const t = useTheme();
  const { currency } = useSettings();
  const [preset, setPreset] = useState(0);
  const [kind, setKind] = useState<ChallengeKind>(CHALLENGE_PRESETS[0].kind);
  const [days, setDays] = useState<(typeof LENGTHS)[number]>('7');
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);

  const today = todayISO();
  const end = toISODate(addDays(new Date(), Number(days) - 1));

  const choose = (i: number) => {
    setPreset(i);
    setKind(CHALLENGE_PRESETS[i].kind);
    setDays(String(CHALLENGE_PRESETS[i].days) as (typeof LENGTHS)[number]);
  };

  const save = async () => {
    const cents = kind === 'no_spend' ? null : parseAmount(amount);
    if (kind !== 'no_spend' && !cents) return Alert.alert(tr('Set a limit'), tr('How much can you spend in total during the challenge?'));
    if (kind === 'category_cap' && !categoryId) return Alert.alert(tr('Pick a category'));
    await saveChallenge(db, { kind, category_id: kind === 'category_cap' ? categoryId : null, amount: cents, start_date: today, end_date: end });
    goBack();
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Start a challenge') }} />
      <View style={{ gap: 10 }}>
        {CHALLENGE_PRESETS.map((p, i) => {
          const active = i === preset;
          return (
            <Pressable
              key={p.title}
              onPress={() => choose(i)}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              style={[styles.option, { borderColor: active ? t.primary : t.border, backgroundColor: active ? t.primarySoft : t.card }]}>
              <AppText weight="700">{tr(p.title)}</AppText>
              <AppText variant="caption">{tr(p.description)}</AppText>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: 8 }}>
        <AppText variant="label">{tr('Length')}</AppText>
        <Segmented value={days} onChange={setDays} options={LENGTHS.map((d) => ({ value: d, label: tr('{0} days', [d]) }))} />
        <AppText variant="caption">{tr('From today to {0}.', [shortDate(end)])}</AppText>
      </View>

      {kind === 'category_cap' && (
        <View style={{ gap: 8 }}>
          <AppText variant="label">{tr('Category')}</AppText>
          <CategoryPicker type="expense" value={categoryId} onChange={setCategoryId} />
        </View>
      )}
      {kind !== 'no_spend' && (
        <Field
          label={tr('Spending limit for the whole challenge')}
          prefix={currency}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0"
          hint={tr('Bills and recurring payments added automatically don’t count.')}
        />
      )}

      <Button title={tr('Start challenge')} icon="trophy-outline" onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  option: { borderWidth: 1.5, borderRadius: 14, padding: 14, gap: 4 },
});
