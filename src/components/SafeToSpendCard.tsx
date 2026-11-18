import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { tr } from '@/i18n';
import { dayLabel, shortDate } from '@/lib/dates';
import type { SafeToSpend } from '@/lib/safeToSpend';
import { useMoney } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { AppText, Card, Divider, IconBadge, StatLine } from './ui';

const KIND_ICON = { bill: 'calendar', recurring: 'repeat', group: 'people' } as const;

/** Home card: what's left to spend each day until payday once bills and commitments are paid. */
export function SafeToSpendCard({ result, hasAccounts }: { result: SafeToSpend; hasAccounts: boolean }) {
  const t = useTheme();
  const { money, currency } = useMoney();
  const [open, setOpen] = useState(false);

  if (!hasAccounts) {
    return (
      <Card onPress={() => router.push('/accounts')} style={styles.row}>
        <IconBadge icon="speedometer-outline" color={t.primary} />
        <View style={{ flex: 1 }}>
          <AppText weight="700">{tr('Safe to spend')}</AppText>
          <AppText variant="caption">{tr('Enter your account balances to see what you can spend each day until payday.')}</AppText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.muted} />
      </Card>
    );
  }

  const short = result.safe < 0;
  return (
    <Card>
      <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ gap: 4 }}>
        <View style={styles.row}>
          <AppText variant="label" style={{ flex: 1 }}>
            {tr('Safe to spend until {0}', [dayLabel(result.payday)])}
          </AppText>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={t.muted} />
        </View>
        <AppText variant="title" color={short ? t.expense : t.primary}>
          {short ? tr('Short by {0}', [money(-result.safe)]) : money(result.safe)}
        </AppText>
        <AppText variant="caption">
          {short
            ? tr('Your bills and payments before payday come to more than you have. Move money in or delay something.')
            : tr('About {0} a day for the next {1} day{2}.', [money(result.perDay), result.days, result.days === 1 ? '' : 's'])}
        </AppText>
      </Pressable>
      {open && (
        <>
          <Divider />
          <StatLine label={tr('In your everyday accounts')} value={money(result.available)} />
          <StatLine label={tr('Due before payday')} value={money(-result.committed)} color={result.committed ? t.expense : undefined} />
          {result.items.slice(0, 8).map((item, i) => (
            <View key={`${item.kind}-${item.name}-${item.date}-${i}`} style={styles.item}>
              <Ionicons name={KIND_ICON[item.kind]} size={14} color={t.muted} />
              <AppText variant="caption" style={{ flex: 1 }} numberOfLines={1}>
                {item.name} · {shortDate(item.date)}
              </AppText>
              <AppText variant="caption">{money(item.amount)}</AppText>
            </View>
          ))}
          {result.items.length > 8 && <AppText variant="caption">{tr('and {0} more', [result.items.length - 8])}</AppText>}
          <AppText variant="caption">
            {tr('Counts cash, bank and mobile-money accounts in {0}. Payday is your next recurring income, or the start of your next budget month.', [currency])}
          </AppText>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
