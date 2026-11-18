import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { dailySpending, listChallenges, spendDays } from '@/db/planning';
import { useQuery } from '@/hooks/useQuery';
import { tr } from '@/i18n';
import { challengeProgress, noSpendStreak } from '@/lib/challenges';
import { todayISO } from '@/lib/dates';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { AppText, Card, IconBadge, ProgressBar } from './ui';

/** Home card for the challenge in progress (if any), with the no-spend streak. */
export function ChallengeCard() {
  const t = useTheme();
  const { money } = useMoney();
  const today = todayISO();
  const data = useQuery(`home:challenge:${today}`, async (db) => {
    const current = (await listChallenges(db)).find((c) => c.start_date <= today && c.end_date >= today);
    if (!current) return null;
    const [daily, spent] = await Promise.all([dailySpending(db, current.start_date, current.end_date, current.category_id), spendDays(db, today)]);
    return { current, progress: challengeProgress(current, daily, today), streak: noSpendStreak(spent, today) };
  });
  if (!data) return null;
  const { current, progress, streak } = data;
  const lost = progress.status === 'lost';
  const ratio = current.kind === 'no_spend' ? progress.elapsed / progress.totalDays : progress.limit ? progress.spent / progress.limit : 0;
  const color = lost ? t.expense : !progress.onPace ? t.warning : t.income;

  return (
    <Card onPress={() => router.push('/challenges')} style={{ gap: 8 }}>
      <View style={styles.row}>
        <IconBadge icon="trophy-outline" color={color} size={36} />
        <View style={{ flex: 1 }}>
          <AppText weight="700">
            {current.kind === 'no_spend'
              ? tr('No-spend challenge')
              : current.kind === 'category_cap'
                ? tr('{0} cap', [tr(current.category_name ?? '')])
                : tr('Spending cap')}
          </AppText>
          <AppText variant="caption">
            {lost
              ? tr('Challenge missed. Start another when you’re ready.')
              : current.kind === 'no_spend'
                ? tr('{0} of {1} days without spending', [progress.clearDays, progress.totalDays])
                : tr('{0} of {1} used · {2} days left', [money(progress.spent), money(progress.limit), progress.daysLeft])}
          </AppText>
        </View>
        {streak > 1 && (
          <View style={[styles.streak, { backgroundColor: t.primarySoft }]}>
            <Ionicons name="flame" size={14} color={t.accent} />
            <AppText variant="caption" weight="700" color={t.text}>
              {streak}
            </AppText>
          </View>
        )}
      </View>
      <ProgressBar progress={Math.min(1, ratio)} color={color} />
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  streak: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
});
