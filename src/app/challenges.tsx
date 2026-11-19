import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, StyleSheet, View } from 'react-native';
import { LimitNote } from '@/components/ProLock';
import { AppText, Button, Card, EmptyState, HeaderButton, Loading, ProgressBar, Screen } from '@/components/ui';
import { dailySpending, listChallenges, removeChallenge, spendDays } from '@/db/planning';
import { useQuery } from '@/hooks/useQuery';
import { tr } from '@/i18n';
import { challengeProgress, noSpendStreak, type ChallengeProgress } from '@/lib/challenges';
import { fromISODate, shortDate, todayISO } from '@/lib/dates';
import { useFreeLimit } from '@/lib/limits';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';

/** Spending challenges in progress and finished, with the no-spend streak. */
export default function ChallengesScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { money } = useMoney();
  const today = todayISO();
  const limit = useFreeLimit('challenges');
  const data = useQuery(`challenges:${today}`, async (d) => {
    const [list, spent] = await Promise.all([listChallenges(d), spendDays(d, today)]);
    const withProgress = await Promise.all(
      list.map(async (c) => ({ c, p: challengeProgress(c, await dailySpending(d, c.start_date, c.end_date, c.category_id), today) })),
    );
    return { items: withProgress, streak: spent.size ? noSpendStreak(spent, today) : 0 };
  });

  if (!data) return <Loading />;
  const current = data.items.filter((i) => i.c.end_date >= today);
  const past = data.items.filter((i) => i.c.end_date < today);
  const start = () => limit.add('/challenge');

  const remove = (id: number) =>
    Alert.alert(tr('Remove this challenge?'), tr('Your transactions aren’t affected.'), [
      { text: tr('Cancel'), style: 'cancel' },
      { text: tr('Remove'), style: 'destructive', onPress: () => removeChallenge(db, id) },
    ]);

  const titleOf = (c: (typeof data.items)[number]['c']) =>
    c.kind === 'no_spend' ? tr('No-spend challenge') : c.kind === 'category_cap' ? tr('{0} cap', [tr(c.category_name ?? '')]) : tr('Spending cap');

  return (
    <Screen>
      <Stack.Screen options={{ title: tr('Challenges'), headerRight: () => <HeaderButton icon="add" label={tr('Start a challenge')} onPress={start} /> }} />

      <Card style={styles.streakCard}>
        <Ionicons name="flame" size={32} color={data.streak > 0 ? t.accent : t.muted} />
        <View style={{ flex: 1 }}>
          <AppText variant="title">{tr('{0}-day streak', [data.streak])}</AppText>
          <AppText variant="caption">
            {data.streak > 0
              ? tr('Days in a row without spending, apart from bills and recurring payments.')
              : tr('Go a day without spending (bills and recurring payments don’t count) to start a streak.')}
          </AppText>
        </View>
      </Card>

      {current.length === 0 ? (
        <Card>
          <EmptyState
            icon="trophy-outline"
            title={tr('No challenge running')}
            message={tr('A short challenge, like a no-spend week, is an easy way to break spending habits.')}
            action={{ label: tr('Start a challenge'), onPress: start }}
          />
        </Card>
      ) : (
        current.map(({ c, p }) => (
          <Card key={c.id} style={{ gap: 10 }}>
            <View style={styles.head}>
              <View style={{ flex: 1 }}>
                <AppText weight="700">{titleOf(c)}</AppText>
                <AppText variant="caption">{tr('{0} – {1} · {2} days left', [shortDate(c.start_date), shortDate(c.end_date), p.daysLeft])}</AppText>
              </View>
              <StatusPill p={p} />
            </View>
            {c.kind === 'no_spend' ? (
              <>
                <DayDots p={p} />
                <AppText variant="caption">{tr('{0} of {1} days without spending', [p.clearDays, p.totalDays])}</AppText>
              </>
            ) : (
              <>
                <ProgressBar progress={Math.min(1, p.limit ? p.spent / p.limit : 0)} color={p.status === 'lost' ? t.expense : p.onPace ? t.income : t.warning} height={10} />
                <AppText variant="caption">
                  {p.status === 'lost'
                    ? tr('{0} spent, over the {1} limit.', [money(p.spent), money(p.limit)])
                    : tr('{0} of {1} spent. {2} left to stay under.', [money(p.spent), money(p.limit), money(Math.max(0, p.limit - p.spent))])}
                </AppText>
              </>
            )}
            <Button title={tr('Remove')} variant="ghost" icon="close" onPress={() => remove(c.id)} />
          </Card>
        ))
      )}

      {current.length > 0 && <Button title={tr('Start another challenge')} icon="add" variant="secondary" onPress={start} />}
      {!limit.isPro && limit.used !== undefined && <LimitNote feature="challenges" used={limit.used} />}

      {past.length > 0 && (
        <Card style={{ gap: 8 }}>
          <AppText variant="heading">{tr('Finished')}</AppText>
          {past.slice(0, 10).map(({ c, p }) => (
            <View key={c.id} style={styles.head}>
              <Ionicons name={p.status === 'won' ? 'trophy' : 'close-circle-outline'} size={20} color={p.status === 'won' ? t.accent : t.muted} />
              <View style={{ flex: 1 }}>
                <AppText>{titleOf(c)}</AppText>
                <AppText variant="caption">
                  {shortDate(c.start_date)} · {c.kind === 'no_spend' ? tr('{0} of {1} days without spending', [p.clearDays, p.totalDays]) : tr('{0} of {1} spent', [money(p.spent), money(p.limit)])}
                </AppText>
              </View>
            </View>
          ))}
        </Card>
      )}
    </Screen>
  );
}

function StatusPill({ p }: { p: ChallengeProgress }) {
  const t = useTheme();
  const [label, color] =
    p.status === 'lost' ? [tr('Missed'), t.expense] : p.status === 'won' ? [tr('Done!'), t.income] : p.onPace ? [tr('On track'), t.income] : [tr('Careful'), t.warning];
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <AppText variant="caption" weight="700" color={color}>
        {label}
      </AppText>
    </View>
  );
}

/** One dot per day: green without spending, red with, grey still to come. */
function DayDots({ p }: { p: ChallengeProgress }) {
  const t = useTheme();
  return (
    <View style={styles.dots}>
      {p.days.map((d) => (
        <View
          key={d.date}
          accessibilityLabel={`${shortDate(d.date)}: ${d.state === 'clear' ? tr('no spending') : d.state === 'spent' ? tr('spent') : tr('to come')}`}
          style={[styles.dot, { backgroundColor: d.state === 'clear' ? t.income : d.state === 'spent' ? t.expense : t.track }]}>
          <AppText variant="caption" weight="700" color={d.state === 'future' ? t.muted : '#FFFFFF'} style={{ fontSize: 11 }}>
            {fromISODate(d.date).getDate()}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  streakCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pill: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  dots: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  dot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
