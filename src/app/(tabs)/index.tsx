import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { TransactionRow, useBudgetColor } from '@/components/finance';
import { ProBadge } from '@/components/ProLock';
import { AppText, Button, Card, EmptyState, IconBadge, ListRow, Loading, ProgressBar, Screen, SectionHeader } from '@/components/ui';
import { budgetsWithSpending, getSetting, listAccounts, listBills, listGoals, monthTotals, recentTransactions, transactionCount } from '@/db/queries';
import { useQuery } from '@/hooks/useQuery';
import { currentMonthKey, dayLabel, daysBetween, monthLabel, periodProgress, todayISO } from '@/lib/dates';
import { BACKUP_REMINDER_DAYS, LAST_BACKUP_KEY } from '@/lib/backup';
import { formatPercent } from '@/lib/money';
import { takePendingRoute } from '@/lib/onboarding';
import { usePro } from '@/lib/pro';
import { useMoney, useSettings } from '@/lib/settings';
import { BRAND, useTheme } from '@/lib/theme';
import { tr } from '@/i18n';

/** Text on the brand-gradient hero card stays white in both light and dark mode. */
const ON_HERO = '#FFFFFF';
/** Cap system font scaling inside the hero so large accessibility sizes can't push it off-screen. */
const HERO_MAX_SCALE = 1.3;

