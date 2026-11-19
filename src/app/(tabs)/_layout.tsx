import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, router, Tabs } from 'expo-router';
import { View, type ColorValue } from 'react-native';
import { HeaderButton } from '@/components/ui';
import { HideAmountsButton } from '@/components/HideAmountsButton';
import type { IconName } from '@/db/types';
import { useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';
import { tr } from '@/i18n';

const tabIcon = (name: IconName) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} size={size} color={color as string} />;
  };

export default function TabLayout() {
  const t = useTheme();
  const { onboarded } = useSettings();
  // First launch (or "Replay walkthrough"): show the walkthrough instead of the tabs.
  if (!onboarded) return <Redirect href="/welcome" />;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        headerShadowVisible: false,
        headerTitleStyle: { color: t.text },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: tr('Home'),
          headerTitle: tr('BudIT'),
          tabBarIcon: tabIcon('home'),
          headerRight: () => <HeaderButton icon="settings-outline" label={tr('Settings')} onPress={() => router.push('/settings')} />,
        }}
      />
      <Tabs.Screen
        name="budgets"
        options={{
          title: tr('Budgets'),
          tabBarIcon: tabIcon('pie-chart'),
          headerRight: () => (
            <View style={{ flexDirection: 'row' }}>
              <HideAmountsButton />
              <HeaderButton icon="sparkles-outline" label={tr('Smart budget')} onPress={() => router.push('/smart-budget')} />
              <HeaderButton icon="add" label={tr('Add budget')} onPress={() => router.push('/budget')} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="tax"
        options={{
          title: tr('Tax'),
          headerTitle: tr('Tax calculator'),
          tabBarIcon: tabIcon('calculator'),
          headerRight: () => <HeaderButton icon="document-text-outline" label={tr('Annual summary')} onPress={() => router.push('/tax-summary')} />,
        }}
      />
      <Tabs.Screen
        name="pension"
        options={{ title: tr('Pension'), headerTitle: tr('Pension planner'), tabBarIcon: tabIcon('umbrella') }}
      />
      <Tabs.Screen name="more" options={{ title: tr('More'), tabBarIcon: tabIcon('grid') }} />
    </Tabs>
  );
}
