import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import { LimitNote } from '@/components/ProLock';
import { AppText, Card, EmptyState, HeaderButton, IconBadge, Loading, ProgressBar, Screen } from '@/components/ui';
import { HideAmountsButton } from '@/components/HideAmountsButton';
import { listGroups } from '@/db/queries';
import { useQuery } from '@/hooks/useQuery';
import { shortDate, todayISO } from '@/lib/dates';
import { useFreeLimit } from '@/lib/limits';
import { currentCycle, cycleDate, payoutAmount } from '@/lib/savingsGroups';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';

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
      <Stack.Screen
        options={{
          title: tr('Savings groups'),
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <HideAmountsButton />
              <HeaderButton icon="add" label={tr('New group')} onPress={addGroup} />
            </View>
          ),
        }}
      />
      {groups.length === 0 ? (
        <Card>
          <EmptyState
            icon="people-outline"
            title={tr('No savings groups yet')}
            message={tr('Add your ajo, esusu, susu, chama or stokvel. BudT tracks your contributions, your turn and what you’re owed or still owe.')}
            action={{ label: tr('Add a group'), onPress: addGroup }}
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
                  <AppText variant="caption">{tr('{0} {1} · {2} members', [money(g.contribution), g.frequency === 'weekly' ? tr('a week') : tr('a month'), g.members])}</AppText>
                </View>
              </View>
              <ProgressBar progress={g.paid_cycles / g.members} color="#D97706" />
              <AppText variant="caption">{tr('Paid {0} of {1} · cycle {2} now · {3}', [g.paid_cycles, g.members, cycle, collected ? tr('you collected {0}', [money(g.received)]) : tr('you collect {0} on {1}', [money(payoutAmount(g)), shortDate(turnDate)])])}</AppText>
              {g.pot_balance < 0 && (
                <AppText variant="caption" color={t.warning}>{tr('You’ve collected early: {0} still to pay in.', [money(-g.pot_balance)])}</AppText>
              )}
            </Card>
          );
        })
      )}
      {!limit.isPro && limit.used !== undefined && <LimitNote feature="groups" used={limit.used} />}
    </Screen>
  );
}
