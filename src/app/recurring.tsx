import { router, Stack } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Alert, View } from 'react-native';
import { AppText, Card, Divider, EmptyState, HeaderButton, IconBadge, Loading, Screen } from '@/components/ui';
import { HideAmountsButton } from '@/components/HideAmountsButton';
import { listRecurring, stopRecurring, type RecurringRow } from '@/db/queries';
import { useQuery } from '@/hooks/useQuery';
import { shortDate } from '@/lib/dates';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { N_, tr } from '@/i18n';

const EVERY = { weekly: N_('Every week'), monthly: N_('Every month'), yearly: N_('Every year') } as const;

/** Rules that add income or spending automatically (salary, rent, subscriptions…). */
export default function RecurringScreen() {
  const rules = useQuery('recurring:list', listRecurring);
  const addNew = () => router.push('/transaction');

  if (!rules) return <Loading />;
  return (
    <Screen>
      <Stack.Screen
        options={{
          title: tr('Recurring'),
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <HideAmountsButton />
              <HeaderButton icon="add" label={tr('Add recurring')} onPress={addNew} />
            </View>
          ),
        }}
      />
      {rules.length === 0 ? (
        <Card>
          <EmptyState
            icon="repeat"
            title={tr('Nothing recurring yet')}
            message={tr('When you add a transaction, choose Repeat (weekly, monthly or yearly) and BudIT will record it for you on each date: salary, rent, subscriptions and more.')}
            action={{ label: tr('Add a transaction'), onPress: addNew }}
          />
        </Card>
      ) : (
        <>
          <AppText variant="caption">{tr('BudIT adds these automatically when they’re due, even if you haven’t opened the app for a while.')}</AppText>
          <Card style={{ gap: 6 }}>
            {rules.map((r, i) => (
              <View key={r.id}>
                {i > 0 && <Divider />}
                <RuleRow rule={r} />
              </View>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

function RuleRow({ rule: r }: { rule: RecurringRow }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const { money } = useMoney();
  const stop = () =>
    Alert.alert(tr('Stop this recurring entry?'), tr('BudIT won’t add “{0}” any more. Entries already added are kept.', [r.note || tr(r.category_name)]), [
      { text: tr('Cancel'), style: 'cancel' },
      { text: tr('Stop'), style: 'destructive', onPress: () => stopRecurring(db, r.id) },
    ]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}>
      <IconBadge icon={r.category_icon} color={r.category_color} />
      <View style={{ flex: 1 }}>
        <AppText weight="600" numberOfLines={1}>
          {r.note || tr(r.category_name)}
        </AppText>
        <AppText variant="caption" numberOfLines={2}>{tr('{0} · next {1}{2}', [tr(EVERY[r.frequency]), shortDate(r.next_date), r.account_name ? ` · ${r.account_name}` : ''])}</AppText>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <AppText weight="700" color={r.type === 'income' ? t.income : undefined}>
          {r.type === 'income' ? '+' : '−'}
          {money(r.amount)}
        </AppText>
        <AppText variant="caption" color={t.expense} onPress={stop} accessibilityRole="button">{tr('Stop')}</AppText>
      </View>
    </View>
  );
}
