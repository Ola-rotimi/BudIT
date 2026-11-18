import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { FREE_LIMITS, LIMIT_COPY, type LimitedFeature } from '@/lib/limits';
import { BRAND, useTheme } from '@/lib/theme';
import { AppText, Button, Card, Screen } from './ui';
import { tr } from '@/i18n';

/** Shown in place of a Pro-only result: explains what unlocking gives and opens the paywall. */
export function ProLock({ title, message }: { title: string; message: string }) {
  const t = useTheme();
  return (
    <Card style={[styles.card, { borderColor: t.primary }]}>
      <View style={[styles.badge, { backgroundColor: t.primarySoft }]}>
        <Ionicons name="lock-closed" size={22} color={t.primary} />
      </View>
      <AppText variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      <AppText style={{ textAlign: 'center', color: t.muted }}>{message}</AppText>
      <Button title={tr('Unlock with BudT Pro')} icon="sparkles" onPress={() => router.push('/paywall')} style={{ alignSelf: 'stretch' }} />
    </Card>
  );
}

/** Full-screen replacement for a Pro-only screen. Existing data is kept, just hidden until unlocked. */
export function ProScreen({ screenTitle, title, message }: { screenTitle: string; title: string; message: string }) {
  return (
    <Screen>
      <Stack.Screen options={{ title: screenTitle, headerRight: undefined }} />
      <ProLock title={title} message={message} />
    </Screen>
  );
}

/** "Free plan: 1 of 1 savings goal used" with an upgrade link, under lists that have a free allowance. */
export function LimitNote({ feature, used }: { feature: LimitedFeature; used: number }) {
  const t = useTheme();
  const limit = FREE_LIMITS[feature];
  return (
    <AppText variant="caption" style={{ textAlign: 'center' }}>
      {tr('Free plan: {0} of {1} {2} used.', [Math.min(used, limit), limit, LIMIT_COPY[feature].noun(limit)])}{' '}
      <AppText variant="caption" color={t.primary} weight="700" onPress={() => router.push('/paywall')}>{tr('Get unlimited with Pro')}</AppText>
    </AppText>
  );
}

/** Small "PRO" pill for menus. */
export function ProBadge() {
  return (
    <View style={[styles.pill, { backgroundColor: BRAND.amber }]}>
      <AppText variant="caption" weight="800" color="#3B2502">{tr('PRO')}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', borderWidth: 1.5, paddingVertical: 24 },
  badge: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
});