export default function HomeScreen() {
  const t = useTheme();
  const { money } = useMoney();
  const { currencyChosen, country, hideAmounts, setHideAmounts } = useSettings();
  const budgetColor = useBudgetColor();
  const { isPro } = usePro();
  const month = currentMonthKey();
  const today = todayISO();

  // Opens whatever the walkthrough asked for (e.g. Smart budget) once Home is on screen.
  useEffect(() => {
    const href = takePendingRoute();
    if (href) router.push(href);
  }, []);

  const data = useQuery(`home:${month}:${today}`, async (db) => {
    const [totals, accounts, budgets, bills, goals, recent, txCount, lastBackup] = await Promise.all([
      monthTotals(db, month),
      listAccounts(db),
      budgetsWithSpending(db, month),
      listBills(db),
      listGoals(db),
      recentTransactions(db, 5),
      transactionCount(db),
      getSetting(db, LAST_BACKUP_KEY),
    ]);
    return { totals, accounts, budgets, bills, goals, recent, txCount, lastBackup };
  });

  if (!data) return <Loading />;
  const { totals, accounts, budgets, bills, goals, recent, txCount, lastBackup } = data;
  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
  // Nudge towards a backup once there's enough data to lose, and the last one is old (or never made).
  const backupAgeDays = lastBackup ? daysBetween(lastBackup.slice(0, 10), today) : null;
  const backupDue = txCount >= 20 && (backupAgeDays === null || backupAgeDays >= BACKUP_REMINDER_DAYS);

  const net = totals.income - totals.expense;
  const budgetTotal = budgets.reduce((s, b) => s + b.budget, 0);
  const budgetSpent = budgets.reduce((s, b) => s + b.spent, 0);
  const budgetRatio = budgetTotal ? budgetSpent / budgetTotal : 0;
  const { daysLeft } = periodProgress(month, today);
  const upcoming = bills.filter((b) => daysBetween(today, b.due_date) <= 14).slice(0, 3);
  const activeGoals = goals.filter((g) => g.saved < g.target).slice(0, 2);

  return (
    <Screen>
      {!country && (
        <Card
          onPress={() => router.push({ pathname: '/country', params: { purpose: 'home' } })}
          style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="globe-outline" size={22} color={t.primary} />
          <View style={{ flex: 1 }}>
            <AppText weight="700">{tr('Where are you based?')}</AppText>
            <AppText variant="caption">{tr('Pick your country to set your currency{0} and fill in local tax & pension rules.', [currencyChosen ? '' : tr(' (USD for now)')])}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Card>
      )}

      <HeroCard>
        <View>
          <View style={styles.heroTop}>
            <AppText variant="caption" color={ON_HERO} style={{ opacity: 0.85, flex: 1 }} numberOfLines={1} maxFontSizeMultiplier={HERO_MAX_SCALE}>{tr('{0} · net', [monthLabel(month)])}</AppText>
            <Pressable
              onPress={() => setHideAmounts(!hideAmounts)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={hideAmounts ? tr('Show amounts') : tr('Hide amounts')}>
              <Ionicons name={hideAmounts ? 'eye-off-outline' : 'eye-outline'} size={20} color={ON_HERO} />
            </Pressable>
          </View>
          <AppText
            variant="display"
            color={ON_HERO}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.5}
            maxFontSizeMultiplier={HERO_MAX_SCALE}>
            {money(net, { sign: true })}
          </AppText>
          <Pressable onPress={() => router.push('/accounts')} accessibilityRole="button" hitSlop={6}>
            <AppText variant="caption" color={ON_HERO} style={{ opacity: 0.85 }} numberOfLines={1} maxFontSizeMultiplier={HERO_MAX_SCALE}>
              {accounts.length > 1 ? tr('Balance across {0} accounts', [accounts.length]) : tr('Balance')} {money(totalBalance)} ›
            </AppText>
          </Pressable>
        </View>
        <View style={styles.statPanel}>
          <HeroStat icon="arrow-down" label={tr('Income')} value={money(totals.income)} />
          <View style={styles.statDivider} />
          <HeroStat icon="arrow-up" label={tr('Expenses')} value={money(totals.expense)} />
        </View>
        <View style={styles.heroRow}>
          <HeroButton icon="list" label={tr('Activity')} onPress={() => router.push('/transactions')} />
          <HeroButton icon="stats-chart" label={tr('Insights')} onPress={() => router.push('/insights')} />
        </View>
      </HeroCard>

      <View style={styles.actions}>
        <Button
          title={tr('Expense')}
          icon="remove-circle-outline"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => router.push({ pathname: '/transaction', params: { type: 'expense' } })}
        />
        <Button
          title={tr('Income')}
          icon="add-circle-outline"
          variant="secondary"
          style={{ flex: 1 }}
          onPress={() => router.push({ pathname: '/transaction', params: { type: 'income' } })}
        />
      </View>

      {backupDue && (
        <Card onPress={() => router.push('/settings')} style={styles.smartCard}>
          <IconBadge icon="cloud-upload-outline" color={t.warning} />
          <View style={{ flex: 1 }}>
            <AppText weight="700">{tr('Back up your data')}</AppText>
            <AppText variant="caption">{tr('{0} Your records only live on this phone.', [backupAgeDays === null ? tr('You haven’t made a backup yet.') : tr('Your last backup was {0} days ago.', [backupAgeDays])])}</AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Card>
      )}

      <Card onPress={() => router.push('/smart-budget')} style={styles.smartCard}>
        <IconBadge icon="sparkles" color={t.primary} />
        <View style={{ flex: 1 }}>
          <View style={styles.smartTitle}>
            <AppText weight="700">{tr('Smart budget')}</AppText>
            {!isPro && <ProBadge />}
          </View>
          <AppText variant="caption">
            {budgets.length ? tr('Rebalance your budgets from your income in one tap.') : tr('Enter your income and BudT builds your whole budget.')}
          </AppText>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.muted} />
      </Card>

      <Card>
        <SectionHeader title={tr('Monthly budget')} action={{ label: budgets.length ? tr('Details') : tr('Set up'), onPress: () => router.navigate('/budgets') }} />
        {budgets.length ? (
          <>
            <ProgressBar progress={budgetRatio} color={budgetColor(budgetRatio, t.primary)} height={10} />
            <View style={styles.between}>
              <AppText variant="caption">{tr('{0} of {1} ({2})', [money(budgetSpent), money(budgetTotal), formatPercent(budgetRatio, 0)])}</AppText>
              <AppText variant="caption">{tr('{0} day{1} left', [daysLeft, daysLeft === 1 ? '' : 's'])}</AppText>
            </View>
            {budgetTotal > budgetSpent && (
              <AppText variant="caption">{tr('You can spend about {0} a day for the rest of the month.', [money(Math.floor((budgetTotal - budgetSpent) / daysLeft))])}</AppText>
            )}
          </>
        ) : (
          <AppText variant="caption">{tr('Set spending limits per category to keep your month on track.')}</AppText>
        )}
      </Card>

      {upcoming.length > 0 && (
        <Card>
          <SectionHeader title={tr('Upcoming bills')} action={{ label: tr('All bills'), onPress: () => router.push('/bills') }} />
          {upcoming.map((b) => {
            const due = daysBetween(today, b.due_date);
            return (
              <ListRow
                key={b.id}
                icon={b.category_icon}
                iconColor={b.category_color}
                title={b.name}
                subtitle={due < 0 ? tr('Overdue by {0} day{1}', [-due, due === -1 ? '' : 's']) : due === 0 ? tr('Due today') : tr('Due {0}', [dayLabel(b.due_date)])}
                right={
                  <AppText weight="700" color={due < 0 ? t.expense : undefined}>
                    {money(b.amount)}
                  </AppText>
                }
                onPress={() => router.push('/bills')}
                chevron={false}
              />
            );
          })}
        </Card>
      )}

      {activeGoals.length > 0 && (
        <Card>
          <SectionHeader title={tr('Savings goals')} action={{ label: tr('All goals'), onPress: () => router.push('/goals') }} />
          {activeGoals.map((g) => (
            <View key={g.id} style={{ gap: 6 }}>
              <View style={styles.between}>
                <AppText weight="600">{g.name}</AppText>
                <AppText variant="caption">
                  {money(g.saved)} / {money(g.target)}
                </AppText>
              </View>
              <ProgressBar progress={g.saved / g.target} color={g.color} />
            </View>
          ))}
        </Card>
      )}

      <Card>
        <SectionHeader title={tr('Recent activity')} action={recent.length ? { label: tr('See all'), onPress: () => router.push('/transactions') } : undefined} />
        {recent.length ? (
          recent.map((tx) => <TransactionRow key={tx.id} tx={tx} showDate={dayLabel(tx.date)} />)
        ) : (
          <EmptyState
            icon="receipt-outline"
            title={tr('No transactions yet')}
            message={tr('Record your first income or expense to start tracking.')}
            action={{ label: tr('Add transaction'), onPress: () => router.push('/transaction') }}
          />
        )}
      </Card>
    </Screen>
  );
}

