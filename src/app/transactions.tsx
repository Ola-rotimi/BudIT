import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { SectionList, StyleSheet, TextInput, View } from 'react-native';
import { MonthSwitcher, TransactionRow, TransferRow } from '@/components/finance';
import { AppText, EmptyState, HeaderButton, Segmented } from '@/components/ui';
import { HideAmountsButton } from '@/components/HideAmountsButton';
import { getAccount, listTransactions, listTransfers, type TransferRow as TransferData, type TxRow } from '@/db/queries';
import type { TxType } from '@/db/types';
import { useQuery } from '@/hooks/useQuery';
import { currentMonthKey, dayLabel } from '@/lib/dates';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';

type Filter = 'all' | TxType;
type Entry = { key: string; date: string; tx?: TxRow; transfer?: TransferData };

/** All activity for a period. With `?account=<id>` it shows one account, including transfers in and out. */
export default function TransactionsScreen() {
  const t = useTheme();
  const { moneyIn } = useMoney();
  const params = useLocalSearchParams<{ account?: string }>();
  const accountId = params.account ? Number(params.account) : undefined;
  const [month, setMonth] = useState(currentMonthKey());
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const data = useQuery(`tx:${month}:${filter}:${search}:${accountId ?? ''}`, async (db) => {
    const [txs, transfers, account] = await Promise.all([
      listTransactions(db, month, filter === 'all' ? undefined : filter, search, accountId),
      // Transfers aren't income or spending, so they only appear in the unfiltered list.
      filter === 'all' && !search.trim() ? listTransfers(db, month, accountId) : Promise.resolve([]),
      accountId ? getAccount(db, accountId) : Promise.resolve(null),
    ]);
    return { txs, transfers, account };
  });
  const rows = data?.txs;
  const viewCurrency = accountId ? data?.account?.currency : null;
  const sum = (cents: number, sign = false) => moneyIn(cents, viewCurrency, { sign });

  const { sections, income, expense } = useMemo(() => {
    const entries: Entry[] = [
      ...(data?.txs ?? []).map((tx) => ({ key: `t${tx.id}`, date: tx.date, tx })),
      ...(data?.transfers ?? []).map((transfer) => ({ key: `x${transfer.id}`, date: transfer.date, transfer })),
    ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const groups = new Map<string, Entry[]>();
    let income = 0;
    let expense = 0;
    // Viewing one account: figures in that account's own currency (its original amounts).
    const own = (tx: TxRow) => (accountId ? (tx.orig_amount ?? tx.amount) : tx.amount);
    for (const r of data?.txs ?? []) {
      if (r.type === 'income') income += own(r);
      else expense += own(r);
    }
    for (const e of entries) {
      const list = groups.get(e.date);
      if (list) list.push(e);
      else groups.set(e.date, [e]);
    }
    // A transfer only changes the net when looking at one account (money in or out of it).
    const effect = (e: Entry) => {
      if (e.tx) return e.tx.type === 'income' ? own(e.tx) : -own(e.tx);
      if (!accountId || !e.transfer) return 0;
      return e.transfer.to_account === accountId ? (e.transfer.to_amount ?? e.transfer.amount) : -e.transfer.amount;
    };
    const sections = [...groups].map(([date, data]) => ({ date, data, net: data.reduce((s, e) => s + effect(e), 0) }));
    return { sections, income, expense };
  }, [data, accountId]);

  return (
    <SectionList
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      sections={sections}
      keyExtractor={(item) => item.key}
      stickySectionHeadersEnabled={false}
      ListHeaderComponent={
        <View style={{ gap: 12, marginBottom: 8 }}>
          <Stack.Screen
            options={{
              title: data?.account?.name ?? tr('Activity'),
              headerRight: () => (
                <View style={{ flexDirection: 'row' }}>
                  <HideAmountsButton />
                  {accountId ? (
                    <HeaderButton icon="create-outline" label={tr('Edit account')} onPress={() => router.push({ pathname: '/account', params: { id: String(accountId) } })} />
                  ) : null}
                  <HeaderButton
                    icon="swap-horizontal"
                    label={tr('Transfer')}
                    onPress={() => router.push(accountId ? { pathname: '/transfer', params: { from: String(accountId) } } : '/transfer')}
                  />
                  <HeaderButton
                    icon="add"
                    label={tr('Add transaction')}
                    onPress={() => router.push(accountId ? { pathname: '/transaction', params: { account: String(accountId) } } : '/transaction')}
                  />
                </View>
              ),
            }}
          />
          {data?.account && (
            <View style={[styles.summary, { backgroundColor: t.card, borderColor: t.border }]}>
              <SummaryItem label={tr('Balance now')} value={moneyIn(data.account.balance, data.account.currency)} color={data.account.balance < 0 ? t.expense : t.text} />
            </View>
          )}
          <MonthSwitcher month={month} onChange={setMonth} />
          <View style={[styles.search, { backgroundColor: t.inputBg, borderColor: t.border }]}>
            <Ionicons name="search" size={18} color={t.muted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={tr('Search notes or categories')}
              placeholderTextColor={t.muted}
              style={[styles.searchInput, { color: t.text }]}
              clearButtonMode="while-editing"
              returnKeyType="search"
            />
          </View>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: tr('All') },
              { value: 'expense', label: tr('Expenses') },
              { value: 'income', label: tr('Income') },
            ]}
          />
          <View style={[styles.summary, { backgroundColor: t.card, borderColor: t.border }]}>
            <SummaryItem label={tr('Income')} value={sum(income)} color={t.income} />
            <SummaryItem label={tr('Expenses')} value={sum(expense)} color={t.expense} />
            <SummaryItem label={tr('Net')} value={sum(income - expense, true)} color={t.text} />
          </View>
        </View>
      }
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <AppText variant="label">{dayLabel(section.date)}</AppText>
          <AppText variant="caption">{sum(section.net, true)}</AppText>
        </View>
      )}
      renderItem={({ item }) => (
        <View style={[styles.item, { backgroundColor: t.card }]}>
          {item.tx ? <TransactionRow tx={item.tx} /> : <TransferRow x={item.transfer!} accountId={accountId} />}
        </View>
      )}
      ListEmptyComponent={
        rows ? (
          <EmptyState
            icon="receipt-outline"
            title={search ? tr('No matches') : tr('Nothing recorded this month')}
            message={search ? tr('Try a different search term.') : tr('Tap + to add an income or expense.')}
            action={search ? undefined : { label: tr('Add transaction'), onPress: () => router.push('/transaction') }}
          />
        ) : undefined
      }
    />
  );
}

function SummaryItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <AppText variant="caption">{label}</AppText>
      <AppText weight="700" color={color} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12 },
  searchInput: { flex: 1, minHeight: 44, fontSize: 16 },
  summary: { flexDirection: 'row', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 12, paddingHorizontal: 8 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 16, paddingBottom: 6, paddingHorizontal: 4 },
  item: { paddingHorizontal: 12, borderRadius: 12, marginBottom: 6 },
});
