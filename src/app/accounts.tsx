import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import { AppText, Button, Card, Divider, HeaderButton, IconBadge, ListRow, Loading, Screen } from '@/components/ui';
import { HideAmountsButton } from '@/components/HideAmountsButton';
import { listAccounts } from '@/db/queries';
import { useQuery } from '@/hooks/useQuery';
import { ACCOUNT_KINDS } from '@/lib/accounts';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';

/** All wallets with their balances. Tapping one shows its activity. */
export default function AccountsScreen() {
  const t = useTheme();
  const { money } = useMoney();
  const accounts = useQuery('accounts:list', (db) => listAccounts(db));

  if (!accounts) return <Loading />;
  const total = accounts.reduce((s, a) => s + a.balance, 0);
  const owed = accounts.filter((a) => a.balance < 0).reduce((s, a) => s + a.balance, 0);

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: tr('Accounts'),
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <HideAmountsButton />
              <HeaderButton icon="add" label={tr('Add account')} onPress={() => router.push('/account')} />
            </View>
          ),
        }}
      />
      <Card>
        <AppText variant="label">{tr('Total across {0} account{1}', [accounts.length, accounts.length === 1 ? '' : 's'])}</AppText>
        <AppText variant="title" color={total < 0 ? t.expense : undefined}>
          {money(total)}
        </AppText>
        {owed < 0 && <AppText variant="caption">{tr('Includes {0} owed on cards or loans.', [money(-owed)])}</AppText>}
        <Button title={tr('Transfer between accounts')} icon="swap-horizontal" variant="secondary" onPress={() => router.push('/transfer')} disabled={accounts.length < 2} />
      </Card>

      <Card style={{ gap: 6 }}>
        {accounts.map((a, i) => (
          <View key={a.id}>
            {i > 0 && <Divider />}
            <ListRow
              icon={a.icon}
              iconColor={a.color}
              title={a.name}
              subtitle={ACCOUNT_KINDS[a.kind] ? tr(ACCOUNT_KINDS[a.kind].label) : tr('Account')}
              right={
                <AppText weight="700" color={a.balance < 0 ? t.expense : undefined}>
                  {money(a.balance)}
                </AppText>
              }
              onPress={() => router.push({ pathname: '/transactions', params: { account: String(a.id) } })}
            />
          </View>
        ))}
      </Card>

      <Card style={{ flexDirection: 'row', alignItems: 'center' }} onPress={() => router.push('/import')}>
        <IconBadge icon="download-outline" color={t.primary} />
        <View style={{ flex: 1 }}>
          <AppText weight="700">{tr('Import a statement')}</AppText>
          <AppText variant="caption">{tr('Bring in transactions from your bank or mobile-money app (CSV).')}</AppText>
        </View>
      </Card>

      <Card style={{ flexDirection: 'row', alignItems: 'center' }} onPress={() => router.push('/account')}>
        <IconBadge icon="add" color={t.primary} />
        <View style={{ flex: 1 }}>
          <AppText weight="700">{tr('Add an account')}</AppText>
          <AppText variant="caption">{tr('Cash, bank, mobile money (M-Pesa, MoMo, OPay…), cards or savings.')}</AppText>
        </View>
      </Card>
    </Screen>
  );
}
