import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import { LimitNote } from '@/components/ProLock';
import { AppText, Card, EmptyState, HeaderButton, IconBadge, Loading, ProgressBar, Screen } from '@/components/ui';
import { listGroups } from '@/db/queries';
import { useQuery } from '@/hooks/useQuery';
import { shortDate, todayISO } from '@/lib/dates';
import { useFreeLimit } from '@/lib/limits';
import { currentCycle, cycleDate, payoutAmount } from '@/lib/savingsGroups';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';

/** Ajo, esusu, susu, chama, stokvel: rotating savings groups the user belongs to. */
export default function GroupsScreen() {
  const t = useTheme();
  const { money } = useMoney();
  const groups = useQuery('groups:list', listGroups);
  const limit = useFreeLimit('groups');
  const addGroup = () => limit.add('/group-form');

  if (!groups) return <Loading />;
  const today = todayISO();

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Savings groups', headerRight: () => <HeaderButton icon="add" label="New group" onPress={addGroup} /> }} />
      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon="people-outline"
            title="No savings groups yet"
            message="Add your ajo, esusu, susu, chama or stokvel. BudT tracks your contributions, your turn and what you’re owed or still owe."
            action={{ label: 'Add a group', onPress: addGroup }}
          />
        </Card>
      ) : (
        groups.map((g) => {
          const cycle = currentCycle(g, today);
          const collected = g.received > 0;
          const turnDate = cycleDate(g, g.my_turn);
          return (
            <Card key={g.id} onPress={() => router.push({ pathname: '/savings-group', params: { id: String(g.id) } })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <IconBadge icon="people" color="#D97706" />
                <View style={{ flex: 1 }}>
                  <AppText weight="700">{g.name}</AppText>
                  <AppText variant="caption">
                    {money(g.contribution)} {g.frequency === 'weekly' ? 'a week' : 'a month'} · {g.members} members
                  </AppText>
                </View>
              </View>
              <ProgressBar progress={g.paid_cycles / g.members} color="#D97706" />
              <AppText variant="caption">
                Paid {g.paid_cycles} of {g.members} · cycle {cycle} now ·{' '}
                {collected ? `you collected ${money(g.received)}` : `you collect ${money(payoutAmount(g))} on ${shortDate(turnDate)}`}
              </AppText>
              {g.pot_balance < 0 && (
                <AppText variant="caption" color={t.warning}>
                  You’ve collected early: {money(-g.pot_balance)} still to pay in.
                </AppText>
              )}
            </Card>
          );
        })
      )}
      {!limit.isPro && limit.used !== undefined && <LimitNote feature="groups" used={limit.used} />}
    </Screen>
  );
}
