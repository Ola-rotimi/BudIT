import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { HideAmountsButton } from '@/components/HideAmountsButton';
import { LimitNote } from '@/components/ProLock';
import { AppText, Button, Card, Divider, EmptyState, HeaderButton, ListRow, Loading, Screen, Segmented } from '@/components/ui';
import { iouTotals, listIous, type IouRow } from '@/db/planning';
import { useQuery } from '@/hooks/useQuery';
import { tr } from '@/i18n';
import { daysBetween, shortDate, todayISO } from '@/lib/dates';
import { useFreeLimit } from '@/lib/limits';
import { useSecurity } from '@/lib/security';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';

type View_ = 'open' | 'settled';

/** Money lent and borrowed, and shares of split bills, grouped by person. */
export default function IousScreen() {
  const t = useTheme();
  const { money } = useMoney();
  const { safeMode } = useSecurity();
  const [view, setView] = useState<View_>('open');
  const limit = useFreeLimit('ious');
  const data = useQuery(`ious:${view}`, async (db) => {
    const [rows, totals] = await Promise.all([listIous(db, view === 'settled'), iouTotals(db)]);
    return { rows: view === 'settled' ? rows.filter((r) => r.outstanding <= 0) : rows, totals };
  });

  if (!data) return <Loading />;
  // Safe mode: nothing to see (see lib/security).
  const rows = safeMode ? [] : data.rows;
  const totals = safeMode ? { owedToMe: 0, iOwe: 0 } : data.totals;
  const today = todayISO();

  const byPerson = new Map<string, IouRow[]>();
  for (const r of rows) byPerson.set(r.person, [...(byPerson.get(r.person) ?? []), r]);

  const add = (mode: 'lend' | 'borrow' | 'split') => limit.add({ pathname: '/iou', params: { mode } });

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: tr('IOUs'),
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <HideAmountsButton />
              <HeaderButton icon="add" label={tr('Add IOU')} onPress={() => add('lend')} />
            </View>
          ),
        }}
      />
      <Card>
        <View style={styles.totals}>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="label">{tr('Owed to you')}</AppText>
            <AppText variant="title" color={t.income}>
              {money(totals.owedToMe)}
            </AppText>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="label">{tr('You owe')}</AppText>
            <AppText variant="title" color={totals.iOwe ? t.expense : undefined}>
              {money(totals.iOwe)}
            </AppText>
          </View>
        </View>
        <View style={styles.actions}>
          <Button title={tr('I lent')} icon="arrow-up-circle-outline" variant="secondary" onPress={() => add('lend')} style={{ flex: 1 }} />
          <Button title={tr('I borrowed')} icon="arrow-down-circle-outline" variant="secondary" onPress={() => add('borrow')} style={{ flex: 1 }} />
        </View>
        <Button title={tr('Split a bill')} icon="people-outline" variant="secondary" onPress={() => add('split')} />
        {!limit.isPro && limit.used !== undefined && <LimitNote feature="ious" used={limit.used} />}
      </Card>

      <Segmented<View_>
        value={view}
        onChange={setView}
        options={[
          { value: 'open', label: tr('Open') },
          { value: 'settled', label: tr('Settled') },
        ]}
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon="people-outline"
            title={view === 'open' ? tr('Nobody owes anybody') : tr('Nothing settled yet')}
            message={tr('Keep track of money you lend or borrow, and split bills with friends. It all stays on your phone.')}
          />
        </Card>
      ) : (
        [...byPerson].map(([person, list]) => {
          const net = list.reduce((s, r) => s + (r.direction === 'owed_to_me' ? r.outstanding : -r.outstanding), 0);
          return (
            <Card key={person} style={{ gap: 6 }}>
              <View style={styles.person}>
                <AppText weight="700" style={{ flex: 1 }}>
                  {person}
                </AppText>
                {view === 'open' && (
                  <AppText weight="700" color={net >= 0 ? t.income : t.expense}>
                    {net >= 0 ? tr('owes you {0}', [money(net)]) : tr('you owe {0}', [money(-net)])}
                  </AppText>
                )}
              </View>
              {list.map((r, i) => {
                const overdue = r.due_date && r.outstanding > 0 && daysBetween(today, r.due_date) < 0;
                return (
                  <View key={r.id}>
                    {i > 0 && <Divider />}
                    <ListRow
                      icon={r.direction === 'owed_to_me' ? 'arrow-up-circle' : 'arrow-down-circle'}
                      iconColor={r.direction === 'owed_to_me' ? t.income : t.expense}
                      title={r.note || (r.direction === 'owed_to_me' ? tr('You lent') : tr('You borrowed'))}
                      subtitle={[
                        shortDate(r.date),
                        r.repaid > 0 && r.outstanding > 0 ? tr('{0} repaid', [money(r.repaid)]) : null,
                        r.due_date && r.outstanding > 0 ? (overdue ? tr('overdue since {0}', [shortDate(r.due_date)]) : tr('due {0}', [shortDate(r.due_date)])) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      right={
                        <AppText weight="700" color={overdue ? t.expense : undefined}>
                          {money(view === 'open' ? r.outstanding : r.amount)}
                        </AppText>
                      }
                      onPress={() => router.push({ pathname: '/iou', params: { id: String(r.id) } })}
                    />
                  </View>
                );
              })}
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  totals: { flexDirection: 'row', gap: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
