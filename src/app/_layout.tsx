import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, useColorScheme } from 'react-native';
import { BackgroundJobs } from '@/components/BackgroundJobs';
import { LockScreen } from '@/components/LockScreen';
import { ScreenshotNotice } from '@/components/ScreenshotNotice';
import { keyStatement, PLAIN_DB, prepareDatabase, type PreparedDatabase } from '@/db/encryption';
import { migrateDbIfNeeded } from '@/db/schema';
import { ProProvider } from '@/lib/pro';
import { SecurityProvider } from '@/lib/security';
import { SettingsProvider, useSettings } from '@/lib/settings';
import { useTheme } from '@/lib/theme';

/** Form screens presented as modals over the current screen. */
const MODALS = ['transaction', 'budget', 'goal', 'contribute', 'bill', 'category', 'country', 'paywall', 'pin', 'account', 'transfer', 'debt', 'group-form'];

export default function RootLayout() {
  const t = useTheme();
  const base = useColorScheme() === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, primary: t.primary, background: t.bg, card: t.card, text: t.text, border: t.border },
  };

  return (
    <SecurityProvider>
      <DatabaseGate>
        <SettingsProvider>
          <ProProvider>
            <ThemeProvider value={navTheme}>
              <StatusBar style="auto" />
              <BackgroundJobs />
              <RootStack />
              <ScreenshotNotice />
            </ThemeProvider>
          </ProProvider>
        </SettingsProvider>
      </DatabaseGate>
      <LockScreen />
    </SecurityProvider>
  );
}

/** Opens the (encrypted, where the build supports it) database before anything reads from it. */
function DatabaseGate({ children }: { children: ReactNode }) {
  const [prepared, setPrepared] = useState<PreparedDatabase>();

  useEffect(() => {
    prepareDatabase().then(setPrepared, (e) => {
      console.warn('Database preparation failed', e);
      setPrepared({ name: PLAIN_DB, key: null });
    });
  }, []);

  useEffect(() => {
    if (!prepared?.unreadable) return;
    Alert.alert(
      'Your earlier data couldn’t be opened',
      'This can happen after moving BudT to a new phone, because its encryption key stays on the old one. You can restore your data from a BudT backup in Settings.',
    );
  }, [prepared?.unreadable]);

  const key = prepared?.key;
  const onInit = useCallback(
    async (db: SQLiteDatabase) => {
      if (key) await db.execAsync(keyStatement(key));
      await migrateDbIfNeeded(db);
    },
    [key],
  );

  if (!prepared) return null;
  return (
    <SQLiteProvider databaseName={prepared.name} onInit={onInit}>
      {children}
    </SQLiteProvider>
  );
}

/** First launch shows only the walkthrough; finishing it swaps in the tabs automatically. */
function RootStack() {
  const t = useTheme();
  const { onboarded } = useSettings();
  return (
    <Stack screenOptions={{ headerShadowVisible: false, headerTintColor: t.primary, headerTitleStyle: { color: t.text } }}>
      <Stack.Protected guard={onboarded}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: 'Home' }} />
      </Stack.Protected>
      <Stack.Protected guard={!onboarded}>
        <Stack.Screen name="welcome" options={{ headerShown: false, animation: 'fade' }} />
      </Stack.Protected>
      <Stack.Screen name="smart-budget" options={{ title: 'Smart budget' }} />
      {MODALS.map((name) => (
        <Stack.Screen key={name} name={name} options={{ presentation: 'modal' }} />
      ))}
    </Stack>
  );
}