/**
 * The balance card's brand gradient. The SVG is sized from the card's measured layout (not "100%"),
 * so it always covers the whole card as content grows; the solid background is a fallback.
 */
function HeroCard({ children }: { children: ReactNode }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.width === width && s.height === height ? s : { width, height }));
  };
  return (
    <View style={styles.hero} onLayout={onLayout}>
      {size.width > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Svg width={size.width} height={size.height}>
            <Defs>
              <LinearGradient id="hero" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={BRAND.gradientStart} />
                <Stop offset="1" stopColor={BRAND.gradientEnd} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={size.width} height={size.height} fill="url(#hero)" />
            <Circle cx={size.width * 0.92} cy={0} r={120} fill="#FFFFFF" opacity={0.06} />
          </Svg>
        </View>
      )}
      {children}
    </View>
  );
}

function HeroButton({ icon, label, onPress }: { icon: 'list' | 'stats-chart'; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.heroButton, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={16} color={ON_HERO} />
      <AppText weight="700" color={ON_HERO} numberOfLines={1} style={{ flexShrink: 1 }} maxFontSizeMultiplier={HERO_MAX_SCALE}>
        {label}
      </AppText>
    </Pressable>
  );
}

function HeroStat({ icon, label, value }: { icon: 'arrow-down' | 'arrow-up'; label: string; value: string }) {
  return (
    <View style={styles.heroStat}>
      <View style={styles.statLabel}>
        <Ionicons name={icon} size={13} color={ON_HERO} style={{ opacity: 0.85 }} />
        <AppText variant="caption" color={ON_HERO} style={{ opacity: 0.85 }} numberOfLines={1} maxFontSizeMultiplier={HERO_MAX_SCALE}>
          {label}
        </AppText>
      </View>
      <AppText
        weight="700"
        color={ON_HERO}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        maxFontSizeMultiplier={HERO_MAX_SCALE}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: 20, padding: 16, gap: 12, overflow: 'hidden', backgroundColor: BRAND.gradientEnd },
  heroRow: { flexDirection: 'row', gap: 10 },
  statPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.35)' },
  heroStat: { flex: 1, minWidth: 0, gap: 2 },
  statLabel: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  heroButton: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  actions: { flexDirection: 'row', gap: 12 },
  smartCard: { flexDirection: 'row', alignItems: 'center' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smartTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
});
