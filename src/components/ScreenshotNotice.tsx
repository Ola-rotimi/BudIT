import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSecurity } from '@/lib/security';
import { useTheme } from '@/lib/theme';
import { AppText } from './ui';

const SHOW_MS = 4500;

/** In-app banner shown when a screenshot is blocked by the privacy screen. */
export function ScreenshotNotice() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { screenshotBlockedAt } = useSecurity();
  const [shownFor, setShownFor] = useState(0);
  const visible = screenshotBlockedAt > 0 && shownFor !== screenshotBlockedAt;

  // Hide automatically after a few seconds; a new screenshot shows it again.
  useEffect(() => {
    if (!screenshotBlockedAt) return;
    const id = setTimeout(() => setShownFor(screenshotBlockedAt), SHOW_MS);
    return () => clearTimeout(id);
  }, [screenshotBlockedAt]);

  if (!visible) return null;
  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="box-none">
      <Pressable
        onPress={() => setShownFor(screenshotBlockedAt)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={[styles.banner, { backgroundColor: t.card, borderColor: t.border }]}>
        <Ionicons name="eye-off" size={22} color={t.primary} />
        <View style={{ flex: 1 }}>
          <AppText weight="700">Screenshot blocked</AppText>
          <AppText variant="caption">
            {Platform.OS === 'ios' ? 'BudT’s privacy screen is on, so screenshots come out blank.' : 'BudT’s privacy screen is on, so screenshots are blocked.'}{' '}
            <AppText
              variant="caption"
              weight="700"
              color={t.primary}
              onPress={() => {
                setShownFor(screenshotBlockedAt);
                router.push('/settings');
              }}>
              Change in Settings
            </AppText>
          </AppText>
        </View>
        <Ionicons name="close" size={18} color={t.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 1000, elevation: 1000 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
