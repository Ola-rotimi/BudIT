import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { AppText, Card, Divider, HeaderDeleteButton, Loading, Screen, StatLine } from '@/components/ui';
import { endGroup, getGroup, groupTransfers, recordGroupMove, undoGroupMove, type GroupRow } from '@/db/queries';
import type { Transfer } from '@/db/types';
import { useQuery } from '@/hooks/useQuery';
import { shortDate, todayISO } from '@/lib/dates';
import { currentCycle, cycleDate, payoutAmount } from '@/lib/savingsGroups';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';

/** One savings group: the schedule, what's been paid in, and the payout. */
export default function SavingsGroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const db = useSQLiteContext();
  const { money } = useMoney();
  const data = useQuery(`group:${id}`, async (d) => {
    const [group, moves] = await Promise.all([getGroup(d, Number(id)), groupTransfers(d, Number(id))]);
    return { group, moves };
  });

  if (!data) return <Loading />;
  const { group: g, moves } = data;
  if (!g) return <Loading />;
  const today = todayISO();
  const cycle = currentCycle(g, today);
  const payout = moves.find((m) => m.from_account === g.pot_account_id);
  const paid = new Map<number, Transfer>(moves.filter((m) => m.to_account === g.pot_account_id).map((m) => [m.group_cycle ?? 0, m]));
  const contributed = [...paid.values()].reduce((s, m) => s + m.amount, 0);

  const end = () =>
    Alert.alert('End this group?', 'It disappears from your list. Contributions and payouts you recorded stay in your history.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End group',
        style: 'destructive',
        onPress: async () => {
          await endGroup(db, g);
          router.back();
        },
      },
    ]);

  return (
    <Screen>
      <Stack.Screen options={{ title: g.name, headerRight: () => <HeaderDeleteButton label="End group" icon="archive-outline" onPress={end} /> }} />
      <Card>
        <StatLine label="Your payout" value={`${money(payoutAmount(g))} · cycle ${g.my_turn}`} bold />
        <StatLine label="Paid in so far" value={`${money(contributed)} (${paid.size} of ${g.members})`} />
        <StatLine label="Received" value={payout ? money(payout.amount) : 'Not yet'} />
        <Divider />
        <Standing group={g} />
      </Card>

      <Card style={{ gap: 4 }}>
        <AppText variant="heading">Schedule</AppText>
        <AppText variant="caption">Tap a cycle to record your contribution (or undo it).</AppText>
        {Array.from({ length: g.members }, (_, i) => i + 1).map((c) => {
          const date = cycleDate(g, c);
          const move = paid.get(c);
          const due = !move && date <= today;
          const mine = c === g.my_turn;
          const toggle = () =>
            move
              ? Alert.alert('Undo this contribution?', `${money(move.amount)} on ${shortDate(move.date)}`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Undo', style: 'destructive', onPress: () => undoGroupMove(db, move.id) },
                ])
              : recordGroupMove(db, g, 'contribution', c, date > today ? today : date);
          return (
            <View key={c}>
              <Pressable onPress={toggle} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]} accessibilityRole="checkbox" accessibilityState={{ checked: !!move }}>
                <Ionicons name={move ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={move ? t.income : due ? t.warning : t.muted} />
                <View style={{ flex: 1 }}>
                  <AppText weight={c === cycle ? '700' : '400'}>
                    Cycle {c} · {shortDate(date)}
                  </AppText>
                  <AppText variant="caption" color={due ? t.warning : undefined}>
                    {move ? `Paid ${money(move.amount)}` : due ? 'Due: tap when paid' : 'Upcoming'}
                    {c === cycle ? ' · current' : ''}
                  </AppText>
                </View>
                <AppText>{money(g.contribution)}</AppText>
              </Pressable>
              {mine && (
                <Pressable
                  onPress={() =>
                    payout
                      ? Alert.alert('Undo the payout?', undefined, [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Undo', style: 'destructive', onPress: () => undoGroupMove(db, payout.id) },
                        ])
                      : recordGroupMove(db, g, 'payout', c, date > today ? today : date)
                  }
                  style={[styles.payout, { backgroundColor: t.primarySoft }]}
                  accessibilityRole="button">
                  <Ionicons name={payout ? 'gift' : 'gift-outline'} size={20} color={t.primary} />
                  <AppText weight="700" color={t.primary} style={{ flex: 1 }}>
                    {payout ? `You collected ${money(payout.amount)}` : `Your turn: collect ${money(payoutAmount(g))}`}
                  </AppText>
                  <AppText variant="caption" color={t.primary}>
                    {payout ? 'Undo' : 'Mark received'}
                  </AppText>
                </Pressable>
              )}
            </View>
          );
        })}
      </Card>
    </Screen>
  );
}

/** Plain-language position: owed money by the group, or owing it after collecting early. */
function Standing({ group: g }: { group: GroupRow }) {
  const t = useTheme();
  const { money } = useMoney();
  const balance = g.pot_balance;
  if (balance > 0) {
    return (
      <AppText variant="caption">
        The group holds {money(balance)} of yours{g.received ? '' : `, paid back when you collect`}.
      </AppText>
    );
  }
  if (balance < 0) {
    return (
      <AppText variant="caption" color={t.warning}>
        You collected before paying everything in: {money(-balance)} still to contribute.
      </AppText>
    );
  }
  return <AppText variant="caption">You’re all square with the group.</AppText>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  payout: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, marginBottom: 6 },
});
