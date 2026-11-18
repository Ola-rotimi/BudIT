import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { TransferRow as TransferRowData, TxRow } from '@/db/queries';
import { currentMonthKey, monthLabel, shiftMonth } from '@/lib/dates';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { AppText, IconBadge } from './ui';
import { tr } from '@/i18n';

/** A transfer between two of the user's accounts. Shown neutral, or as in/out when viewing one account. */
export function TransferRow({ x, accountId, showDate }: { x: TransferRowData; accountId?: number; showDate?: string }) {
  const t = useTheme();
  const { moneyIn } = useMoney();
  const direction = accountId === x.to_account ? 'in' : accountId === x.from_account ? 'out' : null;
  // Money arriving in a different currency shows the amount received.
  const shown = direction === 'in' && x.to_amount !== null ? moneyIn(x.to_amount, x.to_currency) : moneyIn(x.amount, x.from_currency);
  return (
    <Pressable
      // Savings-group moves are managed from the group's own screen.
      onPress={() =>
        x.group_id
          ? router.push({ pathname: '/savings-group', params: { id: String(x.group_id) } })
          : router.push({ pathname: '/transfer', params: { id: String(x.id) } })
      }
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <IconBadge icon="swap-horizontal" color={t.primary} size={40} />
      <View style={{ flex: 1 }}>
        <AppText weight="600" numberOfLines={1}>
          {x.note || tr('Transfer')}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {[`${x.from_name} → ${x.to_name}`, x.fee ? tr('fee {0}', [moneyIn(x.fee, x.from_currency)]) : null, showDate].filter(Boolean).join(' · ')}
        </AppText>
      </View>
      <AppText weight="700" color={direction === 'in' ? t.income : t.text} style={{ fontVariant: ['tabular-nums'] }}>
        {direction === 'in' ? '+' : direction === 'out' ? '−' : ''}
        {shown}
      </AppText>
    </Pressable>
  );
}

export function TransactionRow({ tx, showDate }: { tx: TxRow; showDate?: string }) {
  const t = useTheme();
  const { money, moneyIn } = useMoney();
  const income = tx.type === 'income';
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/transaction', params: { id: String(tx.id) } })}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <IconBadge icon={tx.category_icon} color={tx.category_color} size={40} />
      <View style={{ flex: 1 }}>
        <AppText weight="600" numberOfLines={1}>
          {tx.note || tr(tx.category_name)}
        </AppText>
        <AppText variant="caption" numberOfLines={1}>
          {[tx.note ? tr(tx.category_name) : null, showDate].filter(Boolean).join(' · ') || (income ? tr('Income') : tr('Expense'))}
        </AppText>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <AppText weight="700" color={income ? t.income : t.text} style={{ fontVariant: ['tabular-nums'] }}>
          {income ? '+' : '−'}
          {tx.orig_currency && tx.orig_amount !== null ? moneyIn(tx.orig_amount, tx.orig_currency) : money(tx.amount)}
        </AppText>
        {/* Paid in another currency: also show what it counts as in budgets. */}
        {tx.orig_currency ? (
          <AppText variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
            ≈ {money(tx.amount)}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const t = useTheme();
  const atCurrent = month >= currentMonthKey();
  return (
    <View style={styles.switcher}>
      <Pressable onPress={() => onChange(shiftMonth(month, -1))} hitSlop={10} accessibilityLabel={tr('Previous month')} style={styles.arrow}>
        <Ionicons name="chevron-back" size={22} color={t.primary} />
      </Pressable>
      <Pressable onPress={() => onChange(currentMonthKey())} accessibilityLabel={tr('Go to current month')}>
        <AppText variant="heading">{monthLabel(month)}</AppText>
      </Pressable>
      <Pressable
        onPress={() => onChange(shiftMonth(month, 1))}
        disabled={atCurrent}
        hitSlop={10}
        accessibilityLabel={tr('Next month')}
        style={[styles.arrow, atCurrent && { opacity: 0.3 }]}>
        <Ionicons name="chevron-forward" size={22} color={t.primary} />
      </Pressable>
    </View>
  );
}

/** Colour for a spent/limit ratio: normal, warning past 80%, over budget past 100%. */
export function useBudgetColor() {
  const t = useTheme();
  return (ratio: number, base: string) => (ratio > 1 ? t.expense : ratio >= 0.8 ? t.warning : base);
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  switcher: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  arrow: { padding: 6 },
});
