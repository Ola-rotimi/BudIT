import { router, Stack } from 'expo-router';
import { View } from 'react-native';
import { AppText, Button, Card, Divider, EmptyState, HeaderButton, IconBadge, ListRow, Loading, Screen } from '@/components/ui';
import { HideAmountsButton } from '@/components/HideAmountsButton';
import { listAccounts } from '@/db/queries';
import { useQuery } from '@/hooks/useQuery';
import { ACCOUNT_KINDS } from '@/lib/accounts';
import { useSecurity } from '@/lib/security';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';

/** All wallets with their balances. Tapping one shows its activity. */
export default function AccountsScreen() {
  const t = useTheme();
  const { money, moneyIn, currency } = useMoney();
  const { safeMode } = useSecurity();
  const data = useQuery('accounts:list', (db) => listAccounts(db));

  if (!data) return <Loading />;
  // Safe mode: show nothing worth seeing (see lib/security).
  const accounts = safeMode ? [] : data;
  const counted = accounts.filter((a) => a.home_balance !== null);
  const total = counted.reduce((s, a) => s + a.home_balance!, 0);
  const owed = counted.filter((a) => a.home_balance! < 0).reduce((s, a) => s + a.home_balance!, 0);
  const unconverted = accounts.filter((a) => a.home_balance === null);

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
        {unconverted.length > 0 && (
          <AppText variant="caption" color={t.warning}>
            {tr('{0} isn’t included yet: BudT needs the official exchange rate once. Connect to the internet to update.', [unconverted.map((a) => a.name).join(', ')])}
          </AppText>
        )}
        <Button title={tr('Transfer between accounts')} icon="swap-horizontal" variant="secondary" onPress={() => router.push('/transfer')} disabled={accounts.length < 2} />
      </Card>

      {accounts.length > 0 ? (
        <Card style={{ gap: 6 }}>
          {accounts.map((a, i) => {
            const foreign = !!a.currency && a.currency !== currency;
            const kind = ACCOUNT_KINDS[a.kind] ? tr(ACCOUNT_KINDS[a.kind].label) : tr('Account');
            return (
              <View key={a.id}>
                {i > 0 && <Divider />}
                <ListRow
                  icon={a.icon}
                  iconColor={a.color}
                  title={a.name}
                  subtitle={foreign ? `${kind} · ${a.currency}` : kind}
                  right={
                    <View style={{ alignItems: 'flex-end' }}>
                      <AppText weight="700" color={a.balance < 0 ? t.expense : undefined}>
                        {moneyIn(a.balance, a.currency)}
                      </AppText>
                      {foreign && a.home_balance !== null && <AppText variant="caption">≈ {money(a.home_balance)}</AppText>}
                    </View>
                  }
                  onPress={() => router.push({ pathname: '/transactions', params: { account: String(a.id) } })}
                />
              </View>
            );
          })}
        </Card>
      ) : (
        <Card>
          <EmptyState icon="wallet-outline" title={tr('No accounts yet')} message={tr('Add your cash, bank and mobile-money accounts to see your balances.')} />
        </Card>
      )}

      <Card style={{ flexDirection: 'row', alignItems: 'center' }} onPress={() => router.push('/net-worth')}>
        <IconBadge icon="trending-up" color={t.primary} />
        <View style={{ flex: 1 }}>
          <AppText weight="700">{tr('Net worth')}</AppText>
          <AppText variant="caption">{tr('What you own minus what you owe, month by month.')}</AppText>
        </View>
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
          <AppText variant="caption">{tr('Cash, bank, mobile money (M-Pesa, MoMo, OPay…), cards or savings, in any currency.')}</AppText>
        </View>
      </Card>
    </Screen>
  );
}
